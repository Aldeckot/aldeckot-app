-- Execute exclusivamente em uma transação revertida no projeto de testes.
do $setup$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
end; $setup$;

create function pg_temp.new_supply_receipt(p_serial text, p_status text default 'Recebido')
returns uuid language plpgsql as $$
declare
  flux_table uuid;
  draft jsonb;
  review jsonb;
  receipt_id uuid;
begin
  select id into strict flux_table from public.module_tables where module = 'flux' order by id limit 1;
  draft := jsonb_build_object('table_id', flux_table, 'movement', 'Recebimento',
    'equipment', 'Suprimento de ensaio', 'model', 'Modelo de ensaio', 'brand', 'Marca de ensaio',
    'serial', p_serial, 'tag', '',
    'sender_company', 'Fornecedor de ensaio', 'destination_company', 'Matriz',
    'sender_responsible', 'Remetente de ensaio', 'receiver_responsible', 'Recebedor de ensaio',
    'send_date', current_date, 'received_date', case when p_status = 'Recebido' then current_date end,
    'shipping_type', 'Outro', 'reason', 'Aquisição', 'status', p_status, 'notes', '');
  review := public.flux_preview_movement(flux_table, null, draft);
  select id into strict receipt_id from public.flux_confirm_movement(flux_table, null, draft,
    review->>'token', gen_random_uuid(), 'Recebimento de suprimento em ensaio');
  return receipt_id;
end;
$$;

set local role authenticated;
do $test$
declare
  supply_id_primary uuid;
  supply_id_other uuid;
  variant_a uuid;
  variant_b uuid;
  variant_other uuid;
  mirrored_supply uuid;
  asset_serial text;
  receipt_id uuid;
  base_receipt_id uuid;
  legacy_id uuid;
  mirror_id uuid;
  review jsonb;
  outcome jsonb;
  credit_event_id uuid;
  credit_movement_id uuid;
  serial_prefix text := 'SUPPLY-126-' || gen_random_uuid()::text;
begin
  supply_id_primary := public.supply_save_item(null, 'Suprimento de ensaio 126',
    'Outros', 'Marca de ensaio', '', '', 'quantity', 0, 'Almoxarifado', '');
  supply_id_other := public.supply_save_item(null, 'Outro suprimento de ensaio 126',
    'Outros', 'Marca de ensaio', '', '', 'quantity', 0, 'Almoxarifado', '');
  variant_a := public.supply_save_variant(null, supply_id_primary, 'A', '', 0, '');
  variant_b := public.supply_save_variant(null, supply_id_primary, 'B', '', 0, '');
  variant_other := public.supply_save_variant(null, supply_id_other, 'Outra variação', '', 0, '');
  perform public.supply_adjust_quantity(supply_id_primary, null, 10, 'Saldo inicial de ensaio');
  perform public.supply_adjust_quantity(supply_id_primary, variant_a, 4, 'Saldo inicial de ensaio');
  perform public.supply_adjust_quantity(supply_id_primary, variant_b, 8, 'Saldo inicial de ensaio');

  receipt_id := pg_temp.new_supply_receipt(serial_prefix || '-A', 'Pendente');
  begin
    perform public.flux_set_supply_acquisition_intent(receipt_id, supply_id_primary, variant_other, 3);
    raise exception 'Unrelated variant was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'A variação escolhida não pertence%' then raise; end if;
  end;
  select id into strict mirrored_supply from public.supplies where inventory_group_key is not null limit 1;
  begin
    perform public.flux_set_supply_acquisition_intent(receipt_id, mirrored_supply, null, 3);
    raise exception 'Mirrored destination was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'Selecione um item próprio%' then raise; end if;
  end;
  perform public.flux_set_supply_acquisition_intent(receipt_id, supply_id_primary, variant_a, 3);
  if public.flux_preview_supply_acquisition(receipt_id)->>'state' is distinct from 'awaiting-receipt' then
    raise exception 'Pending receipt was not blocked.';
  end if;
  begin
    perform public.flux_complete_supply_acquisition(receipt_id, 'forged');
    raise exception 'Pending receipt was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'A entrada no estoque exige%' then raise; end if;
  end;

  update public.flux_items set status = 'Recebido', received_date = current_date where id = receipt_id;
  review := public.flux_preview_supply_acquisition(receipt_id);
  if review->>'state' is distinct from 'ready' or review->>'previousStock' is distinct from '4'
    or review->>'predictedStock' is distinct from '7' or review->>'token' is null then
    raise exception 'Expected preview of variant stock 4 -> 7.';
  end if;
  perform public.supply_adjust_quantity(supply_id_primary, variant_a, 2, 'Ajuste entre prévia e confirmação');
  begin
    perform public.flux_complete_supply_acquisition(receipt_id, review->>'token');
    raise exception 'Stale stock review was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'O saldo, o recebimento ou o destino mudou%' then raise; end if;
  end;
  if (select quantity_stock from public.supply_variants where id = variant_a) is distinct from 6 then
    raise exception 'Invalid review changed variant stock.';
  end if;

  review := public.flux_preview_supply_acquisition(receipt_id);
  outcome := public.flux_complete_supply_acquisition(receipt_id, review->>'token');
  credit_movement_id := (outcome->>'supplyMovementId')::uuid;
  select m.event_id into strict credit_event_id from public.supply_movements m
    where m.id = credit_movement_id and m.variant_id = variant_a
      and m.quantity = 3 and m.previous_stock = 6 and m.new_stock = 9;
  if (select quantity_stock from public.supplies where id = supply_id_primary) is distinct from 10
    or (select quantity_stock from public.supply_variants where id = variant_b) is distinct from 8
    or (select available_stock from public.supply_stock_summary where id = supply_id_primary) is distinct from 27
    or not exists (select 1 from public.supply_logs l where l.event_id = credit_event_id and l.variant_id = variant_a)
    or not exists (select 1 from public.flux_item_logs l where l.event_id = credit_event_id and l.flux_item_id = receipt_id) then
    raise exception 'Credit changed the wrong stock or lost the shared event.';
  end if;
  outcome := public.flux_complete_supply_acquisition(receipt_id, review->>'token');
  if outcome->>'alreadyApplied' is distinct from 'true'
    or (outcome->>'supplyMovementId')::uuid is distinct from credit_movement_id
    or public.flux_preview_supply_acquisition(receipt_id)->>'state' is distinct from 'completed'
    or (select quantity_stock from public.supply_variants where id = variant_a) is distinct from 9
    or (select count(*) from public.supply_movements m where m.event_id = credit_event_id) <> 1 then
    raise exception 'Retry changed stock or did not return the previous credit.';
  end if;

  base_receipt_id := pg_temp.new_supply_receipt(serial_prefix || '-BASE');
  perform public.flux_set_supply_acquisition_intent(base_receipt_id, supply_id_primary, null, 2);
  review := public.flux_preview_supply_acquisition(base_receipt_id);
  perform public.flux_complete_supply_acquisition(base_receipt_id, review->>'token');
  if (select quantity_stock from public.supplies where id = supply_id_primary) is distinct from 12
    or (select quantity_stock from public.supply_variants where id = variant_a) is distinct from 9
    or (select quantity_stock from public.supply_variants where id = variant_b) is distinct from 8
    or (select available_stock from public.supply_stock_summary where id = supply_id_primary) is distinct from 29 then
    raise exception 'Direct credit did not update only base stock and aggregate.';
  end if;

  select serial into strict asset_serial from public.inventory_items
    where char_length(btrim(serial)) > 5 and lower(btrim(serial)) not in ('não informado', 'sem série', 'sem serial')
    limit 1;
  mirror_id := pg_temp.new_supply_receipt(serial_prefix || '-MIRROR');
  perform public.flux_set_supply_acquisition_intent(mirror_id, supply_id_primary, null, 5);
  review := public.flux_preview_supply_acquisition(mirror_id);
  update public.flux_items set serial = asset_serial where id = mirror_id;
  begin
    perform public.flux_complete_supply_acquisition(mirror_id, review->>'token');
    raise exception 'Mirrored equipment was credited.';
  exception when raise_exception then
    if sqlerrm not like 'A identidade já é controlada pelo Inventário%' then raise; end if;
  end;

  legacy_id := pg_temp.new_supply_receipt(serial_prefix || '-LEGACY');
  perform public.flux_set_supply_acquisition_intent(legacy_id, supply_id_primary, null, 5);
  update public.flux_items set movement = 'Envio' where id = legacy_id;
  if public.flux_preview_supply_acquisition(legacy_id)->>'state' is distinct from 'awaiting-receipt'
    or (select available_stock from public.supply_stock_summary where id = supply_id_primary) is distinct from 29
    or to_regprocedure('public.flux_complete_supply_acquisition(uuid)') is not null
    or (select count(*) from public.supply_movements m
        where m.supply_id = supply_id_primary and m.reason = 'Aquisição recebida via Flux') <> 2 then
    raise exception 'Legacy outbound or direct endpoint bypassed the receipt guard.';
  end if;
end;
$test$;
reset role;
select 'flux_supplies_126_stock_and_review_ok';
