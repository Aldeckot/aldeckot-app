-- ALDECKOT | Módulo Gestão TI
-- Execute após 004_recent_activity.sql e 005_equipment_central.sql.
-- A Gestão TI utiliza module_records com payload tipado pela aplicação, mantendo RLS privado.

create index if not exists management_records_owner_updated_idx
  on public.module_records (owner_id, updated_at desc);

-- Eventos da Gestão TI alimentam a Home e a Central do Equipamento com destino direto ao registro.
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
  source_payload jsonb;
begin
  select module, name into source_module, source_table_name
  from public.module_tables
  where id = new.table_id;

  if source_module <> 'management' then
    return new;
  end if;

  source_payload := coalesce(new.payload, '{}'::jsonb);
  source_action := case when tg_op = 'INSERT' then 'create' else 'update' end;

  insert into public.sync_events (module, operation, details)
  values (
    'management',
    source_action,
    jsonb_build_object(
      'itemId', new.id,
      'tableId', new.table_id,
      'tableName', coalesce(source_table_name, 'Infraestrutura ALDECKOT'),
      'equipment', coalesce(source_payload ->> 'equipment', source_payload ->> 'name', 'Equipamento'),
      'brand', coalesce(source_payload ->> 'brand', ''),
      'serial', coalesce(source_payload ->> 'serial', source_payload ->> 'numeroSerie', ''),
      'tag', coalesce(source_payload ->> 'tag', ''),
      'status', coalesce(source_payload ->> 'status', 'Ativo'),
      'description', coalesce(nullif(source_payload ->> 'lastActivity', ''), case when tg_op = 'INSERT' then 'Equipamento cadastrado na Gestão TI.' else 'Equipamento atualizado na Gestão TI.' end),
      'targetUrl', format('management.html?item=%s', new.id)
    )
  );
  return new;
end;
$$;

drop trigger if exists module_record_activity_event on public.module_records;
create trigger module_record_activity_event
  after insert or update of payload on public.module_records
  for each row execute procedure app.record_module_record_activity();
