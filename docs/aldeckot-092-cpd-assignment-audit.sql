-- SOMENTE LEITURA: todos os equipamentos em Sala CPD e destinos AJMON pendentes.
-- Nomes parecidos são candidatos para revisão; esta consulta não cria associações.
with positions as (
  select r.id, btrim(coalesce(r.payload ->> 'terminal', '')) as terminal,
    btrim(coalesce(r.payload ->> 'equipment', '')) as computer,
    btrim(coalesce(r.payload ->> 'tag', '')) as computer_tag, r.payload
  from public.module_records r join public.module_tables t on t.id = r.table_id
  where t.module = 'management'
), links as (
  select p.id as position_id, p.terminal, p.computer, peripheral.value
  from positions p
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.payload -> 'peripherals') = 'array'
      then p.payload -> 'peripherals' else '[]'::jsonb end
  ) as peripheral(value)
), cpd_items as (
  select id, equipment, tag, status, location from public.inventory_items
  where lower(regexp_replace(btrim(coalesce(location, '')),
    '[[:space:]]+', ' ', 'g')) = 'sala cpd'
), cpd_conflicts as (
  select item.id, item.tag, item.equipment, links.position_id, links.terminal,
    links.computer, case when links.value ->> 'sourceItemId' = item.id::text
      then 'id' else 'tag_legada' end as match_kind
  from cpd_items item join links on
    links.value ->> 'sourceItemId' = item.id::text
    or (nullif(btrim(coalesce(links.value ->> 'sourceItemId', '')), '') is null
      and coalesce(links.value ->> 'sourceModule', 'inventory') = 'inventory'
      and nullif(btrim(coalesce(item.tag, '')), '') is not null
      and upper(btrim(coalesce(nullif(btrim(links.value ->> 'tag'), ''), links.value ->> 'status', ''))) =
        upper(btrim(item.tag)))
), unresolved as (
  select item.id, item.tag, item.location,
    lower(regexp_replace(btrim(coalesce(item.location, '')),
      '[[:space:]]+', ' ', 'g')) = 'sala cpd' as intentionally_unassigned,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'position_id', p.id, 'terminal', p.terminal, 'computer', p.computer,
      'computer_tag', p.computer_tag) order by p.terminal, p.id), '[]'::jsonb)
      from positions p
      where nullif(btrim(coalesce(item.location, '')), '') is not null
        and (regexp_replace(lower(p.terminal), '[[:space:]]+', '', 'g') =
          regexp_replace(lower(item.location), '[[:space:]]+', '', 'g')
        or (p.terminal !~* '^PDV[[:space:]]+[0-9]+$'
          and regexp_replace(lower(p.computer), '[[:space:]]+', '', 'g') =
            regexp_replace(lower(item.location), '[[:space:]]+', '', 'g')))
    ) as candidates_ignoring_spaces
  from public.inventory_items item
  where upper(btrim(coalesce(item.tag, ''))) ~ '^AJMON[0-9]+$'
    and not exists (select 1 from links
      where links.value ->> 'sourceItemId' = item.id::text)
)
select jsonb_build_object(
  'checked_at', now(),
  'cpd_inventory_items', (select count(*) from cpd_items),
  'cpd_conflicts', (select coalesce(jsonb_agg(to_jsonb(c) order by c.tag), '[]'::jsonb)
    from cpd_conflicts c),
  'unlinked_monitors', (select coalesce(jsonb_agg(to_jsonb(u) order by u.tag), '[]'::jsonb)
    from unresolved u),
  'current_positions', (select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'terminal', p.terminal, 'computer', p.computer,
    'computer_tag', p.computer_tag) order by p.terminal, p.id), '[]'::jsonb)
    from positions p),
  'cpd_rule_function_installed',
    to_regprocedure('app.inventory_location_is_unassigned(text)') is not null,
  'cpd_guard_installed', exists (
    select 1 from pg_trigger
    where tgrelid = 'public.module_records'::regclass
      and tgname = 'management_unassigned_peripheral_guard'
      and tgenabled <> 'D'
  )
) as assignment_report;

