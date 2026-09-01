-- ALDECKOT | Campo de limpeza do Inventário.
-- Execute após 005_equipment_central.sql em bancos já existentes.

alter table public.inventory_items
  add column if not exists cleaning_type text not null default 'Não realizada';

alter table public.inventory_items
  drop constraint if exists inventory_items_cleaning_type_check;

alter table public.inventory_items
  add constraint inventory_items_cleaning_type_check
  check (cleaning_type in ('Completa', 'Preventiva', 'Regular', 'Não realizada'));

create index if not exists inventory_items_owner_cleaning_type_idx
  on public.inventory_items (owner_id, cleaning_type);

-- Mantém a Central do Equipamento alinhada ao novo campo de limpeza.
create or replace function public.central_equipment_search(search_term text)
returns table (
  id uuid,
  module text,
  table_id uuid,
  table_name text,
  equipment text,
  model text,
  brand text,
  serial text,
  tag text,
  status text,
  location text,
  responsible text,
  cleaning text,
  notes text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with term as (
    select nullif(lower(btrim(coalesce(search_term, ''))), '') as value
  ), records as (
    select
      item.id,
      'inventory'::text as module,
      item.table_id,
      tbl.name as table_name,
      item.equipment,
      item.model,
      item.brand,
      item.serial,
      item.tag,
      item.status,
      item.location,
      ''::text as responsible,
      item.cleaning_type as cleaning,
      item.notes,
      jsonb_build_object('sector', item.sector, 'situation', item.situation, 'cleaningType', item.cleaning_type) as metadata,
      item.created_at,
      item.updated_at
    from public.inventory_items item
    join public.module_tables tbl on tbl.id = item.table_id
    where item.owner_id = auth.uid()

    union all

    select
      item.id,
      'control'::text as module,
      item.table_id,
      tbl.name as table_name,
      item.equipment,
      item.model,
      item.brand,
      item.serial,
      item.tag,
      item.status,
      ''::text as location,
      ''::text as responsible,
      item.cleaning_type as cleaning,
      item.notes,
      jsonb_build_object('sector', item.sector, 'entryDate', item.entry_date, 'exitDate', item.exit_date) as metadata,
      item.created_at,
      item.updated_at
    from public.control_items item
    join public.module_tables tbl on tbl.id = item.table_id
    where item.owner_id = auth.uid()

    union all

    select
      module_record.id,
      tbl.module,
      module_record.table_id,
      tbl.name as table_name,
      coalesce(module_record.payload ->> 'equipment', module_record.payload ->> 'equipamento', module_record.payload ->> 'name', '') as equipment,
      coalesce(module_record.payload ->> 'model', module_record.payload ->> 'modelo', '') as model,
      coalesce(module_record.payload ->> 'brand', module_record.payload ->> 'marca', '') as brand,
      coalesce(module_record.payload ->> 'serial', module_record.payload ->> 'numeroSerie', module_record.payload ->> 'numero_série', module_record.payload ->> 'numero_serie', '') as serial,
      coalesce(module_record.payload ->> 'tag', module_record.payload ->> 'TAG', '') as tag,
      coalesce(module_record.payload ->> 'status', '') as status,
      coalesce(module_record.payload ->> 'location', module_record.payload ->> 'local', module_record.payload ->> 'sector', module_record.payload ->> 'setor', '') as location,
      coalesce(module_record.payload ->> 'responsible', module_record.payload ->> 'responsavel', module_record.payload ->> 'responsável', '') as responsible,
      coalesce(module_record.payload ->> 'cleaningType', module_record.payload ->> 'tipoLimpeza', module_record.payload ->> 'cleaning', module_record.payload ->> 'limpeza', module_record.payload ->> 'situation', module_record.payload ->> 'situacao', '') as cleaning,
      coalesce(module_record.payload ->> 'notes', module_record.payload ->> 'observacoes', module_record.payload ->> 'observação', '') as notes,
      module_record.payload as metadata,
      module_record.created_at,
      module_record.updated_at
    from public.module_records module_record
    join public.module_tables tbl on tbl.id = module_record.table_id
    where module_record.owner_id = auth.uid()
      and tbl.module in ('management', 'flux')
  )
  select records.*
  from records
  cross join term
  where term.value is not null
    and (
      position(term.value in lower(coalesce(records.tag, ''))) > 0
      or position(term.value in lower(coalesce(records.serial, ''))) > 0
    )
  order by
    case when lower(records.tag) = term.value or lower(records.serial) = term.value then 0 else 1 end,
    records.updated_at desc
  limit 12;
$$;

grant execute on function public.central_equipment_search(text) to authenticated;
