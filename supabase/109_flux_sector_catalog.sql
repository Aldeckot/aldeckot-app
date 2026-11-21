-- ALDECKOT | Etapa 16: Setor/Local oficiais nos registros de Flux.
-- Preserva movimentações históricas; setor_code só é preenchido quando há correspondência inequívoca.
begin;

alter table public.flux_items add column if not exists sector text not null default '';
alter table public.flux_items add column if not exists sector_code text;
alter table public.flux_items add column if not exists location text not null default '';
alter table public.flux_items drop constraint if exists flux_items_sector_code_fk;
alter table public.flux_items add constraint flux_items_sector_code_fk
  foreign key (sector_code) references public.organizational_sectors(code) on update cascade on delete restrict;
create index if not exists flux_items_sector_code_idx
  on public.flux_items(sector_code) where sector_code is not null;

update public.flux_items set sector_code=app.organizational_sector_code(sector)
where sector_code is null and app.organizational_sector_code(sector) is not null;

create or replace function app.sync_flux_sector_code()
returns trigger language plpgsql security invoker set search_path=public,app as $$
declare canonical_name text;
begin
  if tg_op='UPDATE' and new.sector is distinct from old.sector then
    new.sector_code:=app.organizational_sector_code(new.sector);
  elsif new.sector_code is not null then
    select name into canonical_name from public.organizational_sectors
      where code=new.sector_code and active;
    if canonical_name is null then raise exception 'Selecione um setor ativo do catálogo.'; end if;
    new.sector:=canonical_name;
  else
    new.sector_code:=app.organizational_sector_code(new.sector);
  end if;
  return new;
end $$;
drop trigger if exists flux_items_sector_catalog_sync on public.flux_items;
create trigger flux_items_sector_catalog_sync
  before insert or update of sector,sector_code on public.flux_items
  for each row execute function app.sync_flux_sector_code();

-- Keep the common equipment lookup's result shape while exposing real Flux Sector/Local.
create or replace function public.central_equipment_search(search_term text)
returns table (id uuid, module text, table_id uuid, table_name text, equipment text, model text, brand text, serial text, tag text, status text, location text, responsible text, cleaning text, notes text, metadata jsonb, created_at timestamptz, updated_at timestamptz)
language sql stable security invoker set search_path=public as $$
  with term as (select nullif(lower(btrim(coalesce(search_term, ''))), '') as value), records as (
    select item.id, 'inventory'::text, item.table_id, tbl.name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, item.location, ''::text, item.cleaning_type, item.notes,
      jsonb_build_object('sector', item.sector, 'situation', item.situation, 'cleaningType', item.cleaning_type), item.created_at, item.updated_at
    from public.inventory_items item join public.module_tables tbl on tbl.id = item.table_id
    union all
    select item.id, 'control'::text, item.table_id, tbl.name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, ''::text, ''::text, item.cleaning_type, item.notes,
      jsonb_build_object('sector', item.sector, 'entryDate', item.entry_date, 'exitDate', item.exit_date), item.created_at, item.updated_at
    from public.control_items item join public.module_tables tbl on tbl.id = item.table_id
    union all
    select item.id, 'flux'::text, item.table_id, tbl.name, item.equipment, item.model, item.brand, item.serial, item.tag, item.status, item.location, item.receiver_responsible, ''::text, item.notes,
      jsonb_build_object('sector', item.sector, 'movement', item.movement, 'senderCompany', item.sender_company, 'destinationCompany', item.destination_company, 'senderResponsible', item.sender_responsible, 'receiverResponsible', item.receiver_responsible, 'sendDate', item.send_date, 'receivedDate', item.received_date, 'shippingType', item.shipping_type, 'reason', item.reason), item.created_at, item.updated_at
    from public.flux_items item join public.module_tables tbl on tbl.id = item.table_id
    union all
    select module_row.id, 'management'::text, module_row.table_id, tbl.name,
      coalesce(module_row.payload ->> 'equipment', module_row.payload ->> 'equipamento', module_row.payload ->> 'name', ''), coalesce(module_row.payload ->> 'model', module_row.payload ->> 'modelo', ''), coalesce(module_row.payload ->> 'brand', module_row.payload ->> 'marca', ''),
      coalesce(module_row.payload ->> 'serial', module_row.payload ->> 'numeroSerie', module_row.payload ->> 'numero_série', module_row.payload ->> 'numero_serie', ''), coalesce(module_row.payload ->> 'tag', module_row.payload ->> 'TAG', ''), coalesce(module_row.payload ->> 'status', ''),
      coalesce(module_row.payload ->> 'location', module_row.payload ->> 'local', module_row.payload ->> 'sector', module_row.payload ->> 'setor', ''), coalesce(module_row.payload ->> 'responsible', module_row.payload ->> 'responsavel', module_row.payload ->> 'responsável', ''),
      coalesce(module_row.payload ->> 'cleaningType', module_row.payload ->> 'tipoLimpeza', module_row.payload ->> 'cleaning', module_row.payload ->> 'limpeza', module_row.payload ->> 'situation', module_row.payload ->> 'situacao', ''), coalesce(module_row.payload ->> 'notes', module_row.payload ->> 'observacoes', module_row.payload ->> 'observação', ''), module_row.payload, module_row.created_at, module_row.updated_at
    from public.module_records module_row join public.module_tables tbl on tbl.id = module_row.table_id where tbl.module = 'management'
  )
  select records.* from records cross join term
  where term.value is not null and (position(term.value in lower(coalesce(records.tag, ''))) > 0 or position(term.value in lower(coalesce(records.serial, ''))) > 0)
  order by case when lower(records.tag) = term.value or lower(records.serial) = term.value then 0 else 1 end, records.updated_at desc limit 12;
$$;

grant execute on function public.central_equipment_search(text) to authenticated;

commit;
