-- Etapa 8: componentes e serviço externo. Dados fictícios, rollback garantido.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.module_tables(id,module,name)
values ('00000000-0000-4000-8000-000000000110','control','Chamados de componentes')
on conflict (id) do nothing;
insert into public.control_items
  (id,table_id,equipment,model,serial,tag,sector,status,followup_kind)
values ('00000000-0000-4000-8000-000000000120',
  '00000000-0000-4000-8000-000000000110','Notebook fictício','Modelo local',
  'SERIAL-TESTE-COMP','TAG-TESTE-COMP','Setor fictício','Aguardando avaliação','maintenance');
insert into public.module_tables(id,module,name)
values ('00000000-0000-4000-8000-000000000111','inventory','Inventário fictício')
on conflict (id) do nothing;
insert into public.inventory_items(id,table_id,equipment,model,brand,serial,tag)
values ('00000000-0000-4000-8000-000000000121',
  '00000000-0000-4000-8000-000000000111','SSD fictício','Modelo NVMe','Marca teste',
  'SSD-SERIE-001','SSD-TAG-001');
insert into public.supplies(id,name,category,brand,model,tracking_type,minimum_stock)
values ('00000000-0000-4000-8000-000000000150','Memória fictícia','Memória',
  'Marca teste','DDR4','unit',0);
insert into public.supply_units(id,supply_id,code,serial_number,status,
  physical_location,installed_inventory_item_id)
values ('00000000-0000-4000-8000-000000000151',
  '00000000-0000-4000-8000-000000000150','MEM-ANTIGA','MEM-SER-ANTIGA',
  'Instalado','Sala fictícia','00000000-0000-4000-8000-000000000121'),
 ('00000000-0000-4000-8000-000000000152',
  '00000000-0000-4000-8000-000000000150','MEM-NOVA','MEM-SER-NOVA',
  'Em estoque','Almoxarifado',null);
select id as component_test_case from public.control_cases
where control_item_id='00000000-0000-4000-8000-000000000120' \gset

set local role authenticated;
select public.append_control_case_component_event(:'component_test_case',
  '{"requestId":"00000000-0000-4000-8000-000000000130","name":"SSD fictício"}'::jsonb,
  jsonb_build_object('action','Enviado ao fornecedor',
    'occurredAt',(now()-interval '1 day')::text,'result','Diagnóstico confirmado',
    'supplier','Fornecedor fictício','reason','Reparo de bancada',
    'protocol','OS-TESTE-08','expectedReturnAt',(now()+interval '3 days')::text,
    'serviceStatus','Enviado'),
  '00000000-0000-4000-8000-000000000140');
select public.append_control_case_component_event(:'component_test_case',
  '{"requestId":"00000000-0000-4000-8000-000000000131","inventoryItemId":"00000000-0000-4000-8000-000000000121"}'::jsonb,
  jsonb_build_object('action','Inspecionado','occurredAt',now()::text,
    'result','Inspeção aprovada'),
  '00000000-0000-4000-8000-000000000141');
select public.append_control_case_component_event(:'component_test_case',
  '{"requestId":"00000000-0000-4000-8000-000000000133","supplyUnitId":"00000000-0000-4000-8000-000000000151"}'::jsonb,
  '{"action":"Substituído","occurredAt":"2026-10-25T10:00:00Z",
    "result":"Substituição aprovada","reason":"Falha confirmada",
    "replacementSupplyUnitId":"00000000-0000-4000-8000-000000000152",
    "stockDestination":"Defeito","serviceStatus":""}'::jsonb,
  '00000000-0000-4000-8000-000000000143');

do $$
declare retry jsonb; detail jsonb; missing_external boolean:=false;
begin
  retry:=public.append_control_case_component_event(
    (select id from public.control_cases where control_item_id=
      '00000000-0000-4000-8000-000000000120'),
    '{"requestId":"00000000-0000-4000-8000-000000000130","name":"SSD fictício"}'::jsonb,
    (select jsonb_build_object('action',action,'occurredAt',occurred_at::text,
      'result',result,'notes',notes,'supplier',supplier,'reason',reason,
      'protocol',protocol,'expectedReturnAt',expected_return_at::text,
      'serviceStatus',service_status) from public.control_case_component_events
      where request_id='00000000-0000-4000-8000-000000000140'),
    '00000000-0000-4000-8000-000000000140');
  if retry->>'alreadyApplied'<>'true' then
    raise exception 'Componente ou evento de fornecedor não foi idempotente';
  end if;
  retry:=public.append_control_case_component_event(
    (select id from public.control_cases where control_item_id=
      '00000000-0000-4000-8000-000000000120'),
    '{"requestId":"00000000-0000-4000-8000-000000000133","supplyUnitId":"00000000-0000-4000-8000-000000000151"}'::jsonb,
    '{"action":"Substituído","occurredAt":"2026-10-25T10:00:00Z",
      "result":"Substituição aprovada","reason":"Falha confirmada",
      "replacementSupplyUnitId":"00000000-0000-4000-8000-000000000152",
      "stockDestination":"Defeito","serviceStatus":""}'::jsonb,
    '00000000-0000-4000-8000-000000000143');
  if retry->>'alreadyApplied'<>'true' then
    raise exception 'Retry da substituição não foi idempotente';
  end if;
  if (select count(*) from public.control_case_components where case_id=
      (select id from public.control_cases where control_item_id=
    '00000000-0000-4000-8000-000000000120'))<>4
    or (select count(*) from public.control_case_component_events where case_id=
      (select id from public.control_cases where control_item_id=
        '00000000-0000-4000-8000-000000000120'))<>3 then
    raise exception 'Histórico do componente duplicado ou incompleto';
  end if;
  if not exists(select 1 from public.control_case_components where
      inventory_item_id='00000000-0000-4000-8000-000000000121'
      and component_name='SSD fictício' and tag='SSD-TAG-001'
      and serial='SSD-SERIE-001') then
    raise exception 'A identidade vinculada ao Inventário não foi respeitada';
  end if;
  if exists(select 1 from public.equipment_events where source_event_key like
      'case-component:%') then
    raise exception 'Registro técnico criou movimentação física implícita';
  end if;
  if (select status from public.supply_units where id='00000000-0000-4000-8000-000000000151')<>'Defeito'
    or (select status from public.supply_units where id='00000000-0000-4000-8000-000000000152')<>'Instalado'
    or (select count(*) from public.supply_movements where supply_unit_id in (
      '00000000-0000-4000-8000-000000000151','00000000-0000-4000-8000-000000000152'))<>2
    or not exists(select 1 from public.control_case_components where case_id=
      (select id from public.control_cases where control_item_id=
        '00000000-0000-4000-8000-000000000120')
      and supply_unit_id='00000000-0000-4000-8000-000000000152') then
    raise exception 'A substituição não preservou identidade e saldos oficiais dos componentes';
  end if;
  begin
    perform public.append_control_case_component_event(
      (select id from public.control_cases where control_item_id=
        '00000000-0000-4000-8000-000000000120'),
      '{"requestId":"00000000-0000-4000-8000-000000000132","name":"Peça fictícia"}'::jsonb,
      jsonb_build_object('action','Enviado ao fornecedor',
        'occurredAt',now()::text,'result','Enviado'),
      '00000000-0000-4000-8000-000000000142');
  exception when others then
    if SQLERRM like 'Dados, resultado ou acompanhamento externo inválidos%' then
      missing_external:=true;
    else raise;
    end if;
  end;
  if not missing_external then
    raise exception 'Envio externo sem fornecedor/motivo/previsão foi aceito';
  end if;
end $$;
rollback;
