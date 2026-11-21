-- ALDECKOT | Etapa 03: abertura auditada da verificação no Inventário.
-- Aplicar após 095. Testar primeiro no PostgreSQL local isolado.
-- Rollback antes do commit: ROLLBACK. Depois do commit, somente migração compensatória.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regprocedure('app.sync_technical_verification(text,uuid,text)') is null then
    raise exception 'As migrações 094 e 095 devem estar aplicadas antes da 096.';
  end if;
end;
$preflight$;

alter table public.control_cases
  add column opening_reason text,
  add column opening_location text,
  add column opening_equipment_status text;

create table public.control_verification_requests (
  request_id uuid primary key,
  case_id uuid not null references public.control_cases(id) on delete restrict,
  control_item_id uuid not null references public.control_items(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 2000),
  priority text not null check (priority in ('Alta','Média','Estável')),
  equipment text not null,
  tag text not null,
  serial text not null,
  sector text not null,
  location text not null,
  equipment_status text not null,
  previous_situation text not null,
  start_event_id uuid not null references public.equipment_events(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome text check (outcome in ('resolved_without_maintenance','maintenance_completed','promoted_to_maintenance')),
  promotion_request_id uuid unique,
  maintenance_case_id uuid references public.control_cases(id) on delete restrict
);
create index control_verification_requests_case_idx
  on public.control_verification_requests(case_id,started_at desc);
create index control_verification_requests_inventory_idx
  on public.control_verification_requests(inventory_item_id,started_at desc);
create unique index control_verification_requests_one_open_source_idx
  on public.control_verification_requests(inventory_item_id) where completed_at is null;
alter table public.control_verification_requests enable row level security;
revoke all on public.control_verification_requests from public,anon,authenticated;
grant select on public.control_verification_requests to authenticated;
create policy "Contas ativas consultam verificações" on public.control_verification_requests
  for select to authenticated using (app.has_active_account());

create or replace function app.require_inventory_verification_request()
returns trigger language plpgsql security definer set search_path = public,app,pg_temp as $$
begin
  if new.situation = 'Verificando'
    and (tg_op = 'INSERT' or old.situation is distinct from new.situation)
    and coalesce(current_setting('app.verification_open_request_id',true),'') = '' then
    raise exception 'Informe o motivo e inicie a verificação pelo formulário do Inventário.';
  end if;
  return new;
end;
$$;
create trigger inventory_verification_request_guard
  before insert or update of situation on public.inventory_items
  for each row execute function app.require_inventory_verification_request();

create or replace function public.start_inventory_verification(
  p_item_id uuid,p_reason text,p_request_id uuid,p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public,app,pg_temp as $$
declare
  item public.inventory_items%rowtype;
  prior public.control_verification_requests%rowtype;
  case_row public.control_cases%rowtype; start_event uuid;
  cleaned_reason text := btrim(coalesce(p_reason,'')); priority_value text;
  prior_situation text;
begin
  if auth.uid() is null or not app.has_active_account() or p_item_id is null
    or p_request_id is null or p_expected_updated_at is null
    or char_length(cleaned_reason) not between 3 and 2000 then
    raise exception 'Informe equipamento, motivo (3 a 2000 caracteres) e operação válida.';
  end if;
  select * into item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Equipamento não encontrado no Inventário.'; end if;
  if not coalesce(app.can_manage_module_table(item.table_id,'inventory','update'),false) then
    raise exception 'Sem permissão para iniciar verificação neste equipamento.';
  end if;
  select * into prior from public.control_verification_requests where request_id = p_request_id;
  if found then
    if prior.inventory_item_id <> p_item_id or prior.reason <> cleaned_reason then
      raise exception 'Identificador de operação já utilizado com outros dados.';
    end if;
    return jsonb_build_object('itemId',p_item_id,'caseId',prior.case_id,
      'eventId',prior.start_event_id,'alreadyApplied',true);
  end if;
  if item.updated_at is distinct from p_expected_updated_at then
    raise exception 'O equipamento mudou desde a abertura do formulário. Recarregue e confira os dados.';
  end if;
  if item.situation = 'Verificando' then
    raise exception 'A verificação deste equipamento já está em andamento.';
  end if;
  prior_situation := item.situation;
  priority_value := case when item.notes like '[[aldeckot:item-priority:alta]]%' then 'Alta'
    when item.notes like '[[aldeckot:item-priority:media]]%' then 'Média' else 'Estável' end;
  perform set_config('app.verification_open_request_id',p_request_id::text,true);
  update public.inventory_items set situation = 'Verificando' where id = p_item_id;
  perform set_config('app.verification_open_request_id','',true);

  select cc.* into case_row
    from public.control_items c join public.control_cases cc on cc.control_item_id = c.id
    where (c.verification_inventory_item_id = p_item_id or c.inventory_item_id = p_item_id)
      and c.status in ('Aguardando avaliação','Em manutenção','Em sala')
      and cc.ticket_state is not null and cc.ticket_state not in ('Concluído','Cancelado')
    order by c.created_at desc,cc.opened_at desc limit 1;
  if case_row.id is null then
    raise exception 'O chamado técnico não foi vinculado; nenhuma alteração foi salva.';
  end if;
  select e.id into start_event from public.equipment_events e
    where e.source_module = 'control' and e.source_id = case_row.control_item_id
      and e.action = 'Verificação iniciada'
      and e.metadata->>'sourceId' = p_item_id::text
      and e.created_at >= transaction_timestamp()
    order by e.created_at desc,e.id desc limit 1;
  if start_event is null then
    raise exception 'O início da verificação não gerou histórico; nenhuma alteração foi salva.';
  end if;
  update public.equipment_events set reason = cleaned_reason,
    metadata = metadata || jsonb_build_object('requestId',p_request_id,
      'priority',priority_value,'sector',item.sector,'location',item.location,
      'tag',item.tag,'serial',item.serial,'physicalMovement',false)
    where id = start_event;
  insert into public.control_verification_requests(
    request_id,case_id,control_item_id,inventory_item_id,reason,priority,
    equipment,tag,serial,sector,location,equipment_status,previous_situation,
    start_event_id,actor_id)
  values(p_request_id,case_row.id,case_row.control_item_id,p_item_id,cleaned_reason,priority_value,
    item.equipment,item.tag,item.serial,item.sector,item.location,item.status,
    prior_situation,start_event,auth.uid());
  if case_row.followup_kind = 'verification' then
    update public.control_cases set opening_reason = cleaned_reason,
      opening_location = item.location, opening_equipment_status = item.status,
      priority = priority_value,updated_at = now() where id = case_row.id;
  end if;
  return jsonb_build_object('itemId',p_item_id,'caseId',case_row.id,
    'eventId',start_event,'alreadyApplied',false);
end;
$$;
revoke all on function public.start_inventory_verification(uuid,text,uuid,timestamptz)
  from public,anon;
grant execute on function public.start_inventory_verification(uuid,text,uuid,timestamptz)
  to authenticated;

create or replace function app.finish_inventory_verification_request()
returns trigger language plpgsql security definer set search_path = public,app,pg_temp as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status in ('Verificação concluída','Manutenção concluída') then
    update public.control_verification_requests
      set completed_at = now(), outcome = case
        when new.status = 'Verificação concluída' then 'resolved_without_maintenance'
        else 'maintenance_completed' end
      where control_item_id = new.id and completed_at is null;
  end if;
  return new;
end;
$$;
create trigger control_verification_request_completion
  after update of status on public.control_items
  for each row execute function app.finish_inventory_verification_request();

-- O evento técnico da conclusão precede a mudança do cadastro legado.
-- Registre a solução no caso antes de o gatilho da 095 fechá-lo.
create or replace function app.resolve_verification_case_from_event()
returns trigger language plpgsql security definer set search_path = public,app,pg_temp as $$
declare current_case public.control_cases%rowtype;
begin
  select cc.* into current_case from public.control_cases cc
    where cc.control_item_id = new.source_id
      and cc.followup_kind = 'verification'
      and cc.ticket_state not in ('Concluído','Cancelado')
    order by cc.opened_at desc limit 1 for update;
  if not found then return new; end if;
  update public.control_cases set ticket_state = 'Resolvido',
    solution = new.reason,resolved_at = now(),updated_at = now()
    where id = current_case.id;
  if current_case.ticket_state <> 'Resolvido' then
    insert into public.control_case_transitions(
      case_id,previous_state,next_state,reason,source,actor_id,event_id
    ) values(
      current_case.id,current_case.ticket_state,'Resolvido',new.reason,
      'legacy',new.actor_id,new.id
    );
  end if;
  return new;
end;
$$;
create trigger verification_case_solution_from_event
  after insert on public.equipment_events
  for each row when (new.source_module = 'control' and new.action = 'Verificação concluída')
  execute function app.resolve_verification_case_from_event();

-- A identidade permanece exclusiva entre registros ativos. Somente o histórico
-- de verificação encerrada da MESMA origem pode coexistir com sua manutenção.
create or replace function app.prevent_control_identity_duplicate()
returns trigger language plpgsql security definer set search_path = public,app,pg_temp as $$
declare
  current_item_id uuid;
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.tag,''))),''),'-'),'***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.serial,''))),''),'-'),'***');
begin
  current_item_id := case when tg_op = 'UPDATE' then old.id else new.id end;
  if tg_op = 'UPDATE' and new.tag is not distinct from old.tag
    and new.serial is not distinct from old.serial then return new; end if;
  if incoming_tag is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(current_item_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.tag,''))),''),'-'),'***') = incoming_tag
      and not (new.followup_kind = 'maintenance' and item.followup_kind = 'verification'
        and item.status = 'Verificação concluída'
        and item.verification_inventory_item_id = new.inventory_item_id)
  ) then
    raise exception using errcode = '23505',message = 'Esta TAG já está cadastrada no Controle TI.';
  end if;
  if incoming_serial is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(current_item_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.serial,''))),''),'-'),'***') = incoming_serial
      and not (new.followup_kind = 'maintenance' and item.followup_kind = 'verification'
        and item.status = 'Verificação concluída'
        and item.verification_inventory_item_id = new.inventory_item_id)
  ) then
    raise exception using errcode = '23505',message = 'Este número de série já está cadastrado no Controle TI.';
  end if;
  return new;
end;
$$;

-- Cadastros antigos do Inventário podem não ter modelo. O Controle TI exige
-- um valor; o espelho recebe um marcador, sem alterar o dado original.
do $normalize_maintenance_model$
declare
  definition text; body text; updated_body text;
begin
  select p.prosrc,pg_get_functiondef(p.oid) into body,definition
    from pg_proc p where p.oid =
      to_regprocedure('app.sync_inventory_maintenance_to_control(uuid)');
  if body is null or position('source_item.model, source_item.brand' in body) = 0 then
    raise exception 'A sincronização Inventário/Controle TI mudou; revise a migração 096.';
  end if;
  updated_body := replace(body,'source_item.model, source_item.brand',
    'coalesce(nullif(btrim(source_item.model), ''''), ''Não informado''), source_item.brand');
  execute replace(definition,body,updated_body);
end;
$normalize_maintenance_model$;

create or replace function public.promote_inventory_verification_to_maintenance(
  p_control_item_id uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public,app,pg_temp as $$
declare
  ticket public.control_items%rowtype; source_item public.inventory_items%rowtype;
  verification_request public.control_verification_requests%rowtype;
  maintenance_case public.control_cases%rowtype; prior_event public.equipment_events%rowtype;
  cleaned_reason text := btrim(coalesce(p_reason,'')); root_event uuid;
  completion_result jsonb; old_status text;
begin
  if auth.uid() is null or not app.has_active_account() or p_control_item_id is null
    or p_request_id is null or char_length(cleaned_reason) not between 3 and 2000 then
    raise exception 'Informe o acompanhamento e a justificativa de manutenção (3 a 2000 caracteres).';
  end if;
  select * into ticket from public.control_items where id = p_control_item_id;
  if not found or ticket.followup_kind <> 'verification'
    or ticket.verification_inventory_item_id is null then
    raise exception 'Verificação do Inventário não encontrada.';
  end if;
  if not coalesce(app.can_manage_module_table(ticket.table_id,'control','update'),false) then
    raise exception 'Sem permissão para encaminhar a verificação para manutenção.';
  end if;
  -- A mesma ordem de travas da conclusão evita corrida com uma conclusão simultânea.
  select * into source_item from public.inventory_items
    where id = ticket.verification_inventory_item_id for update;
  if not found then raise exception 'Equipamento de origem não encontrado.'; end if;
  select * into ticket from public.control_items where id = p_control_item_id for update;
  select * into prior_event from public.equipment_events
    where source_module = 'control'
      and source_event_key = 'verification-promotion:' || p_request_id::text;
  if found then
    if prior_event.source_id is distinct from p_control_item_id
      or prior_event.reason is distinct from cleaned_reason then
      raise exception 'Identificador de operação já utilizado com outros dados.';
    end if;
    return jsonb_build_object('caseId',prior_event.metadata->>'maintenanceCaseId',
      'eventId',prior_event.id,'alreadyApplied',true);
  end if;
  select * into verification_request from public.control_verification_requests
    where control_item_id = p_control_item_id and completed_at is null for update;
  if not found or ticket.status <> 'Aguardando avaliação'
    or source_item.situation <> 'Verificando' then
    raise exception 'Esta verificação não está aberta para encaminhamento.';
  end if;
  if exists (select 1 from public.control_cases c
    where c.source_module = 'inventory' and c.source_id = source_item.id
      and c.followup_kind = 'maintenance'
      and c.ticket_state not in ('Concluído','Cancelado')) then
    raise exception 'Já existe manutenção aberta para este equipamento.';
  end if;
  old_status := source_item.status;
  completion_result := public.complete_control_verification(
    p_control_item_id,gen_random_uuid(),
    'Encaminhado para manutenção: ' || cleaned_reason,'{}'::jsonb);
  if completion_result->>'alreadyApplied' = 'true' then
    raise exception 'A verificação já foi concluída por outra operação.';
  end if;
  -- A sincronização oficial cria um novo registro/caso de manutenção para a mesma identidade.
  update public.inventory_items set status = 'Manutenção' where id = source_item.id;
  select cc.* into maintenance_case from public.control_cases cc
    join public.control_items c on c.id = cc.control_item_id
    where c.inventory_item_id = source_item.id and c.followup_kind = 'maintenance'
      and c.status = 'Em manutenção' and cc.ticket_state = 'Em manutenção'
    order by cc.opened_at desc,cc.id desc limit 1;
  if maintenance_case.id is null then
    raise exception 'A manutenção não foi vinculada; nenhuma alteração foi salva.';
  end if;
  update public.control_cases set related_case_id = verification_request.case_id,
    opening_reason = cleaned_reason,opening_location = source_item.location,
    opening_equipment_status = old_status,updated_at = now()
    where id = maintenance_case.id;
  update public.control_verification_requests set outcome = 'promoted_to_maintenance',
    promotion_request_id = p_request_id,maintenance_case_id = maintenance_case.id
    where request_id = verification_request.request_id;
  insert into public.equipment_events(source_module,source_event_key,source_id,
    inventory_item_id,action,previous_status,new_status,previous_location,new_location,
    reason,affected_modules,metadata,actor_id) values(
    'control','verification-promotion:' || p_request_id::text,p_control_item_id,
    source_item.id,'Verificação encaminhada para manutenção',old_status,'Manutenção',
    source_item.location,source_item.location,cleaned_reason,
    jsonb_build_array('control','inventory'),
    jsonb_build_object('verificationCaseId',verification_request.case_id,
      'maintenanceCaseId',maintenance_case.id,'physicalMovement',false,
      'equipmentStatusChanged',true),auth.uid()) returning id into root_event;
  insert into public.equipment_event_effects(event_id,module,status,attempts,processed_at)
    values(root_event,'control','applied',1,now()),
      (root_event,'inventory','applied',1,now());
  return jsonb_build_object('caseId',maintenance_case.id,
    'eventId',root_event,'alreadyApplied',false);
end;
$$;
revoke all on function public.promote_inventory_verification_to_maintenance(uuid,text,uuid)
  from public,anon;
grant execute on function public.promote_inventory_verification_to_maintenance(uuid,text,uuid)
  to authenticated;

comment on table public.control_verification_requests is
  'Motivo e contexto de cada verificação iniciada no Inventário, mesmo quando vinculada a manutenção existente.';
commit;
