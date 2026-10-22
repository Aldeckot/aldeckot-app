-- SOMENTE LEITURA: investiga por que os vinculos dos PDVs passaram de 78
-- na auditoria anterior para 65 no pos-teste de 21/10/2026.
-- Nao altera equipamentos, locais, eventos ou historicos.
with positions as (
  select r.id, btrim(coalesce(r.payload ->> 'terminal', '')) as terminal,
    r.management_computer_id, r.payload
  from public.module_records r
  join public.module_tables t on t.id = r.table_id
  where t.module = 'management'
), links as (
  select p.id as position_id, p.terminal,
    peripheral.value ->> 'sourceItemId' as source_item_id,
    upper(btrim(coalesce(peripheral.value ->> 'status', ''))) as peripheral_tag,
    item.id as inventory_id, item.location as inventory_location
  from positions p
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.payload -> 'peripherals') = 'array'
      then p.payload -> 'peripherals' else '[]'::jsonb end
  ) as peripheral(value)
  left join public.inventory_items item
    on item.id::text = (peripheral.value ->> 'sourceItemId')
), pdv_inventory as (
  select item.id, item.tag, item.location
  from public.inventory_items item
  join positions p
    on p.terminal ~* '^PDV[[:space:]]+[0-9]+$'
    and lower(p.terminal) = lower(btrim(coalesce(item.location, '')))
  where app.inventory_tag_peripheral_type(item.tag) is not null
    or upper(btrim(coalesce(item.tag, ''))) ~ '^AJMON[0-9]+$'
)
select jsonb_build_object(
  'checked_at', now(),
  'links_in_all_management_positions', (select count(*) from links),
  'links_in_pdv_positions',
    (select count(*) from links where terminal ~* '^PDV[[:space:]]+[0-9]+$'),
  'links_outside_pdv',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'terminal', terminal, 'tag', peripheral_tag,
      'inventory_location', inventory_location)
      order by terminal, peripheral_tag), '[]'::jsonb)
      from links where terminal !~* '^PDV[[:space:]]+[0-9]+$'),
  'pdv_inventory_items', (select count(*) from pdv_inventory),
  'pdv_inventory_without_matching_pdv_link',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'tag', item.tag, 'location', item.location,
      'linked_elsewhere', exists (
        select 1 from links other_link where other_link.inventory_id = item.id))
      order by item.location, item.tag), '[]'::jsonb)
      from pdv_inventory item
      where not exists (
        select 1 from links link_row
        where link_row.inventory_id = item.id
          and lower(link_row.terminal) = lower(btrim(item.location))
      )),
  'links_by_position',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'terminal', p.terminal,
      'occupied', p.management_computer_id is not null,
      'peripheral_count', (
        select count(*) from links l where l.position_id = p.id))
      order by p.terminal), '[]'::jsonb)
      from positions p where p.terminal ~* '^PDV[[:space:]]+[0-9]+$'),
  'management_movement_events',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', e.id, 'at', e.created_at, 'action', e.action,
      'position_ids', e.metadata -> 'positionIds')
      order by e.created_at), '[]'::jsonb)
      from public.equipment_events e
      where e.source_module = 'management'
        and e.action in ('computer_replacement', 'computer_transfer'))
) as investigation_report;
