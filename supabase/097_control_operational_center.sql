-- ALDECKOT | Etapa 04: leitura operacional dos casos técnicos.
-- Aplicar após 095/096, somente depois de homologação e backup.
-- Não altera estados nem faz reconciliação de dados legados.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.control_case_transitions') is null
    or to_regprocedure('app.has_active_account()') is null then
    raise exception 'A arquitetura de chamados (095) deve estar aplicada antes da 097.';
  end if;
end;
$preflight$;

create index control_cases_operational_queue_idx on public.control_cases
  (priority,opened_at,id)
  where ticket_state is not null and ticket_state not in ('Concluído','Cancelado');
create index control_cases_operational_closed_idx on public.control_cases
  (closed_at desc,id) where ticket_state = 'Concluído';

create or replace function public.control_operational_overview(p_period_start date default null)
returns jsonb language plpgsql stable security definer
set search_path = public,app,pg_temp as $$
declare
  period_start date := coalesce(p_period_start,
    date_trunc('month',timezone('America/Sao_Paulo',now()))::date);
  numbers record;
  queue_rows jsonb;
  activity_rows jsonb;
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
    count(*) filter (where priority = 'Alta' and ticket_state is not null
      and ticket_state not in ('Concluído','Cancelado')) as critical_count,
    count(*) filter (where ticket_state = 'Concluído'
      and closed_at >= (period_start::timestamp at time zone 'America/Sao_Paulo')
      and exists (select 1 from public.control_case_transitions t
        where t.case_id = control_cases.id and t.next_state = 'Concluído'
          and t.source <> 'backfill')) as completed_period_count,
    round((avg(extract(epoch from (resolved_at - opened_at)) / 3600)
      filter (where resolved_at is not null
        and resolved_at >= (period_start::timestamp at time zone 'America/Sao_Paulo')
        and resolved_at >= opened_at
        and exists (select 1 from public.control_case_transitions t
          where t.case_id = control_cases.id and t.next_state = 'Resolvido'
            and t.source <> 'backfill')))::numeric,1) as avg_resolution_hours
    into numbers from public.control_cases;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.priority_rank,q.opened_at,q.id),'[]'::jsonb)
    into queue_rows from (
      select c.id,c.control_item_id as "controlItemId",c.table_id as "tableId",
        c.ticket_state as "state",c.priority,c.equipment,c.tag,c.sector,
        c.opened_at,case c.priority when 'Alta' then 0 when 'Média' then 1 else 2 end
          as priority_rank,
        floor(extract(epoch from (now()-c.opened_at))/3600)::integer as "ageHours"
      from public.control_cases c
      where c.ticket_state is not null
        and c.ticket_state not in ('Concluído','Cancelado')
      order by priority_rank,c.opened_at,c.id limit 8
    ) q;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc),'[]'::jsonb)
    into activity_rows from (
      select t.id,t.case_id as "caseId",t.next_state as "state",
        t.reason,t.created_at,c.control_item_id as "controlItemId",
        c.table_id as "tableId",c.equipment,c.tag
      from public.control_case_transitions t
      join public.control_cases c on c.id = t.case_id
      where t.source <> 'backfill'
      order by t.created_at desc,t.id desc limit 6
    ) a;

  return jsonb_build_object(
    'periodStart',period_start,'asOf',now(),
    'metrics',jsonb_build_object(
      'open',numbers.open_count,'verification',numbers.verification_count,
      'maintenance',numbers.maintenance_count,'waiting',numbers.waiting_count,
      'testing',numbers.testing_count,'critical',numbers.critical_count,
      'completedPeriod',numbers.completed_period_count,
      'avgResolutionHours',numbers.avg_resolution_hours,
      'overdue',null),
    'queue',queue_rows,'activity',activity_rows,
    'interventionsAvailable',false,'tasksAvailable',false);
end;
$$;
revoke all on function public.control_operational_overview(date) from public,anon;
grant execute on function public.control_operational_overview(date) to authenticated;

create or replace function public.list_control_cases(
  p_tab text default 'all',p_query text default '',p_state text default '',
  p_priority text default '',p_page integer default 1,p_page_size integer default 25
) returns jsonb language plpgsql stable security definer
set search_path = public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa necessária para consultar chamados.';
  end if;
  if p_tab not in ('all','active','history') or p_page is null or p_page < 1
    or p_page_size not in (10,25,50,100)
    or char_length(coalesce(p_query,'')) > 100 then
    raise exception 'Filtros ou paginação inválidos para a Central Operacional.';
  end if;
  with filtered as materialized (
    select c.id,c.control_item_id,c.table_id,t.name as table_name,
      c.source_module,c.source_id,c.followup_kind,c.ticket_state,c.priority,
      c.equipment,c.tag,c.serial,c.sector,c.opened_at,c.updated_at,
      c.resolved_at,c.closed_at,c.requires_review
    from public.control_cases c
    left join public.module_tables t on t.id = c.table_id
    where (p_tab = 'all'
      or (p_tab = 'active' and c.ticket_state is not null
        and c.ticket_state not in ('Concluído','Cancelado'))
      or (p_tab = 'history' and c.ticket_state in ('Concluído','Cancelado')))
      and (coalesce(p_state,'') = '' or c.ticket_state = p_state)
      and (coalesce(p_priority,'') = '' or c.priority = p_priority)
      and (btrim(coalesce(p_query,'')) = '' or
        c.equipment ilike '%' || btrim(p_query) || '%' or
        c.tag ilike '%' || btrim(p_query) || '%' or
        c.serial ilike '%' || btrim(p_query) || '%' or
        c.sector ilike '%' || btrim(p_query) || '%' or
        t.name ilike '%' || btrim(p_query) || '%')
  ), page_rows as (
    select * from filtered
    order by case when p_tab = 'active' then
      case priority when 'Alta' then 0 when 'Média' then 1 else 2 end end,
      case when p_tab = 'active' then opened_at end,
      case when p_tab <> 'active' then coalesce(closed_at,updated_at) end desc,
      id desc
    limit p_page_size offset (p_page-1)*p_page_size
  )
  select jsonb_build_object(
    'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size,
    'items',coalesce((select jsonb_agg(to_jsonb(p)) from page_rows p),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.list_control_cases(text,text,text,text,integer,integer)
  from public,anon;
grant execute on function public.list_control_cases(text,text,text,text,integer,integer)
  to authenticated;
commit;
