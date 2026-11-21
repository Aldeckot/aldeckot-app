begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

do $test$
declare result jsonb; denied boolean:=false;
  c_id uuid:='00000000-0000-4000-8000-000000000021';
begin
  begin
    update public.control_cases set ticket_state='Concluído',closed_at=now() where id=c_id;
  exception when others then
    if SQLERRM like 'Registre a resolução estruturada%' then denied:=true;
    else raise; end if;
  end;
  if not denied then raise exception 'Manual completion without a structured resolution was accepted'; end if;
  result:=public.resolve_control_case(c_id,
    '{"finalDiagnosis":"Falha fictícia identificada","solution":"Solução fictícia aplicada","tests":"Teste funcional aprovado","failureCategory":"Alimentação elétrica","finalCondition":"Ativo","observations":"Primeira resolução"}'::jsonb,
    '00000000-0000-4000-8000-000000000992');
  if not exists(select 1 from public.control_cases where id=c_id
      and ticket_state='Resolvido' and resolved_at is not null and closed_at is null) then
    raise exception 'Resolution must be recorded before formal completion';
  end if;

  result:=public.reopen_control_case(c_id,'Falha voltou após o teste',
    '00000000-0000-4000-8000-000000000993');
  if result->>'reopened'<>'true' or result->>'alreadyApplied'<>'false'
    or not exists(select 1 from public.control_cases where id=c_id
      and ticket_state='Em diagnóstico' and resolved_at is null and closed_at is null) then
    raise exception 'Manual reopen should return the same case to diagnosis';
  end if;
  if not exists(select 1 from public.control_case_transitions
      where request_id='00000000-0000-4000-8000-000000000992'
        and previous_state='Em manutenção' and next_state='Resolvido')
    or not exists(select 1 from public.control_case_transitions
      where request_id='00000000-0000-4000-8000-000000000993'
        and previous_state='Resolvido' and next_state='Em diagnóstico'
        and reason='Falha voltou após o teste') then
    raise exception 'Resolution and reopen must remain separately linked in the case history';
  end if;
  if (select metadata->>'physicalMovement' from public.equipment_events
      where source_event_key='case-transition:00000000-0000-4000-8000-000000000993')<>'false' then
    raise exception 'Reopening a case must not create a physical movement';
  end if;
  result:=public.reopen_control_case(c_id,'Falha voltou após o teste',
    '00000000-0000-4000-8000-000000000993');
  if result->>'alreadyApplied'<>'true'
    or (select count(*) from public.control_case_transitions
      where request_id='00000000-0000-4000-8000-000000000993')<>1 then
    raise exception 'Retry must not duplicate a reopen transition';
  end if;

  result:=public.resolve_control_case(c_id,
    '{"finalDiagnosis":"Nova falha fictícia identificada","solution":"Nova solução fictícia","tests":"Novo teste funcional aprovado","failureCategory":"Alimentação elétrica","finalCondition":"Ativo","observations":"Segunda resolução após reabertura"}'::jsonb,
    '00000000-0000-4000-8000-000000000994');
  perform public.close_control_case_with_tasks(c_id,'Concluído após validação',
    '00000000-0000-4000-8000-000000000995','{}'::uuid[],null);
  begin
    perform public.reopen_control_case(c_id,'Tentativa após conclusão',
      '00000000-0000-4000-8000-000000000996');
    raise exception 'A concluded ticket was reopened';
  exception when others then
    if SQLERRM not like 'Somente um chamado resolvido pode ser reaberto%' then raise; end if;
  end;
  if not exists(select 1 from public.control_cases where id=c_id
      and ticket_state='Concluído' and closed_at is not null) then
    raise exception 'Conclusion must remain terminal';
  end if;
  insert into public.control_cases(id,table_id,source_module,source_id,followup_kind,
    ticket_state,equipment,tag,serial,sector,opened_at,resolved_at,closed_at)
  select '00000000-0000-4000-8000-000000000022',c.table_id,c.source_module,c.source_id,
    'maintenance','Concluído',c.equipment,c.tag,c.serial,c.sector,
    now()-interval '10 days',now()-interval '9 days',now()-interval '9 days'
  from public.control_cases c where c.id=c_id;
  insert into public.control_case_resolutions(case_id,request_id,final_diagnosis,
    solution,tests,final_condition,failure_category,actor_id,created_at)
  values('00000000-0000-4000-8000-000000000022',
    '00000000-0000-4000-8000-000000000997','Falha fictícia recorrente',
    'Componente fictício substituído','Teste funcional aprovado','Ativo',
    'Alimentação elétrica','00000000-0000-4000-8000-000000000001',now()-interval '9 days');
  -- Reutilização da TAG com outro UUID físico não pode acrescentar ao mesmo histórico.
  insert into public.control_cases(id,table_id,source_module,source_id,followup_kind,
    ticket_state,equipment,tag,serial,sector,opened_at,resolved_at,closed_at)
  select '00000000-0000-4000-8000-000000000023',c.table_id,c.source_module,
    '00000000-0000-4000-8000-000000000998','maintenance','Concluído',
    c.equipment,c.tag,'SERIE-DIFERENTE',c.sector,now()-interval '4 days',
    now()-interval '3 days',now()-interval '3 days'
  from public.control_cases c where c.id=c_id;
  insert into public.control_case_resolutions(case_id,request_id,final_diagnosis,
    solution,tests,final_condition,failure_category,actor_id,created_at)
  values('00000000-0000-4000-8000-000000000023',
    '00000000-0000-4000-8000-000000000996','Falha fictícia de outro equipamento',
    'Solução independente','Teste aprovado','Ativo','Alimentação elétrica',
    '00000000-0000-4000-8000-000000000001',now()-interval '3 days');
  result:=public.control_case_recurrence(c_id);
  if result->>'available'<>'true' or result->>'occurrenceCount'<>'2'
    or result->>'likelyRecurrence'<>'true'
    or result->'categories'->0->>'category'<>'Alimentação elétrica'
    or result->'categories'->0->>'occurrences'<>'2'
    or result->'categories'->0->'references'->0->>'previousCaseId'<>'00000000-0000-4000-8000-000000000022' then
    raise exception 'Repeated structured category should provide deterministic evidence and prior case references';
  end if;
  insert into public.control_case_interventions(case_id,request_id,occurred_at,
    intervention_type,description,result)
  values
    ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000998',now()-interval '8 days','Inspeção','Primeira intervenção fictícia','Inspeção concluída'),
    ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000999',now()-interval '7 days','Reparo','Segunda intervenção fictícia','Reparo concluído');
  result:=public.control_case_report(jsonb_build_object(
    'periodStart',(now()-interval '30 days')::date::text,
    'periodEnd',now()::date::text,
    'sector',(select sector from public.control_cases where id=c_id),
    'category','Alimentação elétrica','origin','control','maintenanceMode','internal'));
  if result->'metrics'->>'cases'<>'3'
    or result->'metrics'->>'interventions'<>'2'
    or (select count(*) from jsonb_array_elements(result->'casesList'))<>3
    or (select count(*) from jsonb_array_elements(result->'casesList') r
      where r->>'id'='00000000-0000-4000-8000-000000000022'
        and r->>'interventions'='2')<>1 then
    raise exception 'Report must count three distinct cases and keep two interventions separate: %',result;
  end if;
end
$test$;
rollback;
