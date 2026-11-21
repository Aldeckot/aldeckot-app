-- ALDECKOT | Etapa 09: prioridade independente e relógios auditáveis dos chamados.
-- Registra intervalos de estado derivados do histórico; não altera dados de produção.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.control_case_transitions') is null then
    raise exception 'As migrações de chamados devem estar aplicadas antes da 102.';
  end if;
end;
$preflight$;

alter table public.control_cases
  add column if not exists priority_level text not null default 'Média'
    check (priority_level in ('Baixa','Média','Alta','Crítica'));

-- Converte apenas prioridades conhecidas; “Estável” é legado e não é tratado
-- como prioridade operacional. Mantém o padrão neutro para casos sem classificação.
update public.control_cases
set priority_level = case priority when 'Alta' then 'Alta' when 'Média' then 'Média' else 'Média' end
where priority_level = 'Média';

create function app.seed_control_case_priority_level()
returns trigger language plpgsql set search_path=public,app,pg_temp as $$
begin
  if new.priority in ('Alta','Média') then new.priority_level:=new.priority;
  else new.priority_level:='Média'; end if;
  return new;
end;
$$;
create trigger control_case_seed_priority_level
  before insert on public.control_cases
  for each row execute function app.seed_control_case_priority_level();

create table public.control_case_state_intervals (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete cascade,
  transition_id uuid not null unique references public.control_case_transitions(id) on delete cascade,
  interval_kind text not null check (interval_kind in ('verification','maintenance','waiting')),
  state text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index control_case_state_intervals_case_kind_idx
  on public.control_case_state_intervals(case_id,interval_kind,started_at);
create unique index control_case_state_intervals_one_open_kind_idx
  on public.control_case_state_intervals(case_id,interval_kind) where ended_at is null;

with ordered as (
  select t.id,t.case_id,t.next_state,t.created_at,
    lead(t.created_at) over (partition by t.case_id order by t.created_at,t.id) as next_at
  from public.control_case_transitions t
), classified as (
  select o.*,
    case when next_state in ('Em verificação','Em diagnóstico') then 'verification'
      when next_state = 'Em manutenção' then 'maintenance'
      when next_state in ('Aguardando peça','Aguardando fornecedor','Aguardando retorno','Aguardando teste') then 'waiting'
    end as kind
  from ordered o
)
insert into public.control_case_state_intervals(case_id,transition_id,interval_kind,state,started_at,ended_at)
select c.case_id,c.id,c.kind,c.next_state,c.created_at,
  case when c.next_at is not null then c.next_at
    when current_case.ticket_state in ('Concluído','Cancelado') then coalesce(current_case.closed_at,c.created_at)
  end
from classified c
join public.control_cases current_case on current_case.id=c.case_id
where c.kind is not null
on conflict (transition_id) do nothing;

create function app.sync_control_case_state_interval()
returns trigger language plpgsql security definer set search_path=public,app,pg_temp as $$
declare next_kind text;
begin
  update public.control_case_state_intervals set ended_at=new.created_at
    where case_id=new.case_id and ended_at is null and started_at<=new.created_at;
  next_kind := case when new.next_state in ('Em verificação','Em diagnóstico') then 'verification'
    when new.next_state='Em manutenção' then 'maintenance'
    when new.next_state in ('Aguardando peça','Aguardando fornecedor','Aguardando retorno','Aguardando teste') then 'waiting'
    else null end;
  if next_kind is not null then
    insert into public.control_case_state_intervals(case_id,transition_id,interval_kind,state,started_at)
    values(new.case_id,new.id,next_kind,new.next_state,new.created_at)
    on conflict (transition_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger control_case_state_interval_from_transition
  after insert on public.control_case_transitions
  for each row execute function app.sync_control_case_state_interval();

alter table public.control_case_state_intervals enable row level security;
revoke all on public.control_case_state_intervals from public,anon,authenticated;
grant select on public.control_case_state_intervals to authenticated;
create policy "Contas ativas consultam intervalos dos chamados"
  on public.control_case_state_intervals for select to authenticated
  using (app.has_active_account());

create table public.control_case_priority_changes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  request_id uuid not null unique,
  previous_priority text not null check (previous_priority in ('Baixa','Média','Alta','Crítica')),
  next_priority text not null check (next_priority in ('Baixa','Média','Alta','Crítica')),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index control_case_priority_changes_case_idx
  on public.control_case_priority_changes(case_id,created_at desc);
alter table public.control_case_priority_changes enable row level security;
revoke all on public.control_case_priority_changes from public,anon,authenticated;
grant select on public.control_case_priority_changes to authenticated;
create policy "Contas ativas consultam alterações de prioridade"
  on public.control_case_priority_changes for select to authenticated
  using (app.has_active_account());

create function public.set_control_case_priority(
  p_case_id uuid,p_priority text,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare current_case public.control_cases%rowtype; prior public.control_case_priority_changes%rowtype;
begin
  if auth.uid() is null or not app.has_active_account() or p_case_id is null
    or p_request_id is null or p_priority not in ('Baixa','Média','Alta','Crítica') then
    raise exception 'Conta ativa, chamado, prioridade e operação válidos são necessários.';
  end if;
  select * into current_case from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if current_case.table_id is null or
    not coalesce(app.can_manage_module_table(current_case.table_id,'control','update'),false) then
    raise exception 'Sem permissão para alterar a prioridade deste chamado.';
  end if;
  select * into prior from public.control_case_priority_changes where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.next_priority<>p_priority then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('caseId',p_case_id,'priority',prior.next_priority,'alreadyApplied',true);
  end if;
  if current_case.ticket_state in ('Concluído','Cancelado') then
    raise exception 'Chamado encerrado não aceita alteração de prioridade.';
  end if;
  insert into public.control_case_priority_changes(case_id,request_id,previous_priority,next_priority,actor_id)
    values(p_case_id,p_request_id,current_case.priority_level,p_priority,auth.uid());
  update public.control_cases set priority_level=p_priority,updated_at=now() where id=p_case_id;
  return jsonb_build_object('caseId',p_case_id,'priority',p_priority,'alreadyApplied',false);
end;
$$;
revoke all on function public.set_control_case_priority(uuid,text,uuid) from public,anon;
grant execute on function public.set_control_case_priority(uuid,text,uuid) to authenticated;

create function public.control_case_duration_summary(p_case_id uuid default null)
returns jsonb language plpgsql stable security definer
set search_path=public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa necessária para consultar os tempos dos chamados.';
  end if;
  if p_case_id is not null and not exists(select 1 from public.control_cases where id=p_case_id) then
    raise exception 'Chamado não encontrado.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s."openedAt" desc,s.id),'[]'::jsonb)
  into result
  from (
    select c.id,c.control_item_id as "controlItemId",c.table_id as "tableId",
      c.ticket_state as state,c.priority_level as "priorityLevel",
      c.equipment,c.tag,c.opened_at as "openedAt",c.resolved_at as "resolvedAt",c.closed_at as "closedAt",
      floor(extract(epoch from (coalesce(c.closed_at,now())-c.opened_at))/60)::bigint as "totalMinutes",
      case when c.resolved_at is null then null else
        floor(extract(epoch from (c.resolved_at-c.opened_at))/60)::bigint end as "resolutionMinutes",
      coalesce(sum(greatest(0,extract(epoch from (coalesce(i.ended_at,now())-i.started_at))/60))
        filter(where i.interval_kind='verification'),0)::bigint as "verificationMinutes",
      coalesce(sum(greatest(0,extract(epoch from (coalesce(i.ended_at,now())-i.started_at))/60))
        filter(where i.interval_kind='maintenance'),0)::bigint as "maintenanceMinutes",
      coalesce(sum(greatest(0,extract(epoch from (coalesce(i.ended_at,now())-i.started_at))/60))
        filter(where i.interval_kind='waiting'),0)::bigint as "waitingMinutes",
      case when coalesce(sum(greatest(0,extract(epoch from (coalesce(i.ended_at,now())-i.started_at))/60))
        filter(where i.interval_kind='maintenance'),0) >= 30*24*60 then 'Crítica'
        when coalesce(sum(greatest(0,extract(epoch from (coalesce(i.ended_at,now())-i.started_at))/60))
          filter(where i.interval_kind='maintenance'),0) >= 15*24*60 then 'Atenção'
        else 'Normal' end as "maintenanceSeverity"
    from public.control_cases c
    left join public.control_case_state_intervals i on i.case_id=c.id
    where ((p_case_id is not null and c.id=p_case_id)
      or (p_case_id is null and c.ticket_state not in ('Concluído','Cancelado')))
      and (c.table_id is null or coalesce(app.can_manage_module_table(c.table_id,'control','read'),true))
    group by c.id
  ) s;
  return result;
end;
$$;
revoke all on function public.control_case_duration_summary(uuid) from public,anon;
grant execute on function public.control_case_duration_summary(uuid) to authenticated;

create index control_cases_priority_level_queue_idx
  on public.control_cases(priority_level,opened_at,id)
  where ticket_state is not null and ticket_state not in ('Concluído','Cancelado');

create or replace function public.control_operational_overview(p_period_start date default null)
returns jsonb language plpgsql stable security definer
set search_path=public,app,pg_temp as $$
declare
  period_start date := coalesce(p_period_start,
    date_trunc('month',timezone('America/Sao_Paulo',now()))::date);
  numbers record; queue_rows jsonb; activity_rows jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa necessária para consultar a Central Operacional.';
  end if;
  select
    count(*) filter (where ticket_state is not null
      and ticket_state not in ('Concluído','Cancelado')) as open_count,
    count(*) filter (where ticket_state = 'Em verificação') as verification_count,
    count(*) filter (where ticket_state = 'Em manutenção') as maintenance_count,
    count(*) filter (where ticket_state in ('Aguardando peça','Aguardando fornecedor',
      'Aguardando retorno')) as waiting_count,
    count(*) filter (where ticket_state = 'Aguardando teste') as testing_count,
    count(*) filter (where priority_level in ('Alta','Crítica') and ticket_state is not null
      and ticket_state not in ('Concluído','Cancelado')) as critical_count,
    count(*) filter (where ticket_state = 'Concluído'
      and closed_at >= (period_start::timestamp at time zone 'America/Sao_Paulo')
      and exists (select 1 from public.control_case_transitions t
        where t.case_id=control_cases.id and t.next_state='Concluído' and t.source<>'backfill')) as completed_period_count,
    round((avg(extract(epoch from (resolved_at-opened_at))/3600)
      filter (where resolved_at is not null
        and resolved_at >= (period_start::timestamp at time zone 'America/Sao_Paulo')
        and resolved_at >= opened_at
        and exists (select 1 from public.control_case_transitions t
          where t.case_id=control_cases.id and t.next_state='Resolvido' and t.source<>'backfill')))::numeric,1)
        as avg_resolution_hours
    into numbers from public.control_cases;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.priority_rank,q.opened_at,q.id),'[]'::jsonb)
  into queue_rows from (
    select c.id,c.control_item_id as "controlItemId",c.table_id as "tableId",
      c.ticket_state as state,c.priority_level as priority,c.equipment,c.tag,c.sector,c.opened_at,
      case c.priority_level when 'Crítica' then 0 when 'Alta' then 1
        when 'Média' then 2 else 3 end as priority_rank,
      floor(extract(epoch from (now()-c.opened_at))/3600)::integer as "ageHours"
    from public.control_cases c
    where c.ticket_state is not null and c.ticket_state not in ('Concluído','Cancelado')
    order by priority_rank,c.opened_at,c.id limit 8
  ) q;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]'::jsonb)
  into activity_rows from (
    select t.id,t.case_id as "caseId",t.next_state as state,t.reason,t.created_at,
      c.control_item_id as "controlItemId",c.table_id as "tableId",c.equipment,c.tag
    from public.control_case_transitions t join public.control_cases c on c.id=t.case_id
    where t.source<>'backfill' order by t.created_at desc,t.id desc limit 6
  ) a;
  return jsonb_build_object('periodStart',period_start,'asOf',now(),
    'metrics',jsonb_build_object('open',numbers.open_count,'verification',numbers.verification_count,
      'maintenance',numbers.maintenance_count,'waiting',numbers.waiting_count,'testing',numbers.testing_count,
      'critical',numbers.critical_count,'completedPeriod',numbers.completed_period_count,
      'avgResolutionHours',numbers.avg_resolution_hours,'overdue',null),
    'queue',queue_rows,'activity',activity_rows,'interventionsAvailable',false,'tasksAvailable',false);
end;
$$;

create or replace function public.list_control_cases(
  p_tab text default 'all',p_query text default '',p_state text default '',
  p_priority text default '',p_page integer default 1,p_page_size integer default 25
) returns jsonb language plpgsql stable security definer
set search_path=public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa necessária para consultar chamados.';
  end if;
  if p_tab not in ('all','active','history') or p_page is null or p_page<1
    or p_page_size not in (10,25,50,100) or char_length(coalesce(p_query,''))>100 then
    raise exception 'Filtros ou paginação inválidos para a Central Operacional.';
  end if;
  with filtered as materialized (
    select c.id,c.control_item_id,c.table_id,t.name as table_name,
      c.source_module,c.source_id,c.followup_kind,c.ticket_state,c.priority_level as priority,
      c.equipment,c.tag,c.serial,c.sector,c.opened_at,c.updated_at,c.resolved_at,c.closed_at,c.requires_review
    from public.control_cases c left join public.module_tables t on t.id=c.table_id
    where (p_tab='all'
      or (p_tab='active' and c.ticket_state is not null and c.ticket_state not in ('Concluído','Cancelado'))
      or (p_tab='history' and c.ticket_state in ('Concluído','Cancelado')))
      and (coalesce(p_state,'')='' or c.ticket_state=p_state)
      and (coalesce(p_priority,'')='' or c.priority_level=p_priority)
      and (btrim(coalesce(p_query,''))='' or c.equipment ilike '%'||btrim(p_query)||'%'
        or c.tag ilike '%'||btrim(p_query)||'%' or c.serial ilike '%'||btrim(p_query)||'%'
        or c.sector ilike '%'||btrim(p_query)||'%' or t.name ilike '%'||btrim(p_query)||'%')
  ), page_rows as (
    select * from filtered
    order by case when p_tab='active' then
      case priority when 'Crítica' then 0 when 'Alta' then 1 when 'Média' then 2 else 3 end end,
      case when p_tab='active' then opened_at end,
      case when p_tab<>'active' then coalesce(closed_at,updated_at) end desc,id desc
    limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'items',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.control_operational_overview(date) from public,anon;
grant execute on function public.control_operational_overview(date) to authenticated;
revoke all on function public.list_control_cases(text,text,text,text,integer,integer) from public,anon;
grant execute on function public.list_control_cases(text,text,text,text,integer,integer) to authenticated;
commit;
