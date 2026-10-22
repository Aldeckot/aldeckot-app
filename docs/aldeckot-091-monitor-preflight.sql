-- SOMENTE LEITURA. Execute antes da 091; nao modifica dados.
-- A atribuicao usa o nome do terminal OU o nome do PC, mas o vinculo final
-- pertence ao ID da posicao fisica e nao acompanha futuras transferencias.
with positions as (
  select r.id, btrim(coalesce(r.payload ->> 'terminal', '')) as terminal,
    btrim(coalesce(r.payload ->> 'equipment', '')) as computer,
    r.payload
  from public.module_records r
  join public.module_tables t on t.id = r.table_id
  where t.module = 'management'
), monitors as (
  select id, upper(btrim(tag)) as tag, btrim(coalesce(location, '')) as location
  from public.inventory_items
  where upper(btrim(coalesce(tag, ''))) ~ '^AJMON[0-9]+$'
), resolution as (
  select item.id, item.tag, item.location,
    (select count(*) from positions p
      where lower(p.terminal) = lower(item.location)
        or lower(p.computer) = lower(item.location)) as name_matches,
    (select count(*) from positions p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.payload -> 'peripherals') = 'array'
          then p.payload -> 'peripherals' else '[]'::jsonb end
      ) as peripheral(value)
      where peripheral.value ->> 'sourceItemId' = item.id::text) as existing_links,
    (select min(p.terminal) from positions p
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.payload -> 'peripherals') = 'array'
          then p.payload -> 'peripherals' else '[]'::jsonb end
      ) as peripheral(value)
      where peripheral.value ->> 'sourceItemId' = item.id::text) as linked_terminal
  from monitors item
)
select jsonb_build_object(
  'checked_at', now(),
  'ajmon_items', (select count(*) from monitors),
  'already_linked', (select count(*) from resolution where existing_links = 1),
  'unlinked_with_unique_destination', (select count(*) from resolution
    where existing_links = 0 and name_matches = 1),
  'unlinked_without_destination', (select count(*) from resolution
    where existing_links = 0 and name_matches = 0),
  'ambiguous_or_duplicate', (select coalesce(jsonb_agg(
    jsonb_build_object('tag', tag, 'location', location,
      'name_matches', name_matches, 'existing_links', existing_links)
    order by tag), '[]'::jsonb)
    from resolution where name_matches > 1 or existing_links > 1),
  'legacy_monitor_conflicts', (select coalesce(jsonb_agg(
    jsonb_build_object('tag', item.tag, 'location', item.location,
      'terminal', p.terminal, 'legacy_tag', peripheral.value ->> 'status')
    order by item.tag, p.terminal), '[]'::jsonb)
    from resolution item
    join positions p on lower(p.terminal) = lower(item.location)
      or lower(p.computer) = lower(item.location)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.payload -> 'peripherals') = 'array'
        then p.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    where item.existing_links = 0
      and p.terminal !~* '^PDV[[:space:]]+[0-9]+$'
      and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
      and lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) =
        'monitor'
      and upper(btrim(coalesce(peripheral.value ->> 'status', ''))) <> item.tag),
  'unlinked_items', (select coalesce(jsonb_agg(
    jsonb_build_object('tag', tag, 'location', location,
      'name_matches', name_matches) order by tag), '[]'::jsonb)
    from resolution where existing_links = 0),
  'linked_pdv_location_mismatch', (select coalesce(jsonb_agg(
    jsonb_build_object('tag', tag, 'inventory_location', location,
      'linked_terminal', linked_terminal) order by tag), '[]'::jsonb)
    from resolution where existing_links = 1
      and linked_terminal ~* '^PDV[[:space:]]+[0-9]+$'
      and lower(location) <> lower(linked_terminal))
) as monitor_report;
