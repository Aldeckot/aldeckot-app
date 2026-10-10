-- ALDECKOT | Vínculo explícito da movimentação Flux com uma origem pesquisada.
-- Nenhum registro legado recebe associação inferida por TAG. Aplicar após 067.
begin;

alter table public.flux_items
  add column if not exists source_module text,
  add column if not exists source_record_id uuid,
  add column if not exists inventory_item_id uuid references public.inventory_items(id) on delete restrict;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'flux_items_source_pair_check') then
    alter table public.flux_items add constraint flux_items_source_pair_check
      check ((source_module is null and source_record_id is null) or
             (source_module in ('inventory', 'management', 'control', 'flux') and source_record_id is not null));
  end if;
end $$;

create index if not exists flux_items_source_lookup_idx
  on public.flux_items(source_module, source_record_id)
  where source_record_id is not null;
create index if not exists flux_items_inventory_identity_idx
  on public.flux_items(inventory_item_id)
  where inventory_item_id is not null;

create or replace function app.validate_flux_source_identity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  origin_tag text;
  origin_serial text;
  canonical_tag text;
  canonical_serial text;
begin
  if new.source_module is null then
    if new.source_record_id is not null or new.inventory_item_id is not null then
      raise exception 'Selecione uma origem válida para vincular a movimentação.';
    end if;
    return new;
  end if;

  if new.source_module = 'inventory' then
    select tag, serial into origin_tag, origin_serial
      from public.inventory_items where id = new.source_record_id;
    if new.inventory_item_id is distinct from new.source_record_id then
      raise exception 'O vínculo patrimonial precisa apontar para o item selecionado.';
    end if;
  elsif new.source_module = 'control' then
    select tag, serial into origin_tag, origin_serial
      from public.control_items where id = new.source_record_id;
  elsif new.source_module = 'management' then
    select coalesce(r.payload->>'tag', r.payload->>'TAG', ''),
           coalesce(r.payload->>'serial', r.payload->>'numeroSerie', r.payload->>'numero_série', r.payload->>'numero_serie', '')
      into origin_tag, origin_serial
      from public.module_records r join public.module_tables t on t.id = r.table_id
      where r.id = new.source_record_id and t.module = 'management';
  elsif new.source_module = 'flux' then
    if new.source_record_id = new.id then
      raise exception 'Uma movimentação não pode ser sua própria origem.';
    end if;
    select tag, serial into origin_tag, origin_serial
      from public.flux_items where id = new.source_record_id;
  else
    raise exception 'Origem de equipamento inválida.';
  end if;

  if not found then
    raise exception 'O registro de origem não existe mais. Pesquise novamente.';
  end if;
  if nullif(lower(btrim(coalesce(origin_tag, ''))), '') is distinct from
     nullif(lower(btrim(coalesce(new.tag, ''))), '') or
     nullif(lower(btrim(coalesce(origin_serial, ''))), '') is distinct from
     nullif(lower(btrim(coalesce(new.serial, ''))), '') then
    raise exception 'TAG ou série difere da origem selecionada. Pesquise novamente ou retire o vínculo.';
  end if;

  if new.inventory_item_id is not null then
    select tag, serial into canonical_tag, canonical_serial
      from public.inventory_items where id = new.inventory_item_id;
    if not found or lower(btrim(coalesce(canonical_tag, ''))) <> lower(btrim(new.tag)) or
       lower(btrim(coalesce(canonical_serial, ''))) <> lower(btrim(new.serial)) then
      raise exception 'O ID patrimonial não corresponde à TAG e à série informadas.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists flux_source_identity_guard on public.flux_items;
create trigger flux_source_identity_guard
  before insert or update of source_module, source_record_id, inventory_item_id, tag, serial
  on public.flux_items for each row execute function app.validate_flux_source_identity();

commit;
