-- Execute SOMENTE com BEGIN/ROLLBACK externos em projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' limit 1), true);
end; $auth$;
set local role authenticated;

do $test$
declare
  source_table uuid;
  destination_table uuid;
  payload jsonb;
  preview jsonb;
  send_row public.flux_items%rowtype;
  delivered public.flux_items%rowtype;
  returned public.flux_items%rowtype;
  definitive_entry public.flux_items%rowtype;
  create_id uuid := gen_random_uuid();
  delivery_id uuid := gen_random_uuid();
  return_id uuid := gen_random_uuid();
  delivery_time timestamptz := '2026-10-01 10:00:00-03';
  receipt_time timestamptz := '2026-11-06 15:00:00-03';
  shipment_event uuid;
  delivery_event uuid;
  return_event uuid;
begin
  select id into strict source_table from public.module_tables
    where module = 'flux' and upper(btrim(name)) = 'SETEMBRO 2026';
  select id into strict destination_table from public.module_tables
    where module = 'flux' and upper(btrim(name)) = 'NOVEMBRO 2026';
  payload := jsonb_build_object(
    'table_id', source_table, 'movement', 'Envio',
    'equipment', 'Equipamento de teste transacional', 'model', 'Teste', 'brand', 'Teste',
    'serial', 'ALDECKOT-FLUX-113-' || create_id, 'tag', '',
    'sender_company', 'Origem de teste', 'destination_company', 'Destino de teste',
    'sender_responsible', 'Teste transacional', 'receiver_responsible', '',
    'send_date', '2026-09-29', 'received_date', null,
    'shipping_type', 'Transporte Interno', 'reason', 'Transferência',
    'status', 'Pendente', 'notes', 'Revertido ao terminar o ensaio.');
  preview := public.flux_preview_movement(source_table, null, payload);
  select * into send_row from public.flux_confirm_movement(source_table, null,
    payload, preview->>'token', create_id, 'Envio de ensaio revertível.');
  perform public.flux_confirm_movement(source_table, null,
    payload, preview->>'token', create_id, 'Envio de ensaio revertível.');
  if send_row.status is distinct from 'Pendente' or send_row.delivered_at is not null
    or send_row.received_date is not null
    or exists (select 1 from public.flux_lifecycle_actions where flux_item_id = send_row.id) then
    raise exception 'Creating an outbound record also confirmed its delivery.';
  end if;
  begin
    perform public.flux_register_return(send_row.id, destination_table, send_row.updated_at,
      gen_random_uuid(), receipt_time, 'Teste transacional', 'Destino de teste', 'Origem de teste',
      'Retorno antes da entrega', 'Reserva', 'Transporte Interno', 'Revertido.');
    raise exception 'Return without independent delivery was accepted.';
  exception when raise_exception then
    if sqlerrm not like 'Confirme a entrega%' then raise; end if;
  end;

  select * into delivered from public.flux_confirm_delivery(send_row.id, send_row.updated_at,
    delivery_id, delivery_time, 'Teste transacional', 'Transporte Interno', 'Ensaio revertível.');
  perform public.flux_confirm_delivery(send_row.id, send_row.updated_at,
    delivery_id, delivery_time, 'Teste transacional', 'Transporte Interno', 'Ensaio revertível.');
  if delivered.id is distinct from send_row.id or delivered.status is distinct from 'Entregue'
    or delivered.delivered_at is distinct from delivery_time or delivered.received_at is not null
    or exists (select 1 from public.flux_items where return_of = send_row.id) then
    raise exception 'Confirming delivery also created a physical return.';
  end if;
  select * into returned from public.flux_register_return(delivered.id,
    destination_table, delivered.updated_at, return_id, receipt_time,
    'Teste transacional', 'Destino de teste', 'Origem de teste',
    'Retorno concluído no ensaio', 'Reserva', 'Transporte Interno', 'Revertido.');
  if returned.movement <> 'Recebimento' or returned.status <> 'Recebido'
    or returned.return_of <> delivered.id or returned.table_id <> destination_table
    or returned.equipment_uid <> delivered.equipment_uid
    or returned.resolution_state <> 'Pendente'
    or returned.received_at is distinct from receipt_time
    or returned.received_date is distinct from date '2026-11-06'
    or not exists (select 1 from public.flux_items where id = send_row.id
      and table_id = source_table and send_date = date '2026-09-29' and status = 'Entregue') then
    raise exception 'Cross-period physical return failed.';
  end if;
  perform public.flux_register_return(delivered.id,
    destination_table, delivered.updated_at, return_id, receipt_time,
    'Teste transacional', 'Destino de teste', 'Origem de teste',
    'Retorno concluído no ensaio', 'Reserva', 'Transporte Interno', 'Revertido.');
  begin
    perform public.flux_register_return(delivered.id, destination_table, delivered.updated_at,
      gen_random_uuid(), receipt_time, 'Teste transacional', 'Destino de teste', 'Origem de teste',
      'Retorno concluído no ensaio', 'Reserva', 'Transporte Interno', 'Revertido.');
    raise exception 'A new request ID created a second return.';
  exception when raise_exception then
    if sqlerrm not like 'Este envio já possui retorno%' then raise; end if;
  end;
  select event_id into strict shipment_event from public.flux_reviewed_movements where request_id = create_id;
  select event_id into strict delivery_event from public.flux_lifecycle_actions
    where request_id = delivery_id and kind = 'delivery';
  select event_id into strict return_event from public.flux_lifecycle_actions
    where request_id = return_id and kind = 'return' and linked_item_id = returned.id;
  if (select count(*) from public.flux_items where return_of = delivered.id) <> 1
    or (select count(*) from public.flux_items where equipment_uid = delivered.equipment_uid) <> 2
    or (select count(*) from public.equipment_events where id in (shipment_event, delivery_event, return_event)) <> 3
    or (select count(*) from public.flux_item_logs where event_id = delivery_event) <> 1
    or (select count(*) from public.flux_item_logs where event_id = return_event) <> 2 then
    raise exception 'Return idempotency or correlated logs failed.';
  end if;

  foreach payload in array array[
    payload || jsonb_build_object('reason', 'Aquisição', 'serial', 'DEFINITIVE-ACQUISITION-' || create_id),
    payload || jsonb_build_object('reason', 'Transferência', 'serial', 'DEFINITIVE-TRANSFER-' || create_id)
  ] loop
    payload := payload || jsonb_build_object('table_id', destination_table, 'movement', 'Recebimento',
      'status', 'Recebido', 'receiver_responsible', 'Teste transacional',
      'send_date', '2026-11-05', 'received_date', '2026-11-06');
    preview := public.flux_preview_movement(destination_table, null, payload);
    select * into definitive_entry from public.flux_confirm_movement(destination_table, null,
      payload, preview->>'token', gen_random_uuid(), 'Entrada definitiva de ensaio.');
    if definitive_entry.movement is distinct from 'Recebimento'
      or definitive_entry.status is distinct from 'Recebido' or definitive_entry.return_of is not null
      or definitive_entry.resolution_state = 'Pendente' or definitive_entry.delivered_at is not null
      or exists (select 1 from public.flux_lifecycle_actions where flux_item_id = definitive_entry.id) then
      raise exception 'Definitive entry was treated as a return or a delivery.';
    end if;
  end loop;
  raise notice 'flux_113_cross_period_return_checks_ok';
end;
$test$;

do $cycles$
declare
  september_id uuid;
  october_id uuid;
  november_id uuid;
  table_id_from uuid;
  table_id_to uuid;
  physical_id uuid;
  previous_return_id uuid;
  row_sent public.flux_items%rowtype;
  row_arrived public.flux_items%rowtype;
  draft jsonb;
  review jsonb;
  departure_dates date[] := array[date '2026-09-04', date '2026-10-20'];
  delivery_times timestamptz[] := array['2026-09-05 10:00:00-03'::timestamptz, '2026-10-21 10:00:00-03'::timestamptz];
  return_times timestamptz[] := array['2026-10-02 14:00:00-03'::timestamptz, '2026-11-02 14:00:00-03'::timestamptz];
  serial_number text := 'ALDECKOT-TWO-CYCLES-' || gen_random_uuid();
begin
  select id into strict september_id from public.module_tables
    where module = 'flux' and upper(btrim(name)) = 'SETEMBRO 2026';
  select id into strict october_id from public.module_tables
    where module = 'flux' and upper(btrim(name)) = 'OUTUBRO 2026';
  select id into strict november_id from public.module_tables
    where module = 'flux' and upper(btrim(name)) = 'NOVEMBRO 2026';

  for cycle in 1..2 loop
    table_id_from := case cycle when 1 then september_id else october_id end;
    table_id_to := case cycle when 1 then october_id else november_id end;
    draft := jsonb_build_object('table_id', table_id_from, 'movement', 'Envio',
      'equipment', 'Equipamento de dois ciclos em ensaio', 'model', 'Modelo de ensaio',
      'brand', 'Marca de ensaio', 'serial', serial_number, 'tag', '',
      'sender_company', 'Matriz', 'destination_company', 'Filial de ensaio',
      'sender_responsible', 'Remetente de ensaio', 'receiver_responsible', '',
      'send_date', departure_dates[cycle], 'received_date', null, 'shipping_type', 'Transporte Interno',
      'reason', case cycle when 1 then 'Transferência' else 'Troca' end, 'status', 'Pendente', 'notes', '');
    if previous_return_id is not null then
      draft := draft || jsonb_build_object('source_module', 'flux', 'source_record_id', previous_return_id);
    end if;
    review := public.flux_preview_movement(table_id_from, null, draft);
    select * into row_sent from public.flux_confirm_movement(table_id_from, null, draft,
      review->>'token', gen_random_uuid(), 'Ciclo de ensaio');
    physical_id := coalesce(physical_id, row_sent.equipment_uid);
    select * into row_sent from public.flux_confirm_delivery(row_sent.id, row_sent.updated_at,
      gen_random_uuid(), delivery_times[cycle], 'Entregador de ensaio', 'Transporte Interno', '');
    select * into row_arrived from public.flux_register_return(row_sent.id, table_id_to,
      row_sent.updated_at, gen_random_uuid(), return_times[cycle], 'Recebedor de ensaio',
      'Filial de ensaio', 'Matriz', 'Retorno de ensaio', 'Reserva', 'Transporte Interno', '');
    if physical_id is null or row_sent.equipment_uid is distinct from physical_id
      or row_arrived.equipment_uid is distinct from physical_id
      or row_sent.source_record_id is distinct from previous_return_id
      or row_arrived.return_of is distinct from row_sent.id
      or row_arrived.table_id is distinct from table_id_to
      or row_sent.delivered_at is distinct from delivery_times[cycle]
      or row_arrived.received_at is distinct from return_times[cycle] then
      raise exception 'Cycle % lost identity, dates or links.', cycle;
    end if;
    previous_return_id := row_arrived.id;
  end loop;
  if (select count(*) from public.flux_items where equipment_uid = physical_id) <> 4
    or (select count(distinct table_id) from public.flux_items where equipment_uid = physical_id) <> 3
    or (select count(distinct a.event_id) from public.flux_lifecycle_actions a
      join public.flux_items f on f.id = a.flux_item_id where f.equipment_uid = physical_id) <> 4
    or (select count(distinct m.event_id) from public.flux_reviewed_movements m
      join public.flux_items f on f.id = m.flux_item_id where f.equipment_uid = physical_id) <> 2 then
    raise exception 'Expected two shipments, two deliveries, two returns and three periods.';
  end if;
  raise notice 'flux_113_two_cycles_checks_ok';
end;
$cycles$;
