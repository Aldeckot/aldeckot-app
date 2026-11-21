-- Execute exclusivamente em uma transação revertida no projeto de testes.
do $setup$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
  insert into public.module_records(table_id, position, payload)
    select t.id, 99998, jsonb_build_object('terminal', 'PDV 998', 'equipment', '',
      'area', 'Frente de Loja', 'sector', 'Frente de Loja', 'logs', '[]'::jsonb, 'peripherals', '[]'::jsonb)
    from public.module_tables t where t.module = 'management' order by t.id limit 1;
end; $setup$;

create function pg_temp.new_peripheral_receipt(
  p_serial text, p_tag text default '', p_status text default 'Recebido'
) returns public.flux_items language plpgsql as $$
declare
  receipt public.flux_items%rowtype;
  table_id uuid;
  draft jsonb;
  review jsonb;
begin
  select t.id into table_id from public.module_tables t where t.module = 'flux' order by t.id limit 1;
  draft := jsonb_build_object('table_id', table_id, 'movement', 'Recebimento',
    'equipment', 'Gaveta de ensaio', 'model', 'Modelo de ensaio', 'brand', 'Marca de ensaio',
    'serial', p_serial, 'tag', p_tag, 'sender_company', 'Fornecedor de ensaio',
    'destination_company', 'Matriz', 'sender_responsible', 'Remetente de ensaio',
    'receiver_responsible', 'Recebedor de ensaio', 'send_date', current_date,
    'received_date', case when p_status = 'Recebido' then current_date end,
    'shipping_type', 'Outro', 'reason', 'Aquisição', 'status', p_status, 'notes', '');
  review := public.flux_preview_movement(table_id, null, draft);
  select * into receipt from public.flux_confirm_movement(table_id, null, draft,
    review->>'token', gen_random_uuid(), 'Aquisição de periférico em ensaio');
  return receipt;
end;
$$;

set local role authenticated;
do $test$
declare
  receipt public.flux_items%rowtype;
  repeat_receipt public.flux_items%rowtype;
  bad_receipt public.flux_items%rowtype;
  asset public.inventory_items%rowtype;
  category uuid;
  other_category uuid;
  review jsonb;
  result jsonb;
  shared_event_id uuid;
  asset_id uuid;
  position_id uuid;
  original_management bigint;
  original_supply_movements bigint;
  serial_number text := 'ALDECKOT-PERIPHERAL-125-' || gen_random_uuid()::text;
  room text := 'Sala CPD';
  sector_name text := 'Frente de Loja';
  computer_serial text;
  canonical_type text := 'Gaveta';
  new_tag text := 'GVT998999';
begin
  select id into strict category from public.module_tables where module = 'inventory' order by id limit 1;
  select id into strict other_category from public.module_tables where module = 'inventory' and id <> category order by id limit 1;
  select count(*) into original_management from public.module_records;
  select count(*) into original_supply_movements from public.supply_movements;
  receipt := pg_temp.new_peripheral_receipt(serial_number, '', 'Pendente');
  perform public.flux_set_peripheral_acquisition_intent(receipt.id, category, canonical_type, sector_name);
  review := public.flux_preview_peripheral_acquisition(receipt.id);
  if review->>'state' <> 'awaiting-receipt' then raise exception 'Pending acquisition was not blocked.'; end if;
  begin
    perform public.flux_complete_peripheral_acquisition(receipt.id, 'forged');
    raise exception 'The pending acquisition was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'Recebimento ou identidade%' then raise; end if;
  end;
  perform public.flux_set_acquisition_intent_v2(receipt.id, 'none');
  if exists (select 1 from public.flux_acquisition_intents i where i.flux_item_id = receipt.id
      and (i.peripheral_kind is not null or i.peripheral_sector is not null)) then
    raise exception 'Changing destination left classified metadata behind.';
  end if;
  perform public.flux_set_peripheral_acquisition_intent(receipt.id, category, canonical_type, sector_name);
  update public.flux_items f set status = 'Recebido', received_date = current_date where f.id = receipt.id;
  review := public.flux_preview_peripheral_acquisition(receipt.id);
  if review->>'state' <> 'new' or review->>'location' <> room then raise exception 'New peripheral preview: %', review; end if;
  begin
    perform public.flux_complete_peripheral_acquisition(receipt.id, 'outdated');
    raise exception 'The outdated preview was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'O destino ou a identidade mudou%' then raise; end if;
  end;
  result := public.flux_complete_peripheral_acquisition(receipt.id, review->>'token');
  shared_event_id := (result->>'eventId')::uuid;
  asset_id := (result->>'inventoryItemId')::uuid;
  select * into strict asset from public.inventory_items i where i.id = asset_id;
  if asset.tag <> '' or asset.serial <> serial_number or asset.peripheral_kind <> canonical_type
    or asset.status <> 'Reserva' or asset.location <> room or asset.sector <> sector_name
    or not exists (select 1 from public.equipment_events e where e.id = shared_event_id and e.inventory_item_id = asset_id)
    or not exists (select 1 from public.flux_item_logs l where l.flux_item_id = receipt.id and l.event_id = shared_event_id)
    or not exists (select 1 from public.inventory_item_logs l where l.inventory_item_id = asset_id and l.event_id = shared_event_id) then
    raise exception 'The reserve peripheral or its shared history is missing.';
  end if;
  result := public.flux_complete_peripheral_acquisition(receipt.id, review->>'token');
  if result->>'alreadyApplied' <> 'true' or (result->>'inventoryItemId')::uuid <> asset_id then
    raise exception 'Retry created a second integration.';
  end if;

  repeat_receipt := pg_temp.new_peripheral_receipt(serial_number);
  perform public.flux_set_peripheral_acquisition_intent(repeat_receipt.id, other_category, canonical_type, sector_name);
  review := public.flux_preview_peripheral_acquisition(repeat_receipt.id);
  if review->>'state' <> 'category-conflict' then raise exception 'The existing classification was not found.'; end if;
  perform public.flux_set_peripheral_acquisition_intent(repeat_receipt.id, category, canonical_type, sector_name);
  review := public.flux_preview_peripheral_acquisition(repeat_receipt.id);
  if review->>'state' <> 'existing' then raise exception 'Second receipt did not reuse the serial.'; end if;
  result := public.flux_complete_peripheral_acquisition(repeat_receipt.id, review->>'token');
  if result->>'linkedExisting' <> 'true' or (result->>'inventoryItemId')::uuid <> asset_id
    or (select count(*) from public.inventory_items i where i.serial = serial_number) <> 1
    or (select count(*) from public.module_records) <> original_management
    or (select count(*) from public.supply_movements) <> original_supply_movements then
    raise exception 'The repeated serial duplicated assets, created a terminal, or credited supplies.';
  end if;

  bad_receipt := pg_temp.new_peripheral_receipt('S/N');
  perform public.flux_set_peripheral_acquisition_intent(bad_receipt.id, category, canonical_type, sector_name);
  review := public.flux_preview_peripheral_acquisition(bad_receipt.id);
  if review->>'state' <> 'invalid-identity' then raise exception 'Placeholder serial was accepted.'; end if;
  select r.payload->>'serial' into strict computer_serial from public.module_records r
    where r.management_computer_id is not null and length(btrim(r.payload->>'serial')) > 3
    order by r.id limit 1;
  bad_receipt := pg_temp.new_peripheral_receipt(computer_serial);
  perform public.flux_set_peripheral_acquisition_intent(bad_receipt.id, category, canonical_type, sector_name);
  review := public.flux_preview_peripheral_acquisition(bad_receipt.id);
  if review->>'state' <> 'conflict' then raise exception 'A management computer serial was accepted.'; end if;
  bad_receipt := pg_temp.new_peripheral_receipt(serial_number, 'IMPR998999');
  perform public.flux_set_peripheral_acquisition_intent(bad_receipt.id, category, canonical_type, sector_name);
  review := public.flux_preview_peripheral_acquisition(bad_receipt.id);
  if review->>'state' <> 'invalid-type' then raise exception 'A conflicting tag was accepted.'; end if;

  begin
    update public.inventory_items i set location = 'PDV 998', status = 'Ativo' where i.id = asset_id;
    raise exception 'A tagless peripheral was installed.';
  exception when raise_exception then
    if sqlerrm not like 'Atribua uma TAG compatível%' then raise; end if;
  end;
  begin
    update public.inventory_items i set tag = 'IMPR998999' where i.id = asset_id;
    raise exception 'A mismatched tag passed the guard.';
  exception when raise_exception then
    if sqlerrm not like 'A TAG não corresponde%' then raise; end if;
  end;
  update public.inventory_items i set tag = new_tag, sector = i.sector where i.id = asset_id;
  if not exists (select 1 from public.equipment_events e where e.inventory_item_id = asset_id
      and e.action = 'TAG do periférico atualizada' and e.metadata->>'newTag' = new_tag) then
    raise exception 'The new tag was not audited.';
  end if;
  review := public.preview_local_regularization(asset_id, 'PDV 13', sector_name, 'Ativo', 'movement');
  if review->>'blocked' <> 'true' or jsonb_array_length(review->'occupants') = 0 then
    raise exception 'An occupied slot was not blocked by the existing motor.';
  end if;
  review := public.preview_local_regularization(asset_id, 'PDV 998', sector_name, 'Ativo', 'movement');
  if review->>'blocked' <> 'false' then raise exception 'Empty slot: %', review->>'reason'; end if;
  perform public.confirm_local_regularization(asset_id, 'PDV 998', sector_name, 'Ativo', 'movement',
    'Instalação de ensaio em PDV livre', review->>'token', gen_random_uuid());
  position_id := (review->'target'->>'positionId')::uuid;
  if not exists (select 1 from public.module_records r where r.id = position_id
    and r.payload->'peripherals' @> jsonb_build_array(jsonb_build_object('sourceItemId', asset_id))) then
    raise exception 'The labeled peripheral did not link through the common motor.';
  end if;
  raise notice 'flux_peripheral_125_tagless_and_classified_installation_ok';
end;
$test$;
