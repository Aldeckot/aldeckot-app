-- Execute somente dentro de BEGIN/ROLLBACK externos no projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' limit 1), true);
end; $auth$;
reset role;

do $test$
declare
  source_item public.inventory_items%rowtype;
  target_location text;
  target_sector text;
  preview jsonb;
  saved public.inventory_items%rowtype;
  operation_id uuid := gen_random_uuid();
  conflict_item public.inventory_items%rowtype;
  conflict_location text;
begin
  select item.* into source_item from public.inventory_items item
    where item.status = 'Ativo' and item.location ~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(item.tag) is not null
      and exists (select 1 from public.module_records r
        join public.module_tables t on t.id = r.table_id and t.module = 'management'
        where r.payload->>'terminal' ~* '^PDV[[:space:]]+[0-9]+$'
          and app.inventory_installation_location_key(r.payload->>'terminal') <>
            app.inventory_installation_location_key(item.location)
          and not exists (select 1 from public.inventory_items occupant
            where occupant.id <> item.id and occupant.status = 'Ativo'
              and app.inventory_tag_peripheral_type(occupant.tag) =
                app.inventory_tag_peripheral_type(item.tag)
              and app.inventory_installation_location_key(occupant.location) =
                app.inventory_installation_location_key(r.payload->>'terminal'))
          and not exists (select 1 from jsonb_array_elements(
              case when jsonb_typeof(r.payload->'peripherals') = 'array'
                then r.payload->'peripherals' else '[]'::jsonb end) p(value)
            where lower(btrim(coalesce(p.value->>'type', p.value->>'tipo', '')))
              = lower(btrim(app.inventory_tag_peripheral_type(item.tag)))))
    order by item.id limit 1;
  if source_item.id is null then raise exception 'No free PDV slot fixture available.'; end if;
  select r.payload->>'terminal' into target_location
    from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where r.payload->>'terminal' ~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_installation_location_key(r.payload->>'terminal') <>
        app.inventory_installation_location_key(source_item.location)
      and not exists (select 1 from public.inventory_items occupant
        where occupant.id <> source_item.id and occupant.status = 'Ativo'
          and app.inventory_tag_peripheral_type(occupant.tag) =
            app.inventory_tag_peripheral_type(source_item.tag)
          and app.inventory_installation_location_key(occupant.location) =
            app.inventory_installation_location_key(r.payload->>'terminal'))
      and not exists (select 1 from jsonb_array_elements(
          case when jsonb_typeof(r.payload->'peripherals') = 'array'
            then r.payload->'peripherals' else '[]'::jsonb end) p(value)
        where lower(btrim(coalesce(p.value->>'type', p.value->>'tipo', '')))
          = lower(btrim(app.inventory_tag_peripheral_type(source_item.tag))))
    order by r.id limit 1;
  target_sector := source_item.sector;
  preview := public.preview_local_regularization(source_item.id,
    target_location, target_sector, 'Ativo', 'correction');
  if preview->>'blocked' <> 'false' or preview->>'token' is null then
    raise exception 'Free slot preview was blocked: %', preview->>'reason';
  end if;
  begin
    update public.module_records set payload = jsonb_set(payload, '{lastActivity}',
      to_jsonb('Concorrência simulada'::text), true)
      where id = (preview->'target'->>'positionId')::uuid;
    perform public.confirm_local_regularization(source_item.id,
      target_location, target_sector, 'Ativo', 'correction',
      'Correção de cadastro em teste revertível', preview->>'token', operation_id);
    raise exception 'Concurrent change guard did not fire.';
  exception when raise_exception then
    if sqlerrm = 'Concurrent change guard did not fire.' then raise; end if;
    if sqlerrm not like 'O equipamento ou PDV mudou%' then raise; end if;
  end;
  select * into saved from public.confirm_local_regularization(source_item.id,
    target_location, target_sector, 'Ativo', 'correction',
    'Correção de cadastro em teste revertível', preview->>'token', operation_id);
  if saved.location is distinct from target_location or not exists (
    select 1 from public.equipment_events where id = operation_id
      and action = 'Correção cadastral de local') then
    raise exception 'Regularization did not update location and event.';
  end if;
  perform public.confirm_local_regularization(source_item.id,
    target_location, target_sector, 'Ativo', 'correction',
    'Correção de cadastro em teste revertível', preview->>'token', operation_id);
  if (select count(*) from public.local_regularizations where request_id = operation_id) <> 1 then
    raise exception 'Regularization idempotency failed.';
  end if;
  select * into conflict_item from public.inventory_items i
    where i.id <> source_item.id and i.status = 'Ativo'
      and i.location ~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(i.tag) =
        app.inventory_tag_peripheral_type(source_item.tag)
    order by i.id limit 1;
  if conflict_item.id is null then raise exception 'Occupied PDV fixture not found.'; end if;
  conflict_location := conflict_item.location;
  preview := public.preview_local_regularization(source_item.id,
    conflict_location, target_sector, 'Ativo', 'movement');
  if preview->>'blocked' <> 'true' or jsonb_array_length(preview->'occupants') < 1 then
    raise exception 'Occupied PDV slot was not identified.';
  end if;
  raise notice 'local_115_free_slot_and_idempotency_ok';
end;
$test$;
