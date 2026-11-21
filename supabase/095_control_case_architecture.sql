-- ALDECKOT | Etapa 02: chamado técnico separado do estado físico.
-- Aplicar somente após 094, em homologação, com backup e revisão do preflight.
-- Rollback antes do commit: ROLLBACK. Após commit, usar migração compensatória.
begin;

do $preflight$
begin
  if to_regclass('public.control_items') is null
    or to_regclass('public.equipment_events') is null
    or to_regprocedure('app.can_manage_module_table(uuid,text,text)') is null
    or not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'control_items' and column_name = 'followup_kind') then
    raise exception 'A migração 094 e suas dependências devem estar aplicadas antes da 095.';
  end if;
end;
$preflight$;

create table public.control_cases (
  id uuid primary key default gen_random_uuid(),
  control_item_id uuid references public.control_items(id) on delete set null,
  table_id uuid references public.module_tables(id) on delete set null,
  source_module text not null check (source_module in ('control','inventory','management','supplies')),
  source_id uuid not null,
  followup_kind text not null check (followup_kind in ('maintenance','verification')),
  ticket_state text check (ticket_state in (
    'Aberto','Em verificação','Em diagnóstico','Em manutenção','Aguardando peça',
    'Aguardando fornecedor','Aguardando retorno','Aguardando teste',
    'Resolvido','Concluído','Cancelado')),
  legacy_status text not null default '',
  requires_review boolean not null default false,
  equipment text not null default '',
  tag text not null default '',
  serial text not null default '',
  sector text not null default '',
  priority text not null default '',
  solution text,
  related_case_id uuid references public.control_cases(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (ticket_state is distinct from 'Resolvido' or resolved_at is not null),
  check (ticket_state not in ('Concluído','Cancelado') or closed_at is not null)
);

create table public.control_case_transitions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete cascade,
  request_id uuid unique,
  previous_state text,
  next_state text,
  reason text not null default '',
  source text not null check (source in ('backfill','legacy','manual')),
  actor_id uuid references auth.users(id) on delete set null,
  event_id uuid references public.equipment_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index control_cases_source_history_idx on public.control_cases (source_module,source_id,opened_at desc);
create index control_cases_item_history_idx on public.control_cases (control_item_id,opened_at desc);
create index control_cases_state_opened_idx on public.control_cases (ticket_state,opened_at desc);
create unique index control_cases_one_open_item_idx on public.control_cases (control_item_id)
  where control_item_id is not null and ticket_state is not null
    and ticket_state not in ('Concluído','Cancelado');
create index control_case_transitions_case_idx on public.control_case_transitions (case_id,created_at desc);

-- Um registro legado gera no máximo um chamado. Não inferimos episódios anteriores
-- a partir de logs, nem transformamos Em uso/Em sala/Descartado em chamados abertos.
insert into public.control_cases (
  id,control_item_id,table_id,source_module,source_id,followup_kind,ticket_state,
  legacy_status,requires_review,equipment,tag,serial,sector,priority,opened_at,
  resolved_at,closed_at,updated_at
)
select c.id,c.id,c.table_id,
  case when c.verification_inventory_item_id is not null or c.inventory_item_id is not null then 'inventory'
    when c.verification_computer_id is not null or
      (c.management_record_id is not null and m.management_computer_id is not null
        and nullif(btrim(c.serial),'') is not null
        and lower(btrim(c.serial)) = lower(btrim(coalesce(m.payload->>'serial','')))) then 'management'
    when c.supply_unit_id is not null then 'supplies' else 'control' end,
  coalesce(c.verification_inventory_item_id,c.inventory_item_id,
    c.verification_computer_id,
    case when nullif(btrim(c.serial),'') is not null
      and lower(btrim(c.serial)) = lower(btrim(coalesce(m.payload->>'serial','')))
      then m.management_computer_id end,c.supply_unit_id,c.id),
  c.followup_kind,
  case when c.status = 'Cancelado' then 'Cancelado'
    when c.status in ('Manutenção concluída','Verificação concluída') then 'Concluído'
    when c.followup_kind = 'verification' and c.status = 'Aguardando avaliação' then 'Em verificação'
    when c.status = 'Aguardando avaliação' then 'Em diagnóstico'
    when c.status = 'Em manutenção' then 'Em manutenção' else null end,
  c.status,
  c.status not in ('Cancelado','Manutenção concluída','Verificação concluída','Aguardando avaliação','Em manutenção')
    or (c.management_record_id is not null and (m.management_computer_id is null
      or nullif(btrim(c.serial),'') is null
      or lower(btrim(c.serial)) is distinct from lower(btrim(coalesce(m.payload->>'serial',''))))),
  c.equipment,c.tag,c.serial,c.sector,
  case when c.notes like '[[aldeckot:item-priority:alta]]%' then 'Alta'
    when c.notes like '[[aldeckot:item-priority:media]]%' then 'Média'
    else 'Estável' end,c.created_at,
  case when c.status in ('Manutenção concluída','Verificação concluída') then c.updated_at end,
  case when c.status in ('Manutenção concluída','Verificação concluída','Cancelado') then c.updated_at end,
  c.updated_at
from public.control_items c
left join public.module_records m on m.id = c.management_record_id;

insert into public.control_case_transitions (case_id,previous_state,next_state,reason,source,created_at)
select id,null,ticket_state,'Estado inicial derivado do cadastro legado; histórico anterior preservado no Controle TI.',
  'backfill',opened_at from public.control_cases;

create or replace function app.sync_control_case_from_item()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  next_state text; current_case public.control_cases%rowtype;
  source_module_name text; source_uuid uuid; management_identity_ok boolean;
begin
  next_state := case when new.status = 'Cancelado' then 'Cancelado'
    when new.status in ('Manutenção concluída','Verificação concluída') then 'Concluído'
    when new.followup_kind = 'verification' and new.status = 'Aguardando avaliação' then 'Em verificação'
    when new.status = 'Aguardando avaliação' then 'Em diagnóstico'
    when new.status = 'Em manutenção' then 'Em manutenção' else null end;
  if next_state is null then return new; end if;
  select * into current_case from public.control_cases
    where control_item_id = new.id and ticket_state not in ('Concluído','Cancelado')
    order by opened_at desc limit 1 for update;
  if found then
    if current_case.ticket_state is distinct from next_state then
      update public.control_cases set ticket_state = next_state,legacy_status = new.status,
        resolved_at = case when next_state = 'Concluído' then coalesce(resolved_at,now())
          when current_case.ticket_state = 'Resolvido' then null else resolved_at end,
        closed_at = case when next_state in ('Concluído','Cancelado') then now() else null end,
        updated_at = now() where id = current_case.id;
      insert into public.control_case_transitions(case_id,previous_state,next_state,reason,source,actor_id)
        values(current_case.id,current_case.ticket_state,next_state,'Alteração do cadastro legado.','legacy',auth.uid());
    end if;
    return new;
  end if;
  -- Após um encerramento, a nova entrada técnica é sempre outro chamado.
  if next_state in ('Concluído','Cancelado') then return new; end if;
  management_identity_ok := new.management_record_id is not null
    and nullif(btrim(new.serial),'') is not null
    and exists(select 1 from public.module_records m where m.id = new.management_record_id
      and m.management_computer_id is not null
      and lower(btrim(new.serial)) = lower(btrim(coalesce(m.payload->>'serial',''))));
  source_module_name := case when coalesce(new.verification_inventory_item_id,new.inventory_item_id) is not null then 'inventory'
    when new.verification_computer_id is not null or management_identity_ok then 'management'
    when new.supply_unit_id is not null then 'supplies' else 'control' end;
  source_uuid := coalesce(new.verification_inventory_item_id,new.inventory_item_id,
    new.verification_computer_id,
    case when management_identity_ok then
      (select m.management_computer_id from public.module_records m where m.id = new.management_record_id) end,
    new.supply_unit_id,new.id);
  insert into public.control_cases(control_item_id,table_id,source_module,source_id,
    followup_kind,ticket_state,legacy_status,requires_review,equipment,tag,serial,sector,priority,opened_at)
    values(new.id,new.table_id,source_module_name,source_uuid,new.followup_kind,
      next_state,new.status,new.management_record_id is not null
        and new.verification_computer_id is null and not management_identity_ok,
      new.equipment,new.tag,new.serial,new.sector,
      case when new.notes like '[[aldeckot:item-priority:alta]]%' then 'Alta'
        when new.notes like '[[aldeckot:item-priority:media]]%' then 'Média'
        else 'Estável' end,now())
    returning * into current_case;
  insert into public.control_case_transitions(case_id,previous_state,next_state,reason,source,actor_id)
    values(current_case.id,null,next_state,'Novo episódio técnico.','legacy',auth.uid());
  return new;
end;
$$;
create trigger control_case_from_item
  after insert or update of status on public.control_items
  for each row execute function app.sync_control_case_from_item();

-- A exclusão legada apagaria control_item_logs em cascata. Até existir um
-- arquivamento transacional, preservamos o cadastro e seu histórico original.
create or replace function app.prevent_control_item_with_cases_delete()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if exists (select 1 from public.control_cases where control_item_id = old.id) then
    raise exception 'Há chamados vinculados. Arquive o equipamento; exclusão física bloqueada para preservar o histórico.';
  end if;
  return old;
end;
$$;
create trigger control_case_preserve_history
  before delete on public.control_items
  for each row execute function app.prevent_control_item_with_cases_delete();

alter table public.control_cases enable row level security;
alter table public.control_case_transitions enable row level security;
revoke all on public.control_cases,public.control_case_transitions from public,anon,authenticated;
grant select on public.control_cases,public.control_case_transitions to authenticated;
create policy "Contas ativas consultam chamados" on public.control_cases
  for select to authenticated using (app.has_active_account());
create policy "Contas ativas consultam transições" on public.control_case_transitions
  for select to authenticated using (app.has_active_account());

create or replace function public.transition_control_case(
  p_case_id uuid,p_next_state text,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  current_case public.control_cases%rowtype; prior public.control_case_transitions%rowtype;
  root_event uuid; cleaned_reason text;
begin
  if auth.uid() is null or not app.has_active_account() or p_case_id is null or p_request_id is null then
    raise exception 'Sessão ativa e identificadores do chamado são necessários.';
  end if;
  if p_next_state is null or p_next_state not in ('Aberto','Em verificação','Em diagnóstico',
    'Em manutenção','Aguardando peça','Aguardando fornecedor','Aguardando retorno',
    'Aguardando teste','Resolvido','Concluído','Cancelado') then
    raise exception 'Estado do chamado inválido.';
  end if;
  cleaned_reason := btrim(coalesce(p_reason,''));
  if char_length(cleaned_reason) > 2000 or
    (p_next_state in ('Resolvido','Cancelado') and char_length(cleaned_reason) < 3) then
    raise exception 'Informe uma justificativa de 3 a 2000 caracteres.';
  end if;
  select * into current_case from public.control_cases where id = p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if current_case.table_id is null or
    not coalesce(app.can_manage_module_table(current_case.table_id,'control','update'),false) then
    raise exception 'Sem permissão para alterar este chamado.';
  end if;
  select * into prior from public.control_case_transitions where request_id = p_request_id;
  if found then
    if prior.case_id <> p_case_id or prior.next_state <> p_next_state or prior.reason <> cleaned_reason then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('caseId',p_case_id,'eventId',prior.event_id,'alreadyApplied',true);
  end if;
  if current_case.ticket_state in ('Concluído','Cancelado') or
    current_case.ticket_state = p_next_state then
    raise exception 'Chamado encerrado ou já neste estado.';
  end if;
  if p_next_state = 'Concluído' and current_case.ticket_state <> 'Resolvido' then
    raise exception 'Registre primeiro a solução antes do encerramento formal.';
  end if;
  if current_case.ticket_state = 'Resolvido' and p_next_state not in ('Concluído','Em diagnóstico','Aguardando teste') then
    raise exception 'Após resolução, conclua ou devolva o chamado para diagnóstico/teste.';
  end if;
  insert into public.equipment_events(source_module,source_event_key,source_id,
    action,reason,affected_modules,metadata,actor_id)
    values('control','case-transition:' || p_request_id::text,p_case_id,
      'Estado do chamado alterado',cleaned_reason,jsonb_build_array('control'),
      jsonb_build_object('caseId',p_case_id,'controlItemId',current_case.control_item_id,
        'previousCaseState',current_case.ticket_state,'nextCaseState',p_next_state,
        'physicalMovement',false,'equipmentStatusChanged',false),auth.uid())
    returning id into root_event;
  update public.control_cases set ticket_state = p_next_state,
    solution = case when p_next_state = 'Resolvido' then cleaned_reason else solution end,
    resolved_at = case when p_next_state = 'Resolvido' then now()
      when p_next_state in ('Em diagnóstico','Aguardando teste') then null else resolved_at end,
    closed_at = case when p_next_state in ('Concluído','Cancelado') then now() else null end,
    requires_review = false,updated_at = now() where id = p_case_id;
  insert into public.control_case_transitions(case_id,request_id,previous_state,next_state,
    reason,source,actor_id,event_id)
    values(p_case_id,p_request_id,current_case.ticket_state,p_next_state,
      cleaned_reason,'manual',auth.uid(),root_event);
  insert into public.equipment_event_effects(event_id,module,status,attempts,processed_at)
    values(root_event,'control','applied',1,now());
  return jsonb_build_object('caseId',p_case_id,'eventId',root_event,'alreadyApplied',false);
end;
$$;
revoke all on function public.transition_control_case(uuid,text,text,uuid) from public,anon;
grant execute on function public.transition_control_case(uuid,text,text,uuid) to authenticated;

comment on table public.control_cases is 'Episódios técnicos independentes do estado operacional e da localização física do equipamento.';
comment on column public.control_cases.requires_review is 'Estado legado ambíguo: demanda classificação humana; não abrir chamado por inferência.';
commit;
