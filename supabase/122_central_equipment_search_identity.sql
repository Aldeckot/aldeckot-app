-- Exibe identidades persistidas na busca central. Mantém o retorno e as políticas existentes.
begin;

create or replace function public.central_equipment_search(search_term text)
returns table (
  id uuid, module text, table_id uuid, table_name text, equipment text, model text,
  brand text, serial text, tag text, status text, location text, responsible text,
  cleaning text, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz
)
language sql stable security invoker set search_path = public as $$
  with term as (
    select nullif(lower(btrim(coalesce(search_term, ''))), '') as value
  ), records as (
    select i.id, 'inventory'::text as module, i.table_id, t.name, i.equipment, i.model,
      i.brand, i.serial, i.tag, i.status, i.location, ''::text, i.cleaning_type, i.notes,
      jsonb_build_object('sector', i.sector, 'situation', i.situation,
        'cleaningType', i.cleaning_type, 'inventoryItemId', i.id), i.created_at, i.updated_at
    from public.inventory_items i join public.module_tables t on t.id = i.table_id
    union all
    select c.id, 'control', c.table_id, t.name, c.equipment, c.model, c.brand, c.serial,
      c.tag, c.status, '', '', c.cleaning_type, c.notes,
      jsonb_build_object('sector', c.sector, 'entryDate', c.entry_date, 'exitDate', c.exit_date,
        'inventoryItemId', coalesce(c.verification_inventory_item_id, c.inventory_item_id),
        'computerId', c.verification_computer_id), c.created_at, c.updated_at
    from public.control_items c join public.module_tables t on t.id = c.table_id
    union all
    select f.id, 'flux', f.table_id, t.name, f.equipment, f.model, f.brand, f.serial,
      f.tag, f.status, f.location, f.receiver_responsible, '', f.notes,
      jsonb_build_object('sector', f.sector, 'movement', f.movement,
        'senderCompany', f.sender_company, 'destinationCompany', f.destination_company,
        'senderResponsible', f.sender_responsible, 'receiverResponsible', f.receiver_responsible,
        'sendDate', f.send_date, 'receivedDate', f.received_date,
        'shippingType', f.shipping_type, 'reason', f.reason,
        'inventoryItemId', f.inventory_item_id, 'equipmentUid', f.equipment_uid),
      f.created_at, f.updated_at
    from public.flux_items f join public.module_tables t on t.id = f.table_id
    union all
    select r.id, 'management', r.table_id, t.name,
      coalesce(r.payload->>'equipment', r.payload->>'equipamento', r.payload->>'name', ''),
      coalesce(r.payload->>'model', r.payload->>'modelo', ''),
      coalesce(r.payload->>'brand', r.payload->>'marca', ''),
      coalesce(r.payload->>'serial', r.payload->>'numeroSerie', r.payload->>'numero_série', r.payload->>'numero_serie', ''),
      coalesce(r.payload->>'tag', r.payload->>'TAG', ''), coalesce(r.payload->>'status', ''),
      coalesce(r.payload->>'location', r.payload->>'local', r.payload->>'sector', r.payload->>'setor', ''),
      coalesce(r.payload->>'responsible', r.payload->>'responsavel', r.payload->>'responsável', ''),
      coalesce(r.payload->>'cleaningType', r.payload->>'tipoLimpeza', r.payload->>'cleaning',
        r.payload->>'limpeza', r.payload->>'situation', r.payload->>'situacao', ''),
      coalesce(r.payload->>'notes', r.payload->>'observacoes', r.payload->>'observação', ''),
      r.payload || jsonb_build_object('computerId', r.management_computer_id),
      r.created_at, r.updated_at
    from public.module_records r join public.module_tables t on t.id = r.table_id
    where t.module = 'management'
  )
  select records.* from records cross join term
  where term.value is not null and (
    position(term.value in lower(coalesce(records.tag, ''))) > 0
    or position(term.value in lower(coalesce(records.serial, ''))) > 0)
  order by case when lower(records.tag) = term.value or lower(records.serial) = term.value
      then 0 else 1 end, records.updated_at desc, records.module, records.id
  limit 12;
$$;

revoke all on function public.central_equipment_search(text) from public, anon;
grant execute on function public.central_equipment_search(text) to authenticated;

commit;
