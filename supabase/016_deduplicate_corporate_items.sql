-- ALDECKOT | Limpeza segura de itens duplicados após a consolidação corporativa.
-- Execute este arquivo inteiro uma única vez no SQL Editor do Supabase.
--
-- Regra de segurança: TAG é a identidade preferencial; sem TAG, usa-se o número
-- de série. Quando ambos estiverem vazios, somente registros integralmente iguais
-- dentro da mesma tabela são consolidados. O primeiro cadastro é preservado.

begin;

-- INVENTÁRIO ------------------------------------------------------------------
create temp table _aldeckot_inventory_duplicate_map on commit drop as
with identities as (
  select item.id, item.table_id, item.created_at,
    case
      when nullif(btrim(coalesce(item.tag, '')), '') is not null then 'tag:' || lower(btrim(item.tag))
      when nullif(btrim(coalesce(item.serial, '')), '') is not null then 'serial:' || lower(btrim(item.serial))
      else 'record:' || md5(concat_ws(chr(31), lower(btrim(coalesce(item.equipment, ''))), lower(btrim(coalesce(item.model, ''))), lower(btrim(coalesce(item.brand, ''))), lower(btrim(coalesce(item.sector, ''))), lower(btrim(coalesce(item.location, ''))), item.status, item.situation, item.cleaning_type, lower(btrim(coalesce(item.notes, '')))))
    end as duplicate_key
  from public.inventory_items item
), ranked as (
  select id, first_value(id) over (partition by table_id, duplicate_key order by created_at, id) as retained_id
  from identities
)
select id as duplicate_id, retained_id from ranked where id <> retained_id;

update public.inventory_item_logs log
set inventory_item_id = map.retained_id
from _aldeckot_inventory_duplicate_map map
where log.inventory_item_id = map.duplicate_id;

update public.sync_events sync_event
set details = jsonb_set(
  jsonb_set(sync_event.details, '{itemId}', to_jsonb(map.retained_id::text), true),
  '{targetUrl}', to_jsonb(format('inventory.html?table=%s&item=%s', coalesce(sync_event.details ->> 'tableId', ''), map.retained_id)), true
)
from _aldeckot_inventory_duplicate_map map
where sync_event.module = 'inventory' and sync_event.details ->> 'itemId' = map.duplicate_id::text;

delete from public.inventory_items item
using _aldeckot_inventory_duplicate_map map
where item.id = map.duplicate_id;

-- CONTROLE TI -----------------------------------------------------------------
create temp table _aldeckot_control_duplicate_map on commit drop as
with identities as (
  select item.id, item.table_id, item.created_at,
    case
      when nullif(btrim(coalesce(item.tag, '')), '') is not null then 'tag:' || lower(btrim(item.tag))
      when nullif(btrim(coalesce(item.serial, '')), '') is not null then 'serial:' || lower(btrim(item.serial))
      else 'record:' || md5(concat_ws(chr(31), lower(btrim(coalesce(item.equipment, ''))), lower(btrim(coalesce(item.model, ''))), lower(btrim(coalesce(item.brand, ''))), lower(btrim(coalesce(item.sector, ''))), coalesce(item.entry_date::text, ''), coalesce(item.exit_date::text, ''), item.status, item.cleaning_type, lower(btrim(coalesce(item.notes, '')))))
    end as duplicate_key
  from public.control_items item
), ranked as (
  select id, first_value(id) over (partition by table_id, duplicate_key order by created_at, id) as retained_id
  from identities
)
select id as duplicate_id, retained_id from ranked where id <> retained_id;

update public.control_item_logs log
set control_item_id = map.retained_id
from _aldeckot_control_duplicate_map map
where log.control_item_id = map.duplicate_id;

update public.sync_events sync_event
set details = jsonb_set(
  jsonb_set(sync_event.details, '{itemId}', to_jsonb(map.retained_id::text), true),
  '{targetUrl}', to_jsonb(format('control.html?table=%s&item=%s', coalesce(sync_event.details ->> 'tableId', ''), map.retained_id)), true
)
from _aldeckot_control_duplicate_map map
where sync_event.module = 'control' and sync_event.details ->> 'itemId' = map.duplicate_id::text;

delete from public.control_items item
using _aldeckot_control_duplicate_map map
where item.id = map.duplicate_id;

-- FLUX ------------------------------------------------------------------------
create temp table _aldeckot_flux_duplicate_map on commit drop as
with identities as (
  select item.id, item.table_id, item.created_at,
    case
      when nullif(btrim(coalesce(item.tag, '')), '') is not null then 'tag:' || lower(btrim(item.tag))
      when nullif(btrim(coalesce(item.serial, '')), '') is not null then 'serial:' || lower(btrim(item.serial))
      else 'record:' || md5(concat_ws(chr(31), item.movement, lower(btrim(coalesce(item.equipment, ''))), lower(btrim(coalesce(item.model, ''))), lower(btrim(coalesce(item.brand, ''))), lower(btrim(coalesce(item.sender_company, ''))), lower(btrim(coalesce(item.destination_company, ''))), lower(btrim(coalesce(item.sender_responsible, ''))), lower(btrim(coalesce(item.receiver_responsible, ''))), coalesce(item.send_date::text, ''), coalesce(item.received_date::text, ''), item.shipping_type, item.reason, item.status, lower(btrim(coalesce(item.notes, '')))))
    end as duplicate_key
  from public.flux_items item
), ranked as (
  select id, first_value(id) over (partition by table_id, duplicate_key order by created_at, id) as retained_id
  from identities
)
select id as duplicate_id, retained_id from ranked where id <> retained_id;

update public.flux_item_logs log
set flux_item_id = map.retained_id
from _aldeckot_flux_duplicate_map map
where log.flux_item_id = map.duplicate_id;

update public.sync_events sync_event
set details = jsonb_set(
  jsonb_set(sync_event.details, '{itemId}', to_jsonb(map.retained_id::text), true),
  '{targetUrl}', to_jsonb(format('flux.html?table=%s&item=%s', coalesce(sync_event.details ->> 'tableId', ''), map.retained_id)), true
)
from _aldeckot_flux_duplicate_map map
where sync_event.module = 'flux' and sync_event.details ->> 'itemId' = map.duplicate_id::text;

delete from public.flux_items item
using _aldeckot_flux_duplicate_map map
where item.id = map.duplicate_id;

-- GESTÃO TI -------------------------------------------------------------------
create temp table _aldeckot_management_duplicate_map on commit drop as
with identities as (
  select record.id, record.table_id, record.created_at,
    case
      when nullif(btrim(coalesce(record.payload ->> 'tag', '')), '') is not null then 'tag:' || lower(btrim(record.payload ->> 'tag'))
      when nullif(btrim(coalesce(record.payload ->> 'serial', '')), '') is not null then 'serial:' || lower(btrim(record.payload ->> 'serial'))
      else 'record:' || md5((coalesce(record.payload, '{}'::jsonb) - 'logs' - 'lastActivity')::text)
    end as duplicate_key
  from public.module_records record
  join public.module_tables table_row on table_row.id = record.table_id
  where table_row.module = 'management'
), ranked as (
  select id, first_value(id) over (partition by table_id, duplicate_key order by created_at, id) as retained_id
  from identities
)
select id as duplicate_id, retained_id from ranked where id <> retained_id;

create temp table _aldeckot_management_merged_logs on commit drop as
with record_payloads as (
  select map.retained_id, record.payload
  from _aldeckot_management_duplicate_map map
  join public.module_records record on record.id = map.duplicate_id
  union
  select distinct map.retained_id, record.payload
  from _aldeckot_management_duplicate_map map
  join public.module_records record on record.id = map.retained_id
), entries as (
  select retained_id, log_entry.entry
  from record_payloads
  cross join lateral jsonb_array_elements(case when jsonb_typeof(payload -> 'logs') = 'array' then payload -> 'logs' else '[]'::jsonb end) as log_entry(entry)
)
select retained_id, jsonb_agg(distinct entry) as logs
from entries
group by retained_id;

update public.module_records record
set payload = jsonb_set(coalesce(record.payload, '{}'::jsonb), '{logs}', merged.logs, true)
from _aldeckot_management_merged_logs merged
where record.id = merged.retained_id;

update public.sync_events sync_event
set details = jsonb_set(
  jsonb_set(sync_event.details, '{itemId}', to_jsonb(map.retained_id::text), true),
  '{targetUrl}', to_jsonb(format('management.html?item=%s', map.retained_id)), true
)
from _aldeckot_management_duplicate_map map
where sync_event.module = 'management' and sync_event.details ->> 'itemId' = map.duplicate_id::text;

delete from public.module_records record
using _aldeckot_management_duplicate_map map
where record.id = map.duplicate_id;

commit;
