-- Execute exclusivamente em uma transação revertida no projeto de testes.
do $setup$
declare
  area_table uuid;
  terminal integer;
begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
  select id into area_table from public.module_tables where module = 'management' order by id limit 1;
  if area_table is null then raise exception 'Missing staging management table.'; end if;
  for terminal in 990..994 loop
    insert into public.module_records (table_id, position, payload)
      values (area_table, 90000 + terminal, jsonb_build_object(
        'terminal', 'PDV ' || terminal, 'isFixed', true, 'area', 'Frente de Loja', 'sector', 'Frente de Loja',
        'equipment', case when terminal in (990, 992, 994) then 'Computador de ensaio' else '' end,
        'tag', case when terminal in (990, 992, 994) then 'ALDQA' || terminal else '' end,
        'serial', case when terminal in (990, 992, 994) then 'ALDECKOT-FLUX-124-' || terminal else '' end,
        'brand', 'Teste', 'model', 'Teste', 'status', 'Ativo', 'location', 'PDV ' || terminal,
        'situation', 'Em Uso', 'peripherals', '[]'::jsonb, 'logs', '[]'::jsonb));
  end loop;
  if not exists (select 1 from public.module_tables t where t.module = 'control'
    and t.name = app.current_control_maintenance_table_name()) then
    insert into public.module_tables (module, name, icon)
      values ('control', app.current_control_maintenance_table_name(), '🔧');
  end if;
end;
$setup$;

create function pg_temp.send_computer(asset public.module_records, shipment_reason text default 'Troca')
returns public.flux_items language plpgsql as $$
declare
  source_table uuid;
  shipment public.flux_items%rowtype;
  draft jsonb;
  review jsonb;
begin
  select id into source_table from public.module_tables where module = 'flux' order by created_at, id limit 1;
  draft := jsonb_build_object('table_id', source_table, 'movement', 'Envio',
    'equipment', asset.payload->>'equipment', 'model', asset.payload->>'model', 'brand', asset.payload->>'brand',
    'serial', asset.payload->>'serial', 'tag', asset.payload->>'tag',
    'source_module', 'management', 'source_record_id', asset.id,
    'sender_company', 'Origem de teste', 'destination_company', 'Destino de teste',
    'sender_responsible', 'Teste transacional', 'receiver_responsible', '', 'notes', '',
    'send_date', (now() at time zone 'America/Sao_Paulo')::date,
    'shipping_type', 'Transporte Interno', 'reason', shipment_reason, 'status', 'Pendente');
  review := public.flux_preview_movement(source_table, null, draft);
  select * into shipment from public.flux_confirm_movement(source_table, null, draft,
    review->>'token', gen_random_uuid(), 'Envio de computador de ensaio');
  select * into shipment from public.flux_confirm_delivery(shipment.id, shipment.updated_at,
    gen_random_uuid(), now(), 'Teste transacional', '', '');
  return shipment;
end;
$$;

create function pg_temp.receive_computer(shipment public.flux_items, destination_condition text)
returns public.flux_items language plpgsql as $$
declare
  receipt_table uuid;
  receipt public.flux_items%rowtype;
begin
  select id into receipt_table from public.module_tables where module = 'flux' and id <> shipment.table_id
    order by created_at desc, id limit 1;
  select * into receipt from public.flux_register_return(shipment.id, receipt_table, shipment.updated_at,
    gen_random_uuid(), now(), 'Teste transacional', 'Destino de teste',
    'Origem de teste', 'Retorno de ensaio revertível', destination_condition, '', '');
  return receipt;
end;
$$;

create function pg_temp.move_computer(asset public.module_records, position_text text)
returns void language plpgsql as $$
declare
  dest public.module_records%rowtype;
begin
  select * into strict dest from public.module_records where payload->>'terminal' = position_text;
  perform public.management_move_computer(gen_random_uuid(), jsonb_build_object('mode', 'direct',
    'sourceId', asset.id, 'targetId', dest.id, 'incomingComputerId', asset.management_computer_id,
    'sourceUpdatedAt', asset.updated_at, 'targetUpdatedAt', dest.updated_at,
    'incomingStatus', 'Ativo', 'incomingLocation', position_text,
    'reason', 'Mudança anterior ao retorno', 'confirmedLocations', true));
end;
$$;

set local role authenticated;
do $test$
declare
  pc_a public.module_records%rowtype;
  pc_b public.module_records%rowtype;
  send_a public.flux_items%rowtype;
  send_b public.flux_items%rowtype;
  receipt public.flux_items%rowtype;
  review jsonb;
  outcome jsonb;
  request_id uuid := gen_random_uuid();
  a_id uuid;
  b_id uuid;
  peripheral_id uuid;
  existing_ticket uuid;
begin
  select i.id into strict peripheral_id from public.inventory_items i where i.tag = 'GVT016';
  review := public.preview_local_regularization(peripheral_id, 'PDV 990', 'Frente de Loja', 'Ativo', 'movement');
  perform public.confirm_local_regularization(peripheral_id, 'PDV 990', 'Frente de Loja', 'Ativo',
    'movement', 'Periférico de ensaio conferido', review->>'token', gen_random_uuid());
  select * into strict pc_a from public.module_records where payload->>'terminal' = 'PDV 990';
  select * into strict pc_b from public.module_records where payload->>'terminal' = 'PDV 992';
  a_id := pc_a.management_computer_id;
  b_id := pc_b.management_computer_id;
  send_a := pg_temp.send_computer(pc_a);
  perform pg_temp.move_computer(pc_a, 'PDV 991');
  perform pg_temp.move_computer(pc_b, 'PDV 990');
  select * into strict pc_b from public.module_records where management_computer_id = b_id;
  send_b := pg_temp.send_computer(pc_b);
  if send_a.source_record_id <> send_b.source_record_id
    or send_a.management_computer_id is distinct from a_id or send_b.management_computer_id is distinct from b_id
    or send_a.equipment_uid = send_b.equipment_uid then
    raise exception 'The Flux identity followed the terminal instead of the computer.';
  end if;
  receipt := pg_temp.receive_computer(send_a, 'Ativo');
  if receipt.management_computer_id is distinct from a_id or receipt.return_of <> send_a.id
    or receipt.table_id = send_a.table_id then raise exception 'Cross-period receipt lost its computer.'; end if;
  review := public.preview_flux_computer_return(receipt.id, 'PDV 990', 'Frente de Loja');
  if review->>'blocked' <> 'true' or jsonb_array_length(review->'occupants') <> 1 then
    raise exception 'Occupied former terminal was not blocked: %', review->>'reason';
  end if;
  review := public.preview_flux_computer_return(receipt.id, 'PDV 993', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->'item'->>'location' <> 'PDV 991' then
    raise exception 'The new destination did not resolve the current computer: %', review->>'reason';
  end if;
  begin
    perform public.confirm_flux_computer_return(receipt.id, 'PDV 993', 'Frente de Loja',
      'Destino confirmado em ensaio', 'outdated', request_id);
    raise exception 'An outdated token was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'O retorno, computador, terminal ou chamado mudou%' then raise; end if;
  end;
  outcome := public.confirm_flux_computer_return(receipt.id, 'PDV 993', 'Frente de Loja',
    'Destino confirmado em ensaio', review->>'token', request_id);
  if not exists (select 1 from public.module_records r where r.payload->>'terminal' = 'PDV 993'
      and r.management_computer_id = a_id)
    or not exists (select 1 from public.module_records r where r.payload->>'terminal' = 'PDV 990'
      and r.management_computer_id = b_id and r.payload->'peripherals' @>
        jsonb_build_array(jsonb_build_object('sourceItemId', peripheral_id)))
    or not exists (select 1 from public.management_movement_history(a_id, null) h where h.event_id = request_id)
    or not exists (select 1 from public.flux_item_logs l where l.flux_item_id = receipt.id and l.event_id = request_id) then
    raise exception 'The installation moved the wrong computer, or history was missing.';
  end if;
  outcome := public.confirm_flux_computer_return(receipt.id, 'PDV 993', 'Frente de Loja',
    'Destino confirmado em ensaio', review->>'token', request_id);
  if outcome->>'alreadyApplied' <> 'true' then raise exception 'The retry was not idempotent.'; end if;

  receipt := pg_temp.receive_computer(send_b, 'Verificação');
  review := public.preview_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' then raise exception 'Verification preview: %', review->>'reason'; end if;
  outcome := public.confirm_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Encaminhado para verificar no ensaio', review->>'token', gen_random_uuid());
  if not exists (select 1 from public.control_items c where c.id = (outcome->>'controlItemId')::uuid
      and c.verification_computer_id = b_id)
    or not exists (select 1 from public.module_records r where r.management_computer_id = b_id
      and r.payload->>'terminal' = '' and r.payload->>'status' = 'Reserva' and r.payload->>'situation' = 'Verificando') then
    raise exception 'The verification or removal from the terminal was not recorded.';
  end if;

  select * into strict pc_a from public.module_records where management_computer_id = a_id;
  send_a := pg_temp.send_computer(pc_a, 'Manutenção');
  receipt := pg_temp.receive_computer(send_a, 'Reserva');
  review := public.preview_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->>'technicalAction' <> 'complete' then
    raise exception 'Original maintenance completion preview: %', review->>'reason';
  end if;
  outcome := public.confirm_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Concluído e reservado em ensaio', review->>'token', gen_random_uuid());
  if not exists (select 1 from public.control_items c where c.id = (outcome->>'controlItemId')::uuid
      and c.status = 'Manutenção concluída')
    or not exists (select 1 from public.module_records r where r.management_computer_id = a_id
      and r.payload->>'terminal' = '' and r.payload->>'location' = 'Sala CPD' and r.payload->>'status' = 'Reserva') then
    raise exception 'The original maintenance or reserve destination was not confirmed.';
  end if;

  select * into strict pc_a from public.module_records where payload->>'terminal' = 'PDV 994';
  a_id := pc_a.management_computer_id;
  send_a := pg_temp.send_computer(pc_a);
  receipt := pg_temp.receive_computer(send_a, 'Defeito');
  review := public.preview_flux_computer_return(receipt.id, 'PDV 994', 'Frente de Loja');
  if review->>'blocked' <> 'true' then raise exception 'A defective computer could remain installed.'; end if;
  review := public.preview_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->>'technicalAction' <> 'maintenance' then
    raise exception 'Technical routing preview: %', review->>'reason';
  end if;
  outcome := public.confirm_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Defeito identificado no ensaio', review->>'token', gen_random_uuid());
  existing_ticket := (outcome->>'controlItemId')::uuid;
  select * into strict pc_a from public.module_records where management_computer_id = a_id;
  if pc_a.payload->>'status' <> 'Defeito' or pc_a.payload->>'terminal' <> '' or existing_ticket is null then
    raise exception 'The defective condition, detached position or technical ticket is missing.';
  end if;
  send_a := pg_temp.send_computer(pc_a);
  receipt := pg_temp.receive_computer(send_a, 'Manutenção');
  review := public.preview_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->>'technicalAction' <> 'reuse' then
    raise exception 'Technical reuse preview: %', review->>'reason';
  end if;
  outcome := public.confirm_flux_computer_return(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Reaproveitamento do chamado no ensaio', review->>'token', gen_random_uuid());
  if (outcome->>'controlItemId')::uuid is distinct from existing_ticket
    or (select count(*) from public.control_items c where c.management_record_id = pc_a.id
      and c.status = 'Em manutenção') <> 1 then
    raise exception 'The return duplicated the technical ticket.';
  end if;
  raise notice 'flux_computer_return_124_stable_identity_ok';
end;
$test$;
