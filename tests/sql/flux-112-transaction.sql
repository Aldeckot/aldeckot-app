-- Execute SOMENTE dentro de uma transação externa com ROLLBACK em projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' limit 1), true);
end; $auth$;
set local role authenticated;

do $test$
declare
  target_table uuid;
  payload jsonb;
  preview jsonb;
  saved public.flux_items%rowtype;
  delivered public.flux_items%rowtype;
  operation_id uuid := gen_random_uuid();
  delivery_id uuid := gen_random_uuid();
begin
  select id into target_table from public.module_tables where module = 'flux'
    order by created_at desc limit 1;
  if target_table is null then raise exception 'Flux test table missing.'; end if;
  payload := jsonb_build_object(
    'table_id', target_table, 'movement', 'Envio',
    'equipment', 'Equipamento de teste transacional', 'model', 'Teste', 'brand', 'Teste',
    'serial', 'ALDECKOT-FLUX-112-' || operation_id, 'tag', '',
    'sender_company', 'Origem de teste', 'destination_company', 'Destino de teste',
    'sender_responsible', 'Teste transacional', 'receiver_responsible', '',
    'send_date', current_date, 'received_date', null,
    'shipping_type', 'Transporte Interno', 'reason', 'Transferência',
    'status', 'Pendente', 'notes', 'Revertido ao terminar o ensaio.');
  preview := public.flux_preview_movement(target_table, null, payload);
  select * into saved from public.flux_confirm_movement(target_table, null,
    payload, preview->>'token', operation_id, 'Envio criado em ensaio revertível.');
  if saved.status <> 'Pendente' or saved.tag <> '' or saved.received_date is not null
    or saved.equipment_uid is null then
    raise exception 'New send identity or state failed.';
  end if;
  select * into delivered from public.flux_confirm_delivery(saved.id, saved.updated_at,
    delivery_id, now(), 'Teste transacional', 'Transporte Interno', 'Ensaio revertível.');
  if delivered.status <> 'Entregue' or delivered.delivered_at is null
    or delivered.received_date is not null then
    raise exception 'Delivery state transition failed.';
  end if;
  perform public.flux_confirm_delivery(saved.id, saved.updated_at,
    delivery_id, delivered.delivered_at, 'Teste transacional',
    'Transporte Interno', 'Ensaio revertível.');
  if (select count(*) from public.flux_lifecycle_actions
      where flux_item_id = saved.id and kind = 'delivery') <> 1 then
    raise exception 'Delivery idempotency failed.';
  end if;
  raise notice 'flux_112_transactional_checks_ok';
end;
$test$;
