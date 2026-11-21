-- ALDECKOT | Aquisição recebida com série obrigatória e TAG opcional.
begin;
create or replace function public.flux_preview_inventory_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  candidate public.inventory_items%rowtype;
  candidate_count integer := 0;
  target_id uuid;
  table_name text;
  norm_tag text;
  norm_serial text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('inventory', 'create') then
    raise exception 'Sem permissão para consultar esta aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id;
  if not found or movement.reason <> 'Aquisição' then
    raise exception 'A movimentação não é uma aquisição válida.';
  end if;
  norm_tag := nullif(lower(btrim(movement.tag)), '');
  norm_serial := nullif(lower(btrim(movement.serial)), '');
  if norm_serial is null or norm_serial in ('-', '***') then
    return jsonb_build_object('state', 'invalid-identity');
  end if;
  if norm_tag in ('-', '***') then norm_tag := null; end if;
  for candidate in select * from public.inventory_items
    where lower(btrim(serial)) = norm_serial or
          (norm_tag is not null and lower(btrim(tag)) = norm_tag)
  loop
    candidate_count := candidate_count + 1;
    if candidate_count > 1 or lower(btrim(candidate.serial)) <> norm_serial or
       (norm_tag is not null and lower(btrim(candidate.tag)) <> norm_tag) then
      return jsonb_build_object('state', 'conflict');
    end if;
    target_id := candidate.id;
    select name into table_name from public.module_tables where id = candidate.table_id;
  end loop;
  if target_id is null then
    if exists (select 1 from public.module_records r
      join public.module_tables t on t.id = r.table_id and t.module = 'management'
      where lower(btrim(r.payload->>'serial')) = norm_serial) then
      return jsonb_build_object('state', 'conflict');
    end if;
    return jsonb_build_object('state', 'new');
  end if;
  return jsonb_build_object('state', 'existing', 'inventoryItemId', target_id,
                            'tableName', table_name);
end;
$$;

create or replace function public.flux_complete_inventory_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  candidate public.inventory_items%rowtype;
  target_id uuid;
  event_id uuid;
  category_name text;
  matched_count integer := 0;
  linked_existing boolean := false;
  norm_tag text;
  norm_serial text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('inventory', 'create') then
    raise exception 'Sem permissão para concluir esta aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if not found or movement.reason <> 'Aquisição' then
    raise exception 'A movimentação não é uma aquisição válida.';
  end if;
  select * into intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if not found or intent.destination <> 'inventory' then
    raise exception 'Defina primeiro a tabela de destino do Inventário.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'inventoryItemId', intent.inventory_item_id, 'alreadyApplied', true);
  end if;
  if intent.status <> 'pending' or movement.status <> 'Recebido' then
    raise exception 'A entrada patrimonial exige recebimento confirmado no Flux.';
  end if;
  select name into category_name from public.module_tables
    where id = intent.inventory_table_id and module = 'inventory';
  if not found then raise exception 'A tabela de destino não existe mais.'; end if;
  norm_tag := nullif(lower(btrim(movement.tag)), '');
  norm_serial := nullif(lower(btrim(movement.serial)), '');
  if norm_serial is null or norm_serial in ('-', '***') then
    raise exception 'Informe um número de série válido antes de cadastrar no Inventário.';
  end if;
  if norm_tag in ('-', '***') then norm_tag := null; end if;
  perform pg_advisory_xact_lock(89116, hashtext(norm_serial));

  -- A TAG e a série podem ter registros legados conflitantes. Não escolhemos
  -- arbitrariamente um deles; uma unicidade concorrente também aborta a transação.
  for candidate in
    select * from public.inventory_items
    where lower(btrim(serial)) = norm_serial or
      (norm_tag is not null and lower(btrim(tag)) = norm_tag)
    for update
  loop
    matched_count := matched_count + 1;
    if matched_count > 1 or lower(btrim(candidate.serial)) <> norm_serial or
       (norm_tag is not null and lower(btrim(candidate.tag)) <> norm_tag) then
      raise exception 'Há conflito de TAG ou série no Inventário. Revise a identidade antes de integrar.';
    end if;
    target_id := candidate.id;
    linked_existing := true;
  end loop;

  if target_id is null then
    if exists (select 1 from public.module_records r
      join public.module_tables t on t.id = r.table_id and t.module = 'management'
      where lower(btrim(r.payload->>'serial')) = norm_serial) then
      raise exception 'A série já aparece na Gestão TI. Revise a identidade antes de cadastrar no Inventário.';
    end if;
    insert into public.inventory_items
      (table_id, equipment, model, brand, serial, tag, sector, location,
       status, situation, cleaning_type, notes, position)
    values
      (intent.inventory_table_id, movement.equipment, movement.model, movement.brand,
       movement.serial, case when norm_tag is null then '' else movement.tag end,
       '', '', 'Reserva', 'Normal', 'Não realizada', '', 0)
    returning id into target_id;
  elsif candidate.table_id is distinct from intent.inventory_table_id then
    -- O usuário confirmou vincular um registro existente, sem movê-lo de categoria.
    select name into category_name from public.module_tables where id = candidate.table_id;
    intent.inventory_table_id := candidate.table_id;
  end if;

  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     previous_status, new_status, origin_location, destination_location, reason,
     affected_modules, processing_result, metadata, actor_id)
  values
    ('flux', 'inventory-acquisition:' || p_flux_item_id::text, p_flux_item_id, target_id,
     'Aquisição recebida', null, case when linked_existing then candidate.status else 'Reserva' end,
     movement.sender_company, movement.destination_company, 'Aquisição',
     '["flux","inventory","supplies"]'::jsonb,
     jsonb_build_object('inventory', case when linked_existing then 'linked' else 'created' end,
                        'supplies', 'derived-from-inventory'),
     jsonb_build_object('fluxItemId', p_flux_item_id, 'category', category_name,
       'equipment', movement.equipment, 'model', movement.model, 'brand', movement.brand,
       'tag', movement.tag, 'serial', movement.serial, 'senderCompany', movement.sender_company,
       'destinationCompany', movement.destination_company,
       'senderResponsible', movement.sender_responsible,
       'receiverResponsible', movement.receiver_responsible,
       'sendDate', movement.send_date, 'receivedDate', movement.received_date,
       'shippingType', movement.shipping_type,
       'priority', case when movement.notes like '[[aldeckot:item-priority:%]]%'
         then split_part(split_part(movement.notes, 'item-priority:', 2), ']]', 1) else null end,
       'notes', movement.notes, 'linkedExisting', linked_existing), auth.uid())
  returning id into event_id;

  insert into public.inventory_item_logs(inventory_item_id, action, message, event_id)
  values (target_id, case when linked_existing then 'update' else 'create' end,
    left('Aquisição recebida via Flux · ' || coalesce(nullif(btrim(movement.tag), ''), 'sem TAG') || ' · série ' || movement.serial ||
         ' · categoria ' || category_name || ' · movimentação ' || p_flux_item_id::text, 500), event_id);
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
  values (p_flux_item_id, 'update',
    left(case when linked_existing then 'Equipamento existente vinculado ao Inventário' else
      'Equipamento cadastrado em Reserva no Inventário' end ||
      ' · ' || category_name || ' · TAG ' || coalesce(nullif(btrim(movement.tag), ''), 'não informada'), 500), event_id);
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
  values (event_id, 'inventory', 'applied', 1, now()), (event_id, 'flux', 'applied', 1, now());
  update public.flux_acquisition_intents set status = 'completed',
    inventory_table_id = intent.inventory_table_id, inventory_item_id = target_id,
    actor_id = auth.uid(), updated_at = now()
    where flux_item_id = p_flux_item_id;
  return jsonb_build_object('status', 'completed', 'inventoryItemId', target_id,
                            'linkedExisting', linked_existing, 'alreadyApplied', false);
end;
$$;

commit;
