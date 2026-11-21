-- Execute exclusivamente em transação revertida no projeto de testes.
do $fixtures$
declare
  management_table uuid;
  printer_table uuid;
  control_month text := app.current_control_maintenance_table_name();
begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
  select id into strict management_table from public.module_tables where module = 'management' order by id limit 1;
  select id into strict printer_table from public.module_tables
    where module = 'inventory' and name ilike 'IMPRESSORAS%' order by id limit 1;
  if exists (select 1 from public.module_records where table_id = management_table
      and payload->>'terminal' in ('PDV 997', 'PDV 998'))
    or exists (select 1 from public.inventory_items where tag in ('IMPR99707', 'IMPR99804')) then
    raise exception 'PDV history fixtures conflict with existing records.';
  end if;
  insert into public.module_records(table_id, position, payload)
    select management_table, p.position, jsonb_build_object('terminal', p.terminal,
      'area', 'Frente de Loja', 'sector', 'Frente de Loja', 'equipment', '',
      'logs', '[]'::jsonb, 'peripherals', '[]'::jsonb)
    from (values (99996, 'PDV 997'), (99997, 'PDV 998')) p(position, terminal);
  insert into public.inventory_items(table_id, equipment, brand, model, tag, serial, sector, location, status)
    values (printer_table, 'Impressora de ensaio IMP07', 'Marca de ensaio', 'Modelo de ensaio',
      'IMPR99707', 'ALDECKOT-127-A-' || gen_random_uuid(), 'Frente de Loja', 'PDV 997', 'Ativo'),
      (printer_table, 'Impressora de ensaio IMP04', 'Marca de ensaio', 'Modelo de ensaio',
      'IMPR99804', 'ALDECKOT-127-B-' || gen_random_uuid(), 'Frente de Loja', 'Sala CPD', 'Reserva');
  if not exists (select 1 from public.module_tables
      where module = 'control' and lower(btrim(name)) = lower(control_month)) then
    insert into public.module_tables(module, name, icon) values ('control', control_month, '🔧');
  end if;
end;
$fixtures$;

set local role authenticated;
do $history$
declare
  outgoing uuid;
  incoming uuid;
  origin_pdv uuid;
  destination_pdv uuid;
  first_replacement uuid;
  second_replacement uuid;
  correction_event uuid := gen_random_uuid();
  review jsonb;
  outcome jsonb;
  flux_count integer := (select count(*) from public.flux_items);
  control_count integer := (select count(*) from public.control_items);
  correlation_count integer;
begin
  select id into strict outgoing from public.inventory_items where tag = 'IMPR99707';
  select id into strict incoming from public.inventory_items where tag = 'IMPR99804';
  select id into strict origin_pdv from public.module_records where payload->>'terminal' = 'PDV 997';
  select id into strict destination_pdv from public.module_records where payload->>'terminal' = 'PDV 998';

  review := public.preview_local_replacement(incoming, outgoing, 'Reserva', 'Sala CPD', 'Frente de Loja');
  outcome := public.confirm_local_replacement(incoming, outgoing, 'Reserva', 'Sala CPD', 'Frente de Loja',
    'Substituição de ensaio com destino Reserva', review->>'token', gen_random_uuid());
  first_replacement := (outcome->>'replacementId')::uuid;
  if first_replacement is null or (select count(*) from public.control_items) <> control_count then
    raise exception 'Reserve replacement opened a maintenance record or omitted its ID.';
  end if;

  review := public.preview_local_regularization(incoming, 'PDV 998', 'Frente de Loja', 'Ativo', 'correction');
  perform public.confirm_local_regularization(incoming, 'PDV 998', 'Frente de Loja', 'Ativo',
    'correction', 'Correção cadastral de ensaio', review->>'token', correction_event);

  review := public.preview_local_replacement(outgoing, incoming, 'Manutenção', 'Sala CPD', 'Frente de Loja');
  outcome := public.confirm_local_replacement(outgoing, incoming, 'Manutenção', 'Sala CPD', 'Frente de Loja',
    'Substituição de ensaio com destino Manutenção', review->>'token', gen_random_uuid());
  second_replacement := (outcome->>'replacementId')::uuid;

  select count(*) into correlation_count
  from (
    select origin_pdv as position_id, h.* from public.management_movement_history(null, origin_pdv) h
    union all
    select destination_pdv, h.* from public.management_movement_history(null, destination_pdv) h
  ) h
  join public.equipment_events e on e.id = h.event_id
  where (h.event_id = correction_event or h.metadata->>'operationId' in (first_replacement::text, second_replacement::text))
    and exists (select 1 from public.inventory_item_logs l
      where l.event_id = h.event_id and l.inventory_item_id = e.inventory_item_id);
  if correlation_count <> 6 then
    raise exception 'Expected four correlated replacement legs and the correction in both PDVs.';
  end if;

  if (select count(*) from public.management_movement_history(null, origin_pdv) h
      where h.metadata->>'operationId' = first_replacement::text
      and h.reason = 'Substituição de ensaio com destino Reserva'
      and ((h.metadata->'peripheral'->>'inventoryItemId' = outgoing::text
          and h.metadata->'peripheral'->>'fromLocation' = 'PDV 997'
          and h.metadata->'peripheral'->>'toLocation' = 'Sala CPD'
          and h.metadata->>'previousStatus' = 'Ativo' and h.metadata->>'newStatus' = 'Reserva')
        or (h.metadata->'peripheral'->>'inventoryItemId' = incoming::text
          and h.metadata->'peripheral'->>'fromLocation' = 'Sala CPD'
          and h.metadata->'peripheral'->>'toLocation' = 'PDV 997'
          and h.metadata->>'previousStatus' = 'Reserva' and h.metadata->>'newStatus' = 'Ativo'))) <> 2
    or (select count(*) from public.management_movement_history(null, destination_pdv) h
      where h.metadata->>'operationId' = second_replacement::text
      and h.reason = 'Substituição de ensaio com destino Manutenção'
      and ((h.metadata->'peripheral'->>'inventoryItemId' = incoming::text
          and h.metadata->'peripheral'->>'fromLocation' = 'PDV 998'
          and h.metadata->'peripheral'->>'toLocation' = 'Sala CPD'
          and h.metadata->>'previousStatus' = 'Ativo' and h.metadata->>'newStatus' = 'Manutenção')
        or (h.metadata->'peripheral'->>'inventoryItemId' = outgoing::text
          and h.metadata->'peripheral'->>'fromLocation' = 'Sala CPD'
          and h.metadata->'peripheral'->>'toLocation' = 'PDV 998'
          and h.metadata->>'previousStatus' = 'Reserva' and h.metadata->>'newStatus' = 'Ativo'))) <> 2 then
    raise exception 'PDV history did not preserve before and after conditions or operator decision.';
  end if;

  if (select count(*) from public.management_movement_history(null, origin_pdv) h
      where h.event_id = correction_event and h.action = 'Correção cadastral de local'
      and h.metadata->>'previousStatus' = 'Ativo' and h.metadata->>'newStatus' = 'Ativo'
      and h.metadata->'peripheral'->>'fromPositionId' = origin_pdv::text
      and h.metadata->'peripheral'->>'toPositionId' = destination_pdv::text) <> 1
    or not exists (select 1 from public.inventory_item_logs
        where inventory_item_id = incoming and event_id = correction_event)
    or (select count(*) from public.flux_items) <> flux_count then
    raise exception 'The correction lost its history link or created a fictitious shipment.';
  end if;

  if not exists (select 1 from public.inventory_items where id = outgoing and status = 'Ativo' and location = 'PDV 998')
    or not exists (select 1 from public.inventory_items where id = incoming and status = 'Manutenção' and location = 'Sala CPD')
    or (select count(*) from public.control_items where inventory_item_id = incoming and status = 'Em manutenção') <> 1
    or not exists (select 1 from public.module_records r
      cross join lateral jsonb_array_elements(r.payload->'peripherals') p
      where r.id = destination_pdv and p->>'sourceItemId' = outgoing::text)
    or exists (select 1 from public.module_records r
      cross join lateral jsonb_array_elements(r.payload->'peripherals') p
      where r.id in (origin_pdv, destination_pdv) and p->>'sourceItemId' = incoming::text)
    or (select count(*) from public.inventory_items where tag in ('IMPR99707', 'IMPR99804')) <> 2 then
    raise exception 'Final PDV, inventory identities or maintenance case are inconsistent.';
  end if;
end;
$history$;
reset role;

do $access$
begin
  if has_function_privilege('anon', 'public.management_movement_history(uuid,uuid)', 'EXECUTE') then
    raise exception 'Anonymous access to PDV history was granted.';
  end if;
end;
$access$;
select 'management_127_pdv_history_states_ok';
