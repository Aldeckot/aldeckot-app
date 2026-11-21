-- Proposta aditiva. Aplicar somente depois da aprovação da matriz do Controle TI.
begin;

alter table public.control_items
  add column operational_status text,
  add column operational_situation text,
  add constraint control_items_operational_status_check check
    (operational_status in ('Em manutenção', 'Concluído', 'Em uso', 'Descartado')),
  add constraint control_items_operational_situation_check check
    (operational_situation in ('Aguardando verificação', 'Cancelado', 'Verificação concluída', 'Aguardando peça'));

create function app.record_control_board_classification()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  before_status text;
  before_situation text;
  message text;
  operation_id uuid := gen_random_uuid();
begin
  if tg_op = 'UPDATE' then
    before_status := old.operational_status;
    before_situation := old.operational_situation;
  end if;
  if before_status is not distinct from new.operational_status
    and before_situation is not distinct from new.operational_situation then
    return new;
  end if;
  message := concat_ws(' · ',
    case when before_status is distinct from new.operational_status then
      format('Status operacional: %s → %s', coalesce(before_status, 'sem valor explícito'),
        coalesce(new.operational_status, 'sem valor explícito')) end,
    case when before_situation is distinct from new.operational_situation then
      format('Situação: %s → %s', coalesce(before_situation, 'sem situação definida'),
        coalesce(new.operational_situation, 'sem situação definida')) end);
  insert into public.equipment_events (id, source_module, source_event_key, source_id,
    action, previous_status, new_status, reason, affected_modules, processing_result, metadata, actor_id)
  values (operation_id, 'control', 'board-classification:' || operation_id, new.id,
    'Classificação operacional atualizada', before_status, new.operational_status, message, '["control"]'::jsonb,
    '{"status":"applied"}'::jsonb, jsonb_build_object('boardKind', 'classification',
      'operationId', operation_id, 'previousSituation', before_situation,
      'newSituation', new.operational_situation, 'technicalStatus', new.status), auth.uid());
  return new;
end;
$$;

revoke all on function app.record_control_board_classification() from public, anon, authenticated;
create trigger control_board_classification_history
  after insert or update of operational_status, operational_situation on public.control_items
  for each row execute function app.record_control_board_classification();

create function public.control_record_board_activity(p_item_id uuid, p_kind text, p_fields jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  item public.control_items%rowtype;
  existing public.equipment_events%rowtype;
  first_field text;
  second_field text;
  activity_fields jsonb;
  activity_name text;
  message text;
  notes text := btrim(coalesce(p_fields->>'notes', ''));
  quantity integer;
  due_date date;
begin
  if auth.uid() is null or p_request_id is null or p_kind is null
    or p_kind not in ('part', 'preventive') or jsonb_typeof(p_fields) is distinct from 'object' then
    raise exception 'Informe o equipamento e os dados da atividade.';
  end if;
  select * into item from public.control_items where id = p_item_id for key share;
  if not found or not coalesce(app.can_manage_module_table(item.table_id, 'control', 'update'), false) then
    raise exception 'Sem permissão para registrar atividade neste equipamento.';
  end if;
  if char_length(notes) > 500 then raise exception 'Use até 500 caracteres em Observações.'; end if;

  if p_kind = 'part' then
    first_field := btrim(coalesce(p_fields->>'part', ''));
    second_field := btrim(coalesce(p_fields->>'reason', ''));
    if char_length(first_field) not between 1 and 160 or char_length(second_field) not between 1 and 500
      or coalesce(p_fields->>'priority', '') not in ('Estável', 'Média', 'Alta')
      or coalesce(p_fields->>'quantity', '') !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'Informe peça, quantidade inteira positiva, prioridade e justificativa.';
    end if;
    if (p_fields->>'quantity')::numeric > 2147483647 then raise exception 'Quantidade acima do limite permitido.'; end if;
    quantity := (p_fields->>'quantity')::integer;
    activity_name := 'Solicitação de peça';
    activity_fields := jsonb_build_object('part', first_field, 'quantity', quantity,
      'priority', p_fields->>'priority', 'reason', second_field, 'notes', notes);
    message := format('%s × %s · Prioridade: %s · Justificativa: %s',
      quantity, first_field, p_fields->>'priority', second_field);
  else
    first_field := btrim(coalesce(p_fields->>'activity', ''));
    second_field := btrim(coalesce(p_fields->>'responsible', ''));
    if char_length(first_field) not between 1 and 160 or char_length(second_field) not between 1 and 120
      or coalesce(p_fields->>'dueDate', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Informe atividade, data prevista e responsável.';
    end if;
    due_date := (p_fields->>'dueDate')::date;
    activity_name := 'Manutenção preventiva planejada';
    activity_fields := jsonb_build_object('activity', first_field, 'dueDate', due_date,
      'responsible', second_field, 'notes', notes);
    message := format('%s · Prevista para %s · Responsável: %s',
      first_field, to_char(due_date, 'DD/MM/YYYY'), second_field);
  end if;
  if notes <> '' then message := message || ' · Observações: ' || notes; end if;

  perform pg_advisory_xact_lock(hashtext('control-record-board-activity'), hashtext(p_request_id::text));
  select * into existing from public.equipment_events
    where source_module = 'control' and source_event_key = 'board-activity:' || p_request_id;
  if found then
    if existing.source_id is distinct from item.id or existing.actor_id is distinct from auth.uid()
      or existing.metadata->>'boardKind' is distinct from p_kind
      or existing.metadata->'fields' is distinct from activity_fields then
      raise exception 'Esta operação já foi usada com outros dados.';
    end if;
    return jsonb_build_object('eventId', existing.id, 'alreadyApplied', true);
  end if;
  insert into public.equipment_events (id, source_module, source_event_key, source_id,
    action, reason, affected_modules, processing_result, metadata, actor_id)
  values (p_request_id, 'control', 'board-activity:' || p_request_id, item.id,
    activity_name, message, '["control"]'::jsonb, '{"status":"recorded"}'::jsonb,
    jsonb_build_object('boardKind', p_kind, 'operationId', p_request_id, 'equipment', item.equipment,
      'tag', item.tag, 'fields', activity_fields), auth.uid());
  return jsonb_build_object('eventId', p_request_id, 'alreadyApplied', false);
end;
$$;

create function public.control_board_timeline(p_item_id uuid)
returns table(occurred_at timestamptz, action text, message text, event_id uuid, origin text)
language sql stable security invoker set search_path = pg_catalog, public, pg_temp as $$
  with item as (
    select id from public.control_items where id = p_item_id
  ), logs as (
    select l.* from public.control_item_logs l join item i on i.id = l.control_item_id
  ), transitions as (
    select t.* from public.control_case_transitions t
    join public.control_cases c on c.id = t.case_id
    join item i on i.id = c.control_item_id
  ), structured as (
    select e.* from public.equipment_events e where
      (e.source_module = 'control' and exists (select 1 from item i where i.id = e.source_id))
      or exists (select 1 from logs l where l.event_id = e.id)
      or exists (select 1 from transitions t where t.event_id = e.id)
  ), timeline as (
    select e.created_at as occurred_at, e.action,
      coalesce(nullif(e.reason, ''), (select l.message from logs l
        where l.event_id = e.id order by l.created_at, l.id limit 1), '') as message,
      e.id as event_id, case when e.metadata ? 'boardKind' then 'board' else 'event' end as origin,
      e.id as stable_id
    from structured e
    union all
    select l.created_at, 'Registro do Controle TI', l.message, l.event_id, 'log', l.id from logs l
    where not exists (select 1 from structured e where e.id = l.event_id)
    union all
    select t.created_at, 'Estado do chamado', concat_ws(' · ',
      format('%s → %s', coalesce(t.previous_state, 'sem estado anterior'), coalesce(t.next_state, 'a revisar')),
      nullif(t.reason, '')), t.event_id, 'case', t.id
    from transitions t where not exists (select 1 from structured e where e.id = t.event_id)
    union all
    select c.opened_at, case when c.followup_kind = 'verification' then 'Verificação aberta' else 'Manutenção aberta' end,
      'Abertura do chamado registrada no Controle TI', null::uuid, 'case', c.id
    from public.control_cases c join item i on i.id = c.control_item_id
    where not exists (select 1 from transitions t where t.case_id = c.id and t.previous_state is null
      and t.created_at = c.opened_at)
  )
  select t.occurred_at, t.action, t.message, t.event_id, t.origin
  from timeline t order by t.occurred_at, t.stable_id;
$$;

revoke all on function public.control_record_board_activity(uuid,text,jsonb,uuid),
  public.control_board_timeline(uuid) from public, anon;
grant execute on function public.control_record_board_activity(uuid,text,jsonb,uuid),
  public.control_board_timeline(uuid) to authenticated;

commit;
