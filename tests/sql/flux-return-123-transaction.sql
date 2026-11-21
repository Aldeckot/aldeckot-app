-- Execute exclusivamente sob BEGIN/ROLLBACK no projeto de testes.
do $setup$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
  if not exists (select 1 from public.module_tables t where t.module = 'control'
    and t.name = app.current_control_maintenance_table_name()) then
    insert into public.module_tables(module, name, icon)
      values ('control', app.current_control_maintenance_table_name(), '🔧');
  end if;
  insert into public.module_records(table_id, payload, position)
    select t.id, jsonb_build_object('terminal', 'PDV 999', 'equipment', '',
      'area', 'Frente de Loja', 'sector', 'Frente de Loja', 'peripherals', '[]'::jsonb), 99999
    from public.module_tables t where t.module = 'management' order by t.id limit 1;
end; $setup$;

create function pg_temp.make_receipt(asset public.inventory_items, condition text,
  shipment_reason text default 'Troca')
returns public.flux_items language plpgsql as $$
declare
  origin_id uuid;
  destination_id uuid;
  shipment public.flux_items%rowtype;
  received public.flux_items%rowtype;
  draft jsonb;
  review jsonb;
begin
  select id into origin_id from public.module_tables where module = 'flux'
    order by created_at, id limit 1;
  select id into destination_id from public.module_tables where module = 'flux' and id <> origin_id
    order by created_at desc, id limit 1;
  draft := jsonb_build_object('table_id', origin_id, 'movement', 'Envio',
    'equipment', asset.equipment, 'model', asset.model, 'brand', asset.brand,
    'serial', asset.serial, 'tag', asset.tag, 'sector', asset.sector, 'location', asset.location,
    'source_module', 'inventory', 'source_record_id', asset.id, 'inventory_item_id', asset.id,
    'sender_company', 'Origem de teste', 'destination_company', 'Destino de teste',
    'sender_responsible', 'Teste transacional', 'receiver_responsible', '', 'notes', '',
    'send_date', (now() at time zone 'America/Sao_Paulo')::date,
    'shipping_type', 'Transporte Interno', 'reason', shipment_reason, 'status', 'Pendente');
  review := public.flux_preview_movement(origin_id, null, draft);
  select * into shipment from public.flux_confirm_movement(origin_id, null, draft,
    review->>'token', gen_random_uuid(), 'Envio de ensaio revertível');
  select * into shipment from public.flux_confirm_delivery(shipment.id, shipment.updated_at,
    gen_random_uuid(), now(), 'Teste transacional', '', '');
  select * into received from public.flux_register_return(shipment.id, destination_id,
    shipment.updated_at, gen_random_uuid(), now(), 'Teste transacional', 'Destino de teste',
    'Origem de teste', 'Retorno de ensaio revertível', condition, '', '');
  return received;
end;
$$;

set local role authenticated;
do $test$
declare
  asset public.inventory_items%rowtype;
  receipt public.flux_items%rowtype;
  review jsonb;
  outcome jsonb;
  action_id uuid := gen_random_uuid();
  result_event uuid;
  ticket_id uuid;
  installation text;
begin
  select * into asset from public.inventory_items where tag = 'GVT016';
  if asset.id is null then raise exception 'Missing staging peripheral fixture.'; end if;
  receipt := pg_temp.make_receipt(asset, 'Ativo');
  review := public.preview_flux_return_destination(receipt.id, 'PDV 13', 'Frente de Loja');
  if review->>'blocked' <> 'true' or jsonb_array_length(review->'occupants') < 1 then
    raise exception 'Occupied PDV was not blocked: %', review->>'reason';
  end if;
  installation := 'PDV 999';
  review := public.preview_flux_return_destination(receipt.id, installation, 'Frente de Loja');
  if review->>'blocked' <> 'false' then raise exception 'Free PDV preview: %', review->>'reason'; end if;
  outcome := public.confirm_flux_return_destination(receipt.id, installation, 'Frente de Loja',
    'Reinstalação de ensaio revertível', review->>'token', gen_random_uuid());
  if not exists (select 1 from public.management_movement_history(null,
      (review->'target'->>'positionId')::uuid) h
      where h.event_id = (outcome->>'eventId')::uuid and h.action = 'Regularização após retorno') then
    raise exception 'The installation is missing from PDV history.';
  end if;

  receipt := pg_temp.make_receipt(asset, 'Reserva');
  review := public.preview_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' then raise exception 'Reserve preview: %', review->>'reason'; end if;
  begin
    perform public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
      'Destino de ensaio revertível', 'outdated', action_id);
    raise exception 'The stale review was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'O retorno, equipamento, PDV ou chamado mudou%' then raise; end if;
  end;
  outcome := public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Destino de ensaio revertível', review->>'token', action_id);
  result_event := (outcome->>'eventId')::uuid;
  if not exists (select 1 from public.flux_items f where f.id = receipt.id
      and f.resolution_state = 'Aplicada' and f.location = 'Sala CPD')
    or not exists (select 1 from public.inventory_items i where i.id = asset.id
      and i.location = 'Sala CPD' and i.status = 'Reserva')
    or not exists (select 1 from public.flux_item_logs l
      where l.flux_item_id = receipt.id and l.event_id = result_event)
    or not exists (select 1 from public.inventory_item_logs l
      where l.inventory_item_id = asset.id and l.event_id = result_event) then
    raise exception 'The confirmed destination or correlated history is missing.';
  end if;
  outcome := public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Destino de ensaio revertível', review->>'token', action_id);
  if outcome->>'alreadyApplied' <> 'true' or (outcome->>'eventId')::uuid <> result_event then
    raise exception 'Retry did not return the same event.';
  end if;

  receipt := pg_temp.make_receipt(asset, 'Verificação');
  review := public.preview_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' then raise exception 'Verification preview: %', review->>'reason'; end if;
  outcome := public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Verificação após retorno de ensaio', review->>'token', gen_random_uuid());
  if not exists (select 1 from public.control_items c where c.id = (outcome->>'controlItemId')::uuid
    and c.verification_inventory_item_id = asset.id and c.status = 'Aguardando avaliação') then
    raise exception 'The technical verification was not created.';
  end if;

  select i.* into asset from public.inventory_items i
    where i.id <> asset.id and i.status = 'Reserva' and i.tag ~ '^GVT[0-9]+$'
      and not exists (select 1 from public.control_items c where c.inventory_item_id = i.id
        or c.tag = i.tag or c.serial = i.serial) order by i.id limit 1;
  if asset.id is null then raise exception 'Missing staging maintenance fixture.'; end if;
  receipt := pg_temp.make_receipt(asset, 'Reserva', 'Manutenção');
  select c.id into ticket_id from public.control_items c where c.inventory_item_id = asset.id
    and c.status = 'Em manutenção';
  if ticket_id is null then raise exception 'The outbound shipment did not generate maintenance.'; end if;
  review := public.preview_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->>'technicalAction' <> 'complete' then
    raise exception 'Maintenance completion preview: %', review->>'reason';
  end if;
  outcome := public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Conclusão após retorno de ensaio', review->>'token', gen_random_uuid());
  if not exists (select 1 from public.control_items c where c.id = ticket_id and c.status = 'Manutenção concluída')
    or not exists (select 1 from public.equipment_events e where e.id = (outcome->>'eventId')::uuid
      and e.metadata->>'controlEventId' is not null) then
    raise exception 'The existing maintenance ticket was not closed and correlated.';
  end if;

  select i.* into asset from public.inventory_items i
    where i.status = 'Reserva' and i.tag ~ '^GVT[0-9]+$'
      and not exists (select 1 from public.control_items c where c.inventory_item_id = i.id
        or c.verification_inventory_item_id = i.id or c.tag = i.tag or c.serial = i.serial)
    order by i.id limit 1;
  if asset.id is null then raise exception 'Missing second maintenance fixture.'; end if;
  receipt := pg_temp.make_receipt(asset, 'Defeito');
  review := public.preview_flux_return_destination(receipt.id, 'PDV 999', 'Frente de Loja');
  if review->>'blocked' <> 'true' then raise exception 'A faulty peripheral could occupy a PDV.'; end if;
  review := public.preview_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja');
  perform public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Defeito identificado no ensaio', review->>'token', gen_random_uuid());
  if not exists (select 1 from public.inventory_items i where i.id = asset.id and i.status = 'Defeito') then
    raise exception 'The defective condition was not recorded.';
  end if;

  receipt := pg_temp.make_receipt(asset, 'Manutenção');
  review := public.preview_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->>'technicalAction' <> 'maintenance' then
    raise exception 'New maintenance preview: %', review->>'reason';
  end if;
  outcome := public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Manutenção iniciada no ensaio', review->>'token', gen_random_uuid());
  ticket_id := (outcome->>'controlItemId')::uuid;
  receipt := pg_temp.make_receipt(asset, 'Manutenção');
  review := public.preview_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja');
  if review->>'blocked' <> 'false' or review->>'technicalAction' <> 'reuse' then
    raise exception 'Maintenance reuse preview: %', review->>'reason';
  end if;
  outcome := public.confirm_flux_return_destination(receipt.id, 'Sala CPD', 'Frente de Loja',
    'Manutenção reaproveitada no ensaio', review->>'token', gen_random_uuid());
  if (outcome->>'controlItemId')::uuid is distinct from ticket_id
    or (select count(*) from public.control_items c where c.inventory_item_id = asset.id
      and c.status = 'Em manutenção') <> 1 then
    raise exception 'The return duplicated an open maintenance ticket.';
  end if;
  raise notice 'flux_return_123_inventory_destination_ok';
end;
$test$;
