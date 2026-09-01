-- ALDECKOT | Central do Equipamento
-- Execute após 001_aldeckot_schema.sql, 003_control_ti.sql e 004_recent_activity.sql.

-- Pesquisa unificada. Apenas TAG e número de série participam do filtro.
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
      item.situation as cleaning,
      item.notes,
      jsonb_build_object('sector', item.sector, 'situation', item.situation) as metadata,
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

-- Linha do tempo global para o equipamento selecionado. A identidade vem da sessão protegida por RLS.
create or replace function public.central_equipment_timeline(
  p_tag text,
  p_serial text,
  p_item_ids uuid[] default array[]::uuid[]
)
returns table (
  id uuid,
  module text,
  operation text,
  description text,
  actor text,
  occurred_at timestamptz,
  details jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    sync_event.id,
    sync_event.module,
    sync_event.operation,
    coalesce(nullif(sync_event.details ->> 'description', ''), 'Registro atualizado.') as description,
    coalesce(nullif(profile.display_name, ''), 'Sessão atual') as actor,
    sync_event.created_at as occurred_at,
    sync_event.details
  from public.sync_events sync_event
  left join public.profiles profile on profile.id = sync_event.owner_id
  where sync_event.owner_id = auth.uid()
    and sync_event.operation in ('create', 'update', 'delete', 'log')
    and (
      exists (
        select 1
        from unnest(coalesce(p_item_ids, array[]::uuid[])) as selected_id
        where selected_id::text = sync_event.details ->> 'itemId'
      )
      or (
        nullif(btrim(coalesce(p_tag, '')), '') is not null
        and lower(coalesce(sync_event.details ->> 'tag', '')) = lower(btrim(p_tag))
      )
      or (
        nullif(btrim(coalesce(p_serial, '')), '') is not null
        and lower(coalesce(sync_event.details ->> 'serial', '')) = lower(btrim(p_serial))
      )
    )
  order by sync_event.created_at desc
  limit 100;
$$;

-- Flux e Gestão TI usam module_records. Cada inclusão ou edição de payload cria seu evento automaticamente.
create or replace function app.record_module_record_activity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  source_module text;
  source_table_name text;
  source_action text;
begin
  select module, name into source_module, source_table_name
  from public.module_tables
  where id = new.table_id;

  if source_module not in ('management', 'flux') then
    return new;
  end if;

  source_action := case when tg_op = 'INSERT' then 'create' else 'update' end;

  insert into public.sync_events (module, operation, details)
  values (
    source_module,
    source_action,
    jsonb_build_object(
      'itemId', new.id,
      'tableId', new.table_id,
      'tableName', source_table_name,
      'equipment', coalesce(new.payload ->> 'equipment', new.payload ->> 'equipamento', new.payload ->> 'name', ''),
      'brand', coalesce(new.payload ->> 'brand', new.payload ->> 'marca', ''),
      'tag', coalesce(new.payload ->> 'tag', new.payload ->> 'TAG', ''),
      'serial', coalesce(new.payload ->> 'serial', new.payload ->> 'numeroSerie', new.payload ->> 'numero_série', new.payload ->> 'numero_serie', ''),
      'status', coalesce(new.payload ->> 'status', ''),
      'description', coalesce(nullif(new.payload ->> 'activityDescription', ''), case when tg_op = 'INSERT' then 'Equipamento adicionado.' else 'Equipamento atualizado.' end),
      'targetUrl', ''
    )
  );
  return new;
end;
$$;

drop trigger if exists module_record_activity_event on public.module_records;
create trigger module_record_activity_event
  after insert or update of payload on public.module_records
  for each row execute procedure app.record_module_record_activity();

-- Índices direcionados à busca por TAG ou número de série.
create index if not exists inventory_items_owner_lower_tag_idx on public.inventory_items (owner_id, lower(tag)) where tag <> '';
create index if not exists inventory_items_owner_lower_serial_idx on public.inventory_items (owner_id, lower(serial)) where serial <> '';
create index if not exists control_items_owner_lower_tag_idx on public.control_items (owner_id, lower(tag)) where tag <> '';
create index if not exists control_items_owner_lower_serial_idx on public.control_items (owner_id, lower(serial)) where serial <> '';
create index if not exists module_records_owner_lower_tag_idx on public.module_records (owner_id, lower(coalesce(payload ->> 'tag', payload ->> 'TAG', '')));
create index if not exists module_records_owner_lower_serial_idx on public.module_records (owner_id, lower(coalesce(payload ->> 'serial', payload ->> 'numeroSerie', payload ->> 'numero_série', payload ->> 'numero_serie', '')));

grant execute on function public.central_equipment_search(text) to authenticated;
grant execute on function public.central_equipment_timeline(text, text, uuid[]) to authenticated;

-- Atualização em tempo real da Central. Não altera as regras de acesso: o cliente continua sujeito a RLS.
do $$
declare
  table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['inventory_items', 'inventory_item_logs', 'control_items', 'control_item_logs', 'module_records', 'sync_events']
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;
