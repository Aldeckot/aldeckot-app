-- Executar exclusivamente sob BEGIN/ROLLBACK no projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' limit 1), true);
end; $auth$;

do $test$
declare
  flux_table public.module_tables%rowtype;
  inventory_table public.module_tables%rowtype;
  movement public.flux_items%rowtype;
  preview jsonb;
  result jsonb;
  serial_number text := 'TEST-116-' || gen_random_uuid()::text;
begin
  select * into flux_table from public.module_tables where module = 'flux' order by id limit 1;
  select * into inventory_table from public.module_tables where module = 'inventory' order by id limit 1;
  if flux_table.id is null or inventory_table.id is null then
    raise exception 'Tabelas de teste não encontradas.';
  end if;
  insert into public.flux_items (table_id, movement, equipment, model,
    brand, serial, tag, sender_company, destination_company, sender_responsible,
    receiver_responsible, send_date, received_date, shipping_type, reason, status)
  values (flux_table.id, 'Recebimento', 'Equipamento de teste',
    'Modelo de teste', 'Marca de teste', serial_number, '', 'Fornecedor de teste',
    'Matriz', 'Remetente de teste', 'Recebedor de teste', current_date,
    current_date, 'Outro', 'Aquisição', 'Recebido')
  returning * into movement;
  preview := public.flux_preview_inventory_acquisition(movement.id);
  if preview->>'state' <> 'new' then
    raise exception 'Aquisição sem TAG não foi reconhecida como nova: %', preview;
  end if;
  perform public.flux_set_acquisition_intent(movement.id, 'inventory', inventory_table.id);
  result := public.flux_complete_inventory_acquisition(movement.id);
  if result->>'status' <> 'completed' or result->>'linkedExisting' <> 'false'
    or not exists (select 1 from public.inventory_items i
      where i.id = (result->>'inventoryItemId')::uuid and i.serial = serial_number
        and i.tag = '' and i.status = 'Reserva') then
    raise exception 'Aquisição sem TAG não foi integrada corretamente: %', result;
  end if;
  result := public.flux_complete_inventory_acquisition(movement.id);
  if result->>'alreadyApplied' <> 'true' or
    (select count(*) from public.inventory_items where serial = serial_number) <> 1 then
    raise exception 'Repetição criou patrimônio duplicado.';
  end if;
  raise notice 'flux_116_tagless_acquisition_and_idempotency_ok';
end;
$test$;
