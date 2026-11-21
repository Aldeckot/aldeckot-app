-- ALDECKOT | Etapa 12: relatórios e indicadores do Controle TI.
-- Consultas por chamado único; intervenções e tarefas são agregadas separadamente.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.control_case_resolutions') is null
    or to_regclass('public.control_case_interventions') is null
    or to_regclass('public.control_case_tasks') is null
    or to_regclass('public.control_case_component_events') is null then
    raise exception 'As migrações 095–105 devem estar aplicadas antes da 106.';
  end if;
end;
$preflight$;

create function public.control_case_report(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer
set search_path=public,app,pg_temp as $$
declare
  filters jsonb:=case when jsonb_typeof(p_filters)='object' then p_filters else '{}'::jsonb end;
  date_start date;
  date_end date;
  result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Sessão ativa necessária para consultar relatórios.';
  end if;
  date_end:=coalesce(nullif(filters->>'periodEnd','')::date,(now() at time zone 'America/Sao_Paulo')::date);
  date_start:=coalesce(nullif(filters->>'periodStart','')::date,date_end-29);
  if date_end<date_start or date_end-date_start>365 then
    raise exception 'Informe um período válido de até 366 dias.';
  end if;
  if coalesce(filters->>'state','') not in ('','Aberto','Em verificação','Em diagnóstico','Em manutenção','Aguardando peça','Aguardando fornecedor','Aguardando retorno','Aguardando teste','Resolvido','Concluído','Cancelado')
    or coalesce(filters->>'priority','') not in ('','Crítica','Alta','Média','Baixa','Estável')
    or coalesce(filters->>'origin','') not in ('','control','inventory','management','supplies')
    or coalesce(filters->>'maintenanceMode','all') not in ('all','internal','external') then
    raise exception 'Um dos filtros do relatório é inválido.';
  end if;

  with latest_resolution as (
    select distinct on(r.case_id) r.case_id,r.failure_category,r.created_at,
      r.final_diagnosis,r.solution,r.tests,r.final_condition
    from public.control_case_resolutions r
    order by r.case_id,r.created_at desc,r.id desc
  ), filtered as (
    select c.*,lr.failure_category,lr.final_diagnosis,lr.solution as resolved_solution,lr.tests,
      lr.final_condition,lr.created_at as resolution_at,
      coalesce((select sum((value->>'maintenanceMinutes')::numeric)
        from jsonb_array_elements(public.control_case_duration_summary(c.id)) value),0) as maintenance_minutes,
      exists(select 1 from public.control_case_component_events ev
        where ev.case_id=c.id and ev.action in ('Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor')) as has_external
    from public.control_cases c
    left join latest_resolution lr on lr.case_id=c.id
    where c.opened_at >= (date_start::timestamp at time zone 'America/Sao_Paulo')
      and c.opened_at < ((date_end+1)::timestamp at time zone 'America/Sao_Paulo')
      and c.table_id is not null
      and coalesce(app.can_manage_module_table(c.table_id,'control','read'),false)
      and (coalesce(filters->>'sector','')='' or c.sector=filters->>'sector')
      and (coalesce(filters->>'category','')='' or lr.failure_category=filters->>'category')
      and (coalesce(filters->>'state','')='' or c.ticket_state=filters->>'state')
      and (coalesce(filters->>'priority','')='' or c.priority_level=filters->>'priority')
      and (coalesce(filters->>'origin','')='' or c.source_module=filters->>'origin')
      and (coalesce(filters->>'maintenanceMode','all')='all'
        or (filters->>'maintenanceMode'='external' and exists(select 1 from public.control_case_component_events ev
          where ev.case_id=c.id and ev.action in ('Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor')))
        or (filters->>'maintenanceMode'='internal' and not exists(select 1 from public.control_case_component_events ev
          where ev.case_id=c.id and ev.action in ('Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor'))))
  ), recurrence as (
    select f.id, count(distinct same.id)::integer as same_category_cases
    from filtered f left join public.control_cases same
      on same.source_module=f.source_module and same.source_id=f.source_id and same.id<>f.id
      and not same.requires_review
      and same.table_id is not null
      and coalesce(app.can_manage_module_table(same.table_id,'control','read'),false)
      and exists(select 1 from public.control_case_resolutions sr
        where sr.case_id=same.id and sr.failure_category=f.failure_category)
    group by f.id
  ), rows as (
    select f.*,coalesce(r.same_category_cases,0) as recurrence_count,
      coalesce((select count(*) from public.control_case_interventions i where i.case_id=f.id),0)::integer as intervention_count,
      coalesce((select count(*) from public.control_case_tasks t where t.case_id=f.id
        and t.task_state in ('Pendente','Em andamento') and t.due_at<now()),0)::integer as overdue_count
    from filtered f left join recurrence r on r.id=f.id
  )
  select jsonb_build_object(
    'periodStart',date_start,'periodEnd',date_end,
    'metrics',jsonb_build_object(
      'cases',count(*),'resolvedCases',count(*) filter(where ticket_state in ('Resolvido','Concluído')),
      'resolutionRate',case when count(*)=0 then 0 else round(100.0*count(*) filter(where ticket_state in ('Resolvido','Concluído'))/count(*),1) end,
      'avgResolutionHours',round(avg(extract(epoch from (coalesce(resolved_at,closed_at)-opened_at))/3600.0)
        filter(where coalesce(resolved_at,closed_at) is not null),1),
      'avgMaintenanceMinutes',round(avg(maintenance_minutes),1),
      'recurrences',count(*) filter(where recurrence_count>0),
      'overdueTasks',(select count(*) from public.control_case_tasks t join filtered fc on fc.id=t.case_id
        where t.task_state in ('Pendente','Em andamento') and t.due_at<now()),
      'interventions',coalesce(sum(intervention_count),0)),
    'states',coalesce((select jsonb_agg(jsonb_build_object('label',coalesce(ticket_state,'Sem estado'),'count',n) order by n desc,coalesce(ticket_state,'Sem estado'))
      from (select ticket_state,count(*) n from filtered group by ticket_state) s),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object('label',day,'count',n) order by day)
      from (select (opened_at at time zone 'America/Sao_Paulo')::date as day,count(*) n from filtered group by 1) t),'[]'::jsonb),
    'resolutionTimes',coalesce((select jsonb_agg(jsonb_build_object('label',label,'count',hours) order by hours desc,label)
      from (select coalesce(nullif(sector,''),'Não informado') as label,
        round(avg(extract(epoch from (coalesce(resolved_at,closed_at)-opened_at))/3600.0),1) as hours
        from filtered where coalesce(resolved_at,closed_at) is not null group by sector) durations),'[]'::jsonb),
    'sectors',coalesce((select jsonb_agg(jsonb_build_object('label',coalesce(nullif(sector,''),'Não informado'),'count',n) order by n desc,coalesce(nullif(sector,''),'Não informado'))
      from (select sector,count(*) n from filtered group by sector) s),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object('label',coalesce(failure_category,'Sem categoria'),'count',n) order by n desc,coalesce(failure_category,'Sem categoria'))
      from (select failure_category,count(*) n from filtered group by failure_category) s),'[]'::jsonb),
    'origins',coalesce((select jsonb_agg(jsonb_build_object('label',source_module,'count',n) order by n desc,source_module)
      from (select source_module,count(*) n from filtered group by source_module) s),'[]'::jsonb),
    'casesList',coalesce((select jsonb_agg(jsonb_build_object('id',id,'equipment',equipment,'tag',tag,'sector',sector,
      'state',ticket_state,'priority',priority_level,'origin',source_module,'category',failure_category,'openedAt',opened_at,
      'resolvedAt',coalesce(resolved_at,closed_at),'maintenanceMinutes',maintenance_minutes,
      'interventions',intervention_count,'recurrence',recurrence_count>0,'diagnosis',final_diagnosis,'solution',resolved_solution)
      order by opened_at desc,id) from (select * from rows order by opened_at desc,id limit 5000) listed),'[]'::jsonb),
    'truncated',(select count(*)>5000 from filtered))
  into result from rows;
  return result;
end;
$$;
revoke all on function public.control_case_report(jsonb) from public,anon;
grant execute on function public.control_case_report(jsonb) to authenticated;
comment on function public.control_case_report(jsonb) is
  'Indicadores filtráveis do Controle TI; conta chamados distintos e agrega intervenções/tarefas separadamente.';
commit;
