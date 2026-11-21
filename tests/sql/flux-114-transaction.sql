-- Execute somente com BEGIN/ROLLBACK externos no projeto de testes.
reset role;
do $test$
declare
  target_table uuid;
  legacy public.flux_items%rowtype;
  new_id uuid;
  serial_value text := 'ALDECKOT-FLUX-114-' || gen_random_uuid();
begin
  select id into target_table from public.module_tables where module = 'flux'
    order by created_at desc limit 1;
  insert into public.flux_items(table_id, movement, equipment, model, brand,
    serial, tag, sender_company, destination_company, sender_responsible,
    receiver_responsible, send_date, received_date, shipping_type,
    reason, status)
  values (target_table, 'Envio', 'Teste transacional', 'Teste', 'Teste',
    serial_value, '', 'Origem', 'Destino', 'Teste', '', current_date, null,
    'Transporte Interno', 'Transferência', 'Pendente') returning id into new_id;
  begin
    insert into public.flux_items(table_id, movement, equipment, model, brand,
      serial, tag, sender_company, destination_company, sender_responsible,
      receiver_responsible, send_date, received_date, shipping_type,
      reason, status)
    values (target_table, 'Envio', 'Teste duplicado', 'Teste', 'Teste',
      serial_value, '', 'Origem', 'Destino', 'Teste', '', current_date, null,
      'Transporte Interno', 'Transferência', 'Pendente');
    raise exception 'Duplicate serial guard did not fire.';
  exception when raise_exception then
    if sqlerrm = 'Duplicate serial guard did not fire.' then raise; end if;
    if sqlerrm not like 'Esta série já consta%' then raise; end if;
  end;
  begin
    update public.flux_items set delivered_at = now() + interval '1 day' where id = new_id;
    raise exception 'Future delivery guard did not fire.';
  exception when raise_exception then
    if sqlerrm = 'Future delivery guard did not fire.' then raise; end if;
    if sqlerrm <> 'A entrega não pode ter data futura.' then raise; end if;
  end;
  select * into legacy from public.flux_items where movement = 'Envio'
    and status = 'Entregue' and reason <> 'Aquisição' and delivered_at is null
    order by created_at desc limit 1;
  if legacy.id is null then raise exception 'Legacy send fixture not found.'; end if;
  begin
    insert into public.flux_items(table_id, movement, equipment, model, brand,
      serial, tag, sender_company, destination_company, sender_responsible,
      receiver_responsible, send_date, received_date, received_at, shipping_type,
      reason, status, source_module, source_record_id, return_of)
    values (target_table, 'Recebimento', legacy.equipment, legacy.model, legacy.brand,
      legacy.serial, legacy.tag, legacy.destination_company, legacy.sender_company,
      legacy.sender_responsible, 'Teste', legacy.send_date, current_date, now(),
      legacy.shipping_type, legacy.reason, 'Recebido', 'flux', legacy.id, legacy.id);
    raise exception 'Legacy return guard did not fire.';
  exception when raise_exception then
    if sqlerrm = 'Legacy return guard did not fire.' then raise; end if;
    if sqlerrm not like 'Envio antigo sem entrega%' then raise; end if;
  end;
  raise notice 'flux_114_guards_ok';
end;
$test$;
