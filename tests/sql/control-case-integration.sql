-- Runs inside the offline PostgreSQL container. All rows are fictional and rolled back.
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

insert into public.module_tables (id,module,name)
values ('00000000-0000-4000-8000-000000000010','control','Chamados de teste');
insert into public.control_items
  (id,table_id,equipment,model,serial,tag,sector,status,followup_kind)
values
  ('00000000-0000-4000-8000-000000000020',
   '00000000-0000-4000-8000-000000000010',
   'Notebook fictício','Modelo local','SERIAL-TESTE-001','TAG-TESTE-001',
   'Setor fictício','Aguardando avaliação','maintenance');

do $$
begin
  if (select count(*) from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020') <> 1 then
    raise exception 'New maintenance did not create exactly one case';
  end if;
  if not exists (select 1 from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020' and source_module = 'control'
      and ticket_state = 'Em diagnóstico' and followup_kind = 'maintenance') then
    raise exception 'Initial maintenance case has wrong identity/state';
  end if;
end $$;
select id as test_case_id from public.control_cases where control_item_id =
  '00000000-0000-4000-8000-000000000020' \gset

set local role authenticated;
do $$
declare detail jsonb;
begin
  detail := public.get_control_case_detail(
    (select id from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020'));
  if detail->'case'->>'source_module' <> 'control'
    or detail->'item'->>'serial' <> 'SERIAL-TESTE-001'
    or detail->>'location' is not null
    or jsonb_array_length(detail->'movements') <> 0 then
    raise exception 'Control-only case must open without inventory or fake movement';
  end if;
end $$;
select public.append_control_case_diagnostic(:'test_case_id',
  '{"symptom":"Não liga","hypothesis":"Fonte","tests":"Medição","results":"Sem tensão"}'::jsonb,
  '00000000-0000-4000-8000-000000000041');
select public.append_control_case_diagnostic(:'test_case_id',
  '{"symptom":"Não liga","hypothesis":"Fonte","tests":"Medição","results":"Sem tensão","cause":"Fonte defeituosa"}'::jsonb,
  '00000000-0000-4000-8000-000000000042');
do $$
declare result jsonb; detail jsonb; conflict_rejected boolean := false;
begin
  result := public.append_control_case_diagnostic(
    (select id from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020'),
    '{"symptom":"Não liga","hypothesis":"Fonte","tests":"Medição","results":"Sem tensão","cause":"Fonte defeituosa"}'::jsonb,
    '00000000-0000-4000-8000-000000000042');
  detail := public.get_control_case_detail(
    (select id from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020'));
  if result->>'alreadyApplied' <> 'true' or jsonb_array_length(detail->'diagnostics') <> 2
    or detail->'diagnostics'->0->>'revision' <> '2'
    or detail->'diagnostics'->1->>'revision' <> '1' then
    raise exception 'Diagnostic revisions or idempotency failed';
  end if;
  begin
    perform public.append_control_case_diagnostic(
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020'),
      '{"symptom":"Outro defeito"}'::jsonb,
      '00000000-0000-4000-8000-000000000042');
  exception when others then
    if SQLERRM like 'Identificador de operação já usado%' then conflict_rejected := true;
    else raise; end if;
  end;
  if not conflict_rejected then raise exception 'Request ID accepted different diagnostic'; end if;
end $$;
select public.append_control_case_intervention(:'test_case_id',
  jsonb_build_object('occurredAt',(now()-make_interval(days=>6-n))::text,
    'type',case n when 1 then 'Inspeção' when 2 then 'Diagnóstico'
      when 3 then 'Limpeza' when 4 then 'Reparo' else 'Teste funcional' end,
    'description','Ação técnica fictícia ' || n,'result','Resultado fictício ' || n,
    'technicalAuthor',case when n=1 then 'Técnico local' else '' end,
    'referenceNote',case when n=2 then 'OS-TESTE-002' else '' end),
  ('00000000-0000-4000-8000-' || lpad((50+n)::text,12,'0'))::uuid)
from generate_series(1,5) n;
do $$
declare recent jsonb; retry jsonb; conflicting boolean := false;
  future_rejected boolean := false;
begin
  if (select count(*) from public.control_case_interventions where case_id =
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020')) <> 5
    or (select count(distinct occurred_at::date) from public.control_case_interventions
      where case_id = (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020')) <> 5
    or (select count(*) from public.control_case_interventions where contextual_state =
      'Em diagnóstico' and technical_author = '') <> 4
    or (select count(*) from public.control_case_transitions where source='manual') <> 0 then
    raise exception 'Five dated interventions changed state or required technical author';
  end if;
  recent := public.recent_control_case_interventions();
  if jsonb_array_length(recent) <> 5
    or recent->0->>'type' <> 'Teste funcional'
    or recent->4->>'type' <> 'Inspeção' then
    raise exception 'Intervention chronology or recent projection is incorrect';
  end if;
  retry := public.append_control_case_intervention(
    (select id from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020'),
    jsonb_build_object('occurredAt',(select occurred_at::text
      from public.control_case_interventions where request_id =
        '00000000-0000-4000-8000-000000000051'),
      'type','Inspeção','description','Ação técnica fictícia 1',
      'result','Resultado fictício 1','technicalAuthor','Técnico local'),
    '00000000-0000-4000-8000-000000000051');
  if retry->>'alreadyApplied' <> 'true' then
    raise exception 'Intervention retry was duplicated';
  end if;
  begin
    perform public.append_control_case_intervention(
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020'),
      jsonb_build_object('occurredAt',(select occurred_at::text
        from public.control_case_interventions where request_id =
          '00000000-0000-4000-8000-000000000051'),
        'type','Reparo','description','Outro conteúdo','result','Outro resultado'),
      '00000000-0000-4000-8000-000000000051');
  exception when others then
    if SQLERRM like 'Identificador de operação já usado%' then conflicting := true;
    else raise; end if;
  end;
  begin
    perform public.append_control_case_intervention(
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020'),
      jsonb_build_object('occurredAt',(now()+interval '1 day')::text,
        'type','Reparo','description','Evento futuro'),
      '00000000-0000-4000-8000-000000000056');
  exception when others then
    if SQLERRM like 'Data, tipo ou conteúdo%' then future_rejected := true;
    else raise; end if;
  end;
  if not conflicting or not future_rejected then
    raise exception 'Conflicting retry or future intervention was accepted';
  end if;
end $$;
select public.transition_control_case(
  :'test_case_id','Em manutenção',
  'Diagnóstico de teste','00000000-0000-4000-8000-000000000031');
select public.transition_control_case(
  :'test_case_id','Aguardando peça',
  'Aguardando peça fictícia','00000000-0000-4000-8000-000000000032');
select public.resolve_control_case(:'test_case_id',
  '{"finalDiagnosis":"Falha fictícia confirmada","solution":"Peça fictícia substituída","tests":"Teste funcional aprovado","failureCategory":"Alimentação elétrica","finalCondition":"Ativo","observations":"Fixture isolada"}'::jsonb,
  '00000000-0000-4000-8000-000000000033');
do $$
declare result jsonb;
begin
  result := public.resolve_control_case(
    (select id from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020'),
    '{"finalDiagnosis":"Falha fictícia confirmada","solution":"Peça fictícia substituída","tests":"Teste funcional aprovado","failureCategory":"Alimentação elétrica","finalCondition":"Ativo","observations":"Fixture isolada"}'::jsonb,
    '00000000-0000-4000-8000-000000000033');
  if result->>'alreadyApplied' <> 'true' then
    raise exception 'Idempotent retry was not recognized';
  end if;
  if (select count(*) from public.control_case_resolutions where case_id=
      (select id from public.control_cases where control_item_id=
        '00000000-0000-4000-8000-000000000020'))<>1 then
    raise exception 'Resolution must be auditable and unique for this request';
  end if;
end $$;
-- Etapa 7: tarefas independentes, prazo, auditoria e decisão de conclusão.
select public.create_control_case_task(:'test_case_id',
  jsonb_build_object('description','Trocar fonte fictícia',
    'priority','Alta','dueAt',(now()-interval '1 day')::text,
    'notes','Aguardando peça local'),
  '00000000-0000-4000-8000-000000000061');
select public.create_control_case_task(:'test_case_id',
  jsonb_build_object('description','Testar bancada fictícia',
    'priority','Média','dueAt',(now()+interval '2 days')::text),
  '00000000-0000-4000-8000-000000000062');
select public.create_control_case_task(:'test_case_id',
  jsonb_build_object('description','Registrar relatório fictício',
    'priority','Baixa'),
  '00000000-0000-4000-8000-000000000063');
do $$
declare c_id uuid; task_id uuid; result jsonb; overdue jsonb;
  denied boolean:=false; stale boolean:=false; conflict boolean:=false;
  undecided boolean:=false;
begin
  select id into c_id from public.control_cases where control_item_id =
    '00000000-0000-4000-8000-000000000020';
  select id into task_id from public.control_case_tasks
    where case_id=c_id and description='Testar bancada fictícia';
  result:=public.update_control_case_task(task_id,
    jsonb_build_object('description','Testar bancada fictícia',
      'priority','Média','state','Concluída','revision',1,
      'completionNote','Teste aprovado sem falhas'),
    '00000000-0000-4000-8000-000000000064');
  if result->>'revision'<>'2' then raise exception 'Task revision not updated'; end if;
  result:=public.update_control_case_task(task_id,
    jsonb_build_object('description','Testar bancada fictícia',
      'priority','Média','state','Concluída','revision',1,
      'completionNote','Teste aprovado sem falhas'),
    '00000000-0000-4000-8000-000000000064');
  if result->>'alreadyApplied'<>'true' then raise exception 'Task retry duplicated event'; end if;
  begin
    perform public.update_control_case_task(task_id,
      jsonb_build_object('description','Outro conteúdo','priority','Média',
        'state','Concluída','revision',1,'completionNote','Outra conclusão'),
      '00000000-0000-4000-8000-000000000064');
  exception when others then
    if SQLERRM like 'Identificador de operação já usado%' then conflict:=true;
    else raise; end if;
  end;
  begin
    perform public.update_control_case_task(task_id,
      jsonb_build_object('description','Testar bancada fictícia',
        'priority','Média','state','Concluída','revision',1,
        'completionNote','Teste aprovado sem falhas'),
      '00000000-0000-4000-8000-000000000065');
  exception when others then
    if SQLERRM like 'Pendência alterada em outra sessão%' then stale:=true;
    else raise; end if;
  end;
  overdue:=public.control_overdue_case_tasks();
  if not stale or not conflict or overdue->>'count'<>'1'
    or overdue->'items'->0->>'description'<>'Trocar fonte fictícia'
    or (select count(*) from public.control_case_task_events
      where case_id=c_id)<>4
    or (select count(*) from public.control_case_tasks
      where case_id=c_id and task_state in ('Pendente','Em andamento'))<>2 then
    raise exception 'Task audit, overdue projection or active states incorrect';
  end if;
  begin
    perform public.transition_control_case(c_id,'Concluído',
      'Encerramento sem revisão','00000000-0000-4000-8000-000000000066');
  exception when others then
    if SQLERRM like 'Há pendências abertas%' then denied:=true;
    else raise; end if;
  end;
  if not denied then raise exception 'Open tasks were silently bypassed on closure'; end if;
  denied:=false;
  begin
    perform public.close_control_case_with_tasks(c_id,'Encerramento com lista antiga',
      '00000000-0000-4000-8000-000000000067','{}'::uuid[],'Manter abertas');
  exception when others then
    if SQLERRM like 'A lista de pendências mudou%' then denied:=true;
    else raise; end if;
  end;
  if not denied then raise exception 'Stale task list was accepted on closure'; end if;
  begin
    perform public.close_control_case_with_tasks(c_id,'Encerramento sem decisão',
      '00000000-0000-4000-8000-000000000069',
      (select array_agg(id order by id) from public.control_case_tasks
        where case_id=c_id and task_state in ('Pendente','Em andamento')),
      null);
  exception when others then
    if SQLERRM like 'Escolha explicitamente%' then undecided:=true;
    else raise; end if;
  end;
  if not undecided then raise exception 'Closure without a task decision was accepted'; end if;
  result:=public.close_control_case_with_tasks(c_id,'Encerramento com pendências preservadas',
    '00000000-0000-4000-8000-000000000068',
    (select array_agg(id order by id) from public.control_case_tasks
      where case_id=c_id and task_state in ('Pendente','Em andamento')),
    'Manter abertas');
  if result->>'alreadyApplied'<>'false' then
    raise exception 'Reviewed closure not applied';
  end if;
  result:=public.close_control_case_with_tasks(c_id,'Encerramento com pendências preservadas',
    '00000000-0000-4000-8000-000000000068',
    (select array_agg(id order by id) from public.control_case_tasks
      where case_id=c_id and task_state in ('Pendente','Em andamento')),
    'Manter abertas');
  if result->>'alreadyApplied'<>'true'
    or (select count(*) from public.control_case_tasks
      where case_id=c_id and task_state in ('Pendente','Em andamento'))<>2
    or (select ticket_state from public.control_cases where id=c_id)<>'Concluído' then
    raise exception 'Reviewed closure changed open tasks or failed retry';
  end if;
end $$;
do $$
declare rejected boolean := false; intervention_rejected boolean := false;
  task_rejected boolean := false; c_id uuid; task_id uuid; task_result jsonb;
begin
  select id into c_id from public.control_cases where control_item_id =
    '00000000-0000-4000-8000-000000000020' and ticket_state='Concluído';
  begin
    perform public.append_control_case_diagnostic(
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020' and ticket_state='Concluído'),
      '{"symptom":"Após encerramento"}'::jsonb,
      '00000000-0000-4000-8000-000000000044');
  exception when others then
    if SQLERRM like 'Chamado encerrado%' then rejected := true;
    else raise; end if;
  end;
  if not rejected then raise exception 'Closed case accepted another diagnosis'; end if;
  begin
    perform public.append_control_case_intervention(
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020' and ticket_state='Concluído'),
      jsonb_build_object('occurredAt',now()::text,'type','Inspeção',
        'description','Após encerramento','result','Sem alteração'),
      '00000000-0000-4000-8000-000000000057');
  exception when others then
    if SQLERRM like 'Chamado encerrado%' then intervention_rejected := true;
    else raise; end if;
  end;
  if not intervention_rejected then
    raise exception 'Closed case accepted another intervention';
  end if;
  begin
    perform public.create_control_case_task(c_id,
      '{"description":"Tarefa após encerramento"}'::jsonb,
      '00000000-0000-4000-8000-000000000070');
  exception when others then
    if SQLERRM like 'Chamado encerrado%' then task_rejected:=true;
    else raise; end if;
  end;
  if not task_rejected then raise exception 'Closed case accepted a new task'; end if;
  select id into task_id from public.control_case_tasks where case_id=c_id
    and description='Trocar fonte fictícia';
  task_result:=public.update_control_case_task(task_id,
    jsonb_build_object('description','Trocar fonte fictícia','priority','Alta',
      'state','Concluída','revision',1,
      'completionNote','Fonte recebida após encerramento'),
    '00000000-0000-4000-8000-000000000071');
  if task_result->>'revision'<>'2'
    or (select count(*) from public.control_case_tasks where case_id=c_id
      and task_state='Pendente')<>1 then
    raise exception 'Existing open tasks could not be resolved after case closure';
  end if;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.control_case_transitions where case_id in
      (select id from public.control_cases where control_item_id =
        '00000000-0000-4000-8000-000000000020') and source = 'manual') <> 4 then
    raise exception 'Unexpected transition count; idempotency failed';
  end if;
  if not exists (select 1 from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020' and ticket_state = 'Concluído'
      and resolved_at is not null and closed_at is not null) then
    raise exception 'Resolved/closed timestamps were not recorded';
  end if;
  if (select count(*) from public.equipment_events where source_module = 'control'
      and source_event_key like 'case-transition:%' and
      metadata->>'physicalMovement' = 'false') <> 4 then
    raise exception 'Transition events must explicitly avoid physical movement';
  end if;
end $$;

update public.control_items set status = 'Em manutenção' where id =
  '00000000-0000-4000-8000-000000000020';
do $$
begin
  if (select count(*) from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020') <> 2 then
    raise exception 'New technical episode did not create separate history';
  end if;
  if (select count(*) from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000020' and ticket_state = 'Em manutenção') <> 1 then
    raise exception 'New technical episode is not the only open case';
  end if;
end $$;

-- The official verification flow may change the situation, not physical status.
insert into public.module_tables (module,name)
values ('control',app.current_control_maintenance_table_name());
do $$
declare rejected boolean := false;
begin
  begin
    update public.inventory_items set situation = 'Verificando' where tag = 'MON002';
  exception when others then
    if SQLERRM like 'Informe o motivo%' then rejected := true; else raise; end if;
  end;
  if not rejected then raise exception 'Direct Verificando update bypassed the reason guard'; end if;
end $$;
update public.inventory_items set sector = 'TI fictício',
  location = 'Sala técnica de testes', notes = '[[aldeckot:item-priority:alta]]'
  where tag = 'MON001';
select id as verify_item_id,updated_at as verify_updated_at
  from public.inventory_items where tag = 'MON001' \gset
set local role authenticated;
select public.start_inventory_verification(
  :'verify_item_id','Tela piscando intermitentemente',
  '00000000-0000-4000-8000-000000000036',:'verify_updated_at'::timestamptz);
do $$
declare result jsonb;
begin
  result := public.start_inventory_verification(
    (select id from public.inventory_items where tag = 'MON001'),
    'Tela piscando intermitentemente','00000000-0000-4000-8000-000000000036',
    '2026-01-01'::timestamptz);
  if result->>'alreadyApplied' <> 'true' then
    raise exception 'Verification retry was not idempotent';
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.inventory_items where tag = 'MON001'
      and status = 'Ativo' and situation = 'Verificando') then
    raise exception 'Verification changed the equipment operational status';
  end if;
  if not exists (select 1 from public.control_cases c
      join public.inventory_items i on i.id = c.source_id
      where i.tag = 'MON001' and c.source_module = 'inventory'
        and c.ticket_state = 'Em verificação' and c.followup_kind = 'verification') then
    raise exception 'Official verification did not create an inventory-sourced case';
  end if;
  if not exists (select 1 from public.control_verification_requests r
      join public.inventory_items i on i.id = r.inventory_item_id
      where i.tag = 'MON001' and r.reason = 'Tela piscando intermitentemente'
        and r.equipment_status = 'Ativo' and r.previous_situation = 'Normal'
        and r.priority = 'Alta' and r.sector = 'TI fictício'
        and r.location = 'Sala técnica de testes' and r.completed_at is null) then
    raise exception 'Verification request did not capture the input/context';
  end if;
end $$;
select c.id as verification_case_id from public.control_cases c
  join public.inventory_items i on i.id = c.source_id
  where i.tag = 'MON001' and c.source_module = 'inventory' \gset
set local role authenticated;
select public.transition_control_case(
  :'verification_case_id','Aguardando teste','Teste funcional pendente',
  '00000000-0000-4000-8000-000000000035');
reset role;
do $$
begin
  if not exists (select 1 from public.inventory_items where tag = 'MON001'
      and status = 'Ativo' and situation = 'Verificando') then
    raise exception 'Waiting state mutated physical equipment status';
  end if;
end $$;
set local role authenticated;
select public.complete_control_verification(
  (select control_item_id from public.control_verification_requests
    where request_id = '00000000-0000-4000-8000-000000000036'),
  '00000000-0000-4000-8000-000000000037',
  'Teste funcional aprovado sem reparo físico','{}'::jsonb);
reset role;
do $$
begin
  if not exists (select 1 from public.inventory_items where tag = 'MON001'
      and status = 'Ativo' and situation = 'Normal') then
    raise exception 'Resolution did not restore the previous situation';
  end if;
  if not exists (select 1 from public.control_verification_requests where request_id =
      '00000000-0000-4000-8000-000000000036' and completed_at is not null
      and outcome = 'resolved_without_maintenance') then
    raise exception 'Resolution did not close the verification request';
  end if;
  if not exists (select 1 from public.control_cases c
      join public.control_verification_requests r on r.case_id = c.id
      where r.request_id = '00000000-0000-4000-8000-000000000036'
        and c.ticket_state = 'Concluído'
        and c.solution = 'Teste funcional aprovado sem reparo físico'
        and c.resolved_at is not null and c.closed_at is not null
        and (select count(*) from public.control_case_transitions t
          where t.case_id = c.id and t.next_state = 'Resolvido') = 1) then
    raise exception 'Verification resolution was not recorded before closure';
  end if;
end $$;

-- A verification on an already-open maintenance case must reuse that case.
insert into public.control_items
  (id,table_id,equipment,model,tag,status,followup_kind,inventory_item_id)
select '00000000-0000-4000-8000-000000000023',t.id,
  'Monitor fictício','Modelo de teste','MON003','Em manutenção','maintenance',i.id
  from public.module_tables t cross join public.inventory_items i
  where t.module = 'control' and t.name = app.current_control_maintenance_table_name()
    and i.tag = 'MON003';
select id as reuse_item_id,updated_at as reuse_updated_at
  from public.inventory_items where tag = 'MON003' \gset
set local role authenticated;
select public.start_inventory_verification(
  :'reuse_item_id','Ruído intermitente durante manutenção',
  '00000000-0000-4000-8000-000000000038',:'reuse_updated_at'::timestamptz);
reset role;
do $$
begin
  if (select count(*) from public.control_cases where control_item_id =
      '00000000-0000-4000-8000-000000000023') <> 1 then
    raise exception 'Verification duplicated an open maintenance case';
  end if;
  if not exists (select 1 from public.control_verification_requests r
      join public.control_cases c on c.id = r.case_id
      join public.inventory_items i on i.id = r.inventory_item_id
      where r.request_id = '00000000-0000-4000-8000-000000000038'
        and c.control_item_id = '00000000-0000-4000-8000-000000000023'
        and c.ticket_state = 'Em manutenção' and i.tag = 'MON003'
        and i.status = r.equipment_status) then
    raise exception 'Verification did not link to the existing maintenance case';
  end if;
end $$;

-- Promotion closes the verification and creates a distinct, related maintenance.
select id as promote_item_id,updated_at as promote_updated_at
  from public.inventory_items where tag = 'MON002' \gset
set local role authenticated;
select public.start_inventory_verification(
  :'promote_item_id','Falha elétrica confirmada no teste',
  '00000000-0000-4000-8000-000000000039',:'promote_updated_at'::timestamptz);
select control_item_id as promote_control_id
  from public.control_verification_requests
  where request_id = '00000000-0000-4000-8000-000000000039' \gset
select public.promote_inventory_verification_to_maintenance(
  :'promote_control_id','Falha elétrica exige reparo',
  '00000000-0000-4000-8000-000000000040');
do $$
declare result jsonb;
begin
  result := public.promote_inventory_verification_to_maintenance(
    (select control_item_id from public.control_verification_requests
      where request_id = '00000000-0000-4000-8000-000000000039'),
    'Falha elétrica exige reparo',
    '00000000-0000-4000-8000-000000000040');
  if result->>'alreadyApplied' <> 'true' then
    raise exception 'Promotion retry was not idempotent';
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.control_verification_requests r
      join public.control_cases maintenance on maintenance.id = r.maintenance_case_id
      join public.control_cases verification on verification.id = r.case_id
      where r.request_id = '00000000-0000-4000-8000-000000000039'
        and r.outcome = 'promoted_to_maintenance' and r.completed_at is not null
        and r.promotion_request_id = '00000000-0000-4000-8000-000000000040'
        and maintenance.related_case_id = verification.id
        and maintenance.id <> verification.id
        and maintenance.ticket_state = 'Em manutenção'
        and verification.ticket_state = 'Concluído') then
    raise exception 'Promotion did not create related, separate cases';
  end if;
  if not exists (select 1 from public.inventory_items where tag = 'MON002'
      and status = 'Manutenção' and situation = 'Normal') then
    raise exception 'Promotion did not update only the justified equipment status';
  end if;
  if (select count(*) from public.control_cases c
      join public.inventory_items i on i.id = c.source_id
      where i.tag = 'MON002' and c.followup_kind = 'maintenance'
        and c.ticket_state = 'Em manutenção') <> 1 then
    raise exception 'Promotion duplicated the maintenance case';
  end if;
  if not exists (select 1 from public.equipment_events
      where source_event_key = 'verification-promotion:00000000-0000-4000-8000-000000000040'
        and metadata->>'physicalMovement' = 'false'
        and metadata->>'equipmentStatusChanged' = 'true') then
    raise exception 'Promotion history did not distinguish status from movement';
  end if;
end $$;

-- Operational dashboard counts only cases, with server-side paging and real priorities.
insert into public.control_items
  (table_id,equipment,model,tag,status,followup_kind,notes)
select '00000000-0000-4000-8000-000000000010',
  'Equipamento fictício ' || n,'Modelo local','TEST-CASE-' || lpad(n::text,3,'0'),
  'Aguardando avaliação','maintenance',
  case when n = 1 then '[[aldeckot:item-priority:alta]]' else '' end
from generate_series(1,27) as n;
set local role authenticated;
do $$
declare overview jsonb; all_page jsonb; next_page jsonb; active_page jsonb;
  tagged jsonb; invalid_rejected boolean := false;
begin
  overview := public.control_operational_overview(null);
  if (overview->'metrics'->>'open')::integer <> (
    select count(*) from public.control_cases
      where ticket_state is not null and ticket_state not in ('Concluído','Cancelado')
  ) then
    raise exception 'Operational open count differs from real cases';
  end if;
  if (overview->'metrics'->>'critical')::integer <> (
    select count(*) from public.control_cases where priority = 'Alta'
      and ticket_state is not null and ticket_state not in ('Concluído','Cancelado')
  ) then
    raise exception 'Critical count differs from real cases';
  end if;
  if overview->'queue'->0->>'tag' <> 'TEST-CASE-001' then
    raise exception 'High-priority case was not first in the work queue';
  end if;
  if (overview->'metrics'->>'completedPeriod')::integer <> (
    select count(*) from public.control_cases c
    where c.ticket_state = 'Concluído'
      and c.closed_at >= date_trunc('month',timezone('America/Sao_Paulo',now()))
        at time zone 'America/Sao_Paulo'
      and exists (select 1 from public.control_case_transitions t
        where t.case_id = c.id and t.next_state = 'Concluído'
          and t.source <> 'backfill')
  ) then
    raise exception 'Period count used inferred legacy closure';
  end if;
  if overview->>'interventionsAvailable' <> 'false'
    or overview->>'tasksAvailable' <> 'false'
    or overview->'metrics'->'overdue' <> 'null'::jsonb then
    raise exception 'Unavailable interventions/tasks/deadlines must not be fabricated';
  end if;
  all_page := public.list_control_cases('all','','','',1,25);
  next_page := public.list_control_cases('all','','','',2,25);
  active_page := public.list_control_cases('active','','','',1,25);
  tagged := public.list_control_cases('all','MON002','','',1,25);
  if (all_page->>'total')::integer <> (select count(*) from public.control_cases)
    or jsonb_array_length(all_page->'items') <> 25
    or jsonb_array_length(next_page->'items') = 0
    or (all_page->'items'->0->>'id') = (next_page->'items'->0->>'id')
    or (active_page->>'total')::integer <> (overview->'metrics'->>'open')::integer
    or (tagged->>'total')::integer <> 2 then
    raise exception 'Operational filters or pagination disagree with the cases';
  end if;
  begin
    perform public.list_control_cases('all','','','',1,200);
  exception when others then
    if SQLERRM like 'Filtros ou paginação inválidos%' then invalid_rejected := true;
    else raise; end if;
  end;
  if not invalid_rejected then raise exception 'Unbounded page size was accepted'; end if;
end $$;
reset role;
set local role anon;
do $$
declare denied boolean := false; detail_denied boolean := false;
  write_denied boolean := false; intervention_denied boolean := false;
  task_denied boolean := false;
begin
  begin
    perform public.control_operational_overview(null);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'Anonymous operational overview was accessible'; end if;
  begin
    perform public.get_control_case_detail((select id from public.control_cases limit 1));
  exception when insufficient_privilege then detail_denied := true;
  end;
  begin
    perform public.append_control_case_diagnostic(
      '00000000-0000-4000-8000-000000000020',
      '{"symptom":"Anonymous"}'::jsonb,
      '00000000-0000-4000-8000-000000000043');
  exception when insufficient_privilege then write_denied := true;
  end;
  begin
    perform public.recent_control_case_interventions();
  exception when insufficient_privilege then intervention_denied := true;
  end;
  begin
    perform public.control_overdue_case_tasks();
  exception when insufficient_privilege then task_denied := true;
  end;
  if not detail_denied or not write_denied or not intervention_denied
    or not task_denied then
    raise exception 'Anonymous case detail, diagnostic or interventions accessible';
  end if;
end $$;
reset role;
set local role authenticated;
do $$
declare denied boolean := false; intervention_denied boolean := false;
  task_denied boolean := false; task_event_denied boolean := false;
begin
  begin
    update public.control_case_diagnostics set symptom='Sobrescrito';
  exception when insufficient_privilege then denied := true;
  end;
  begin
    update public.control_case_interventions set result='Sobrescrito';
  exception when insufficient_privilege then intervention_denied := true;
  end;
  begin
    update public.control_case_tasks set description='Sobrescrito';
  exception when insufficient_privilege then task_denied := true;
  end;
  begin
    update public.control_case_task_events set action='Atualizada';
  exception when insufficient_privilege then task_event_denied := true;
  end;
  if not denied or not intervention_denied or not task_denied or not task_event_denied then
    raise exception 'Diagnostic revisions or interventions could be overwritten directly';
  end if;
end $$;
reset role;
rollback;
