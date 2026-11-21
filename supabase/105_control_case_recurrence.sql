-- ALDECKOT | Etapa 11: recorrência determinística por identidade estável.
begin;

do $preflight$
begin
  if to_regclass('public.control_case_resolutions') is null
    or to_regclass('public.control_case_components') is null
    or to_regclass('public.control_case_component_events') is null then
    raise exception 'As migrações de resolução e componentes devem estar aplicadas antes da 105.';
  end if;
end;
$preflight$;

alter table public.control_case_resolutions
  add column failure_category text;
alter table public.control_case_resolutions
  add constraint control_case_resolution_category_check
  check (failure_category is null or failure_category in (
    'Alimentação elétrica','Conectividade / rede','Armazenamento',
    'Memória / desempenho','Vídeo / tela','Periféricos','Sistema / software',
    'Refrigeração','Mecânica / estrutura','Outro'));
create index control_case_resolution_category_idx
  on public.control_case_resolutions(case_id,failure_category,created_at desc);

create or replace function public.resolve_control_case(
  p_case_id uuid,p_payload jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare
  c public.control_cases%rowtype;
  prior public.control_case_resolutions%rowtype;
  diagnosis text:=btrim(coalesce(p_payload->>'finalDiagnosis',''));
  solution_text text:=btrim(coalesce(p_payload->>'solution',''));
  tests_text text:=btrim(coalesce(p_payload->>'tests',''));
  condition_text text:=btrim(coalesce(p_payload->>'finalCondition',''));
  category_text text:=btrim(coalesce(p_payload->>'failureCategory',''));
  notes text:=btrim(coalesce(p_payload->>'observations',''));
  transition_result jsonb;
  resolution_id uuid;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or jsonb_typeof(p_payload) is distinct from 'object'
    or char_length(diagnosis) not between 3 and 2000
    or char_length(solution_text) not between 3 and 2000
    or char_length(tests_text) not between 3 and 2000
    or char_length(notes)>2000
    or condition_text not in ('Ativo','Reserva','Não se aplica')
    or category_text not in ('Alimentação elétrica','Conectividade / rede',
      'Armazenamento','Memória / desempenho','Vídeo / tela','Periféricos',
      'Sistema / software','Refrigeração','Mecânica / estrutura','Outro') then
    raise exception 'Informe diagnóstico final, solução, testes, categoria, condição final e os limites válidos.';
  end if;
  select * into c from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if c.table_id is null or not coalesce(
    app.can_manage_module_table(c.table_id,'control','update'),false) then
    raise exception 'Sem permissão para resolver este chamado.';
  end if;
  if c.source_module='inventory' and condition_text not in ('Ativo','Reserva') then
    raise exception 'Para equipamento do Inventário, confirme a condição final como Ativo ou Reserva.';
  end if;
  select * into prior from public.control_case_resolutions where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.final_diagnosis<>diagnosis
      or prior.solution<>solution_text or prior.tests<>tests_text
      or prior.final_condition<>condition_text or prior.observations<>notes
      or prior.failure_category<>category_text then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('id',prior.id,'caseId',p_case_id,
      'state','Resolvido','alreadyApplied',true);
  end if;
  if c.ticket_state in ('Resolvido','Concluído','Cancelado') then
    raise exception 'Chamado já resolvido ou encerrado; reabra manualmente antes de registrar nova resolução.';
  end if;
  insert into public.control_case_resolutions(case_id,request_id,final_diagnosis,
    solution,tests,final_condition,observations,failure_category,actor_id)
  values(p_case_id,p_request_id,diagnosis,solution_text,tests_text,
    condition_text,notes,category_text,auth.uid()) returning id into resolution_id;
  transition_result:=public.transition_control_case(p_case_id,'Resolvido',
    left('Resolução registrada. Diagnóstico: '||diagnosis||' · Solução: '||solution_text,2000),
    p_request_id);
  update public.control_cases set solution=solution_text where id=p_case_id;
  return jsonb_build_object('id',resolution_id,'caseId',p_case_id,
    'state','Resolvido','alreadyApplied',false,'eventId',transition_result->'eventId');
end;
$$;

create function public.control_case_recurrence(p_case_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=public,app,pg_temp as $$
declare
  current_case public.control_cases%rowtype;
  categories jsonb;
  recent_cases jsonb;
  occurrence_count integer;
  likely boolean;
begin
  if auth.uid() is null or not app.has_active_account() or p_case_id is null then
    raise exception 'Conta ativa e chamado são necessários para consultar reincidências.';
  end if;
  select * into current_case from public.control_cases where id=p_case_id;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if current_case.table_id is null or not coalesce(
    app.can_manage_module_table(current_case.table_id,'control','read'),false) then
    raise exception 'Sem permissão para consultar o histórico deste chamado.';
  end if;
  if current_case.requires_review then
    return jsonb_build_object('available',false,'reason',
      'O vínculo de identidade requer revisão; TAG e série não são usados para unir históricos.');
  end if;
  select count(*)::integer into occurrence_count
  from public.control_cases c
  where c.source_module=current_case.source_module
    and c.source_id=current_case.source_id and not c.requires_review
    and c.ticket_state is not null;

  with latest_per_case as (
    select distinct on(c.id) r.failure_category,r.created_at,c.id,c.ticket_state,
      c.opened_at,c.resolved_at,r.final_diagnosis,r.solution
    from public.control_case_resolutions r
    join public.control_cases c on c.id=r.case_id
    where c.source_module=current_case.source_module
      and c.source_id=current_case.source_id and not c.requires_review
      and r.failure_category is not null and r.failure_category<>'Outro'
    order by c.id,r.created_at desc,r.id desc
  ), history as (
    select r.failure_category,r.created_at,c.id,c.ticket_state,c.opened_at,c.resolved_at,
      r.final_diagnosis,r.solution,
      lag(r.created_at) over(partition by r.failure_category order by r.created_at,r.id) as previous_at,
      lag(c.id) over(partition by r.failure_category order by r.created_at,r.id) as previous_case_id
    from latest_per_case r
    join public.control_cases c on c.id=r.id
  ), grouped as (
    select h.failure_category,count(*)::integer as occurrences,
      round(avg(extract(epoch from (h.created_at-h.previous_at))/86400.0)
        filter(where h.previous_at is not null),1) as average_interval_days,
      jsonb_agg(jsonb_build_object('caseId',h.id,'state',h.ticket_state,
        'openedAt',h.opened_at,'resolvedAt',h.resolved_at,'diagnosis',h.final_diagnosis,
        'solution',h.solution,'previousCaseId',h.previous_case_id,
        'intervalDays',case when h.previous_at is null then null else
          round((extract(epoch from (h.created_at-h.previous_at))/86400.0)::numeric,1) end)
        order by h.created_at desc) as case_references
    from history h group by h.failure_category
  )
  select coalesce(jsonb_agg(jsonb_build_object('category',failure_category,
    'occurrences',occurrences,'averageIntervalDays',average_interval_days,
    'references',case_references) order by occurrences desc,failure_category),'[]'::jsonb),
    coalesce(bool_or(occurrences>=2),false)
  into categories,likely from grouped;

  select coalesce(jsonb_agg(to_jsonb(entry) order by entry.opened_at desc,entry.id),'[]'::jsonb)
  into recent_cases
  from (
    select c.id,c.ticket_state as state,c.opened_at,c.resolved_at,
      r.failure_category as category,r.final_diagnosis as diagnosis,r.solution,
      r.final_condition as "finalCondition",
      (select (value->>'maintenanceMinutes')::bigint
        from jsonb_array_elements(public.control_case_duration_summary(c.id)) value limit 1)
        as "maintenanceMinutes",
      coalesce((select jsonb_agg(jsonb_build_object('name',co.component_name,
          'action',ev.action,'occurredAt',ev.occurred_at,'result',ev.result)
        order by ev.occurred_at desc,ev.id)
        from public.control_case_components co
        join public.control_case_component_events ev on ev.component_id=co.id
        where co.case_id=c.id and ev.action='Substituído'),'[]'::jsonb) as "replacedParts"
    from public.control_cases c
    left join lateral (select r.* from public.control_case_resolutions r
      where r.case_id=c.id order by r.created_at desc,r.id desc limit 1) r on true
    where c.source_module=current_case.source_module
      and c.source_id=current_case.source_id and not c.requires_review
      and c.ticket_state is not null
    order by c.opened_at desc,c.id desc limit 10
  ) entry;

  return jsonb_build_object('available',true,'sourceModule',current_case.source_module,
    'sourceId',current_case.source_id,'equipment',current_case.equipment,
    'tag',current_case.tag,'occurrenceCount',occurrence_count,
    'likelyRecurrence',likely,'categories',categories,'recentCases',recent_cases,
    'signalBasis','Mesmo UUID de origem e mesma categoria técnica estruturada; indício, não diagnóstico automático.');
end;
$$;
revoke all on function public.control_case_recurrence(uuid) from public,anon;
grant execute on function public.control_case_recurrence(uuid) to authenticated;

comment on function public.control_case_recurrence(uuid) is
  'Agrupa episódios somente pelo par exato source_module/source_id; nunca por TAG, série ou similaridade textual.';
commit;
