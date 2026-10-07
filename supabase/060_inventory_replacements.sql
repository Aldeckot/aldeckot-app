-- ALDECKOT | Troca rastreável entre equipamentos físicos do Inventário.
-- Não importa nem duplica unidades; preserva os IDs existentes.
begin;

-- Apenas metadados de apresentação: nenhuma unidade física é copiada para Suprimentos.
alter table public.supplies add column if not exists inventory_group_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.supplies'::regclass and conname = 'inventory_catalog_is_metadata_only') then
    alter table public.supplies add constraint inventory_catalog_is_metadata_only
      check (inventory_group_key is null or (tracking_type = 'unit' and quantity_stock = 0));
  end if;
end $$;
create unique index if not exists supplies_inventory_group_key_unique
  on public.supplies (inventory_group_key) where inventory_group_key is not null;

create or replace view public.supply_stock_summary with (security_invoker = true) as
select s.id, s.name, s.category, s.brand, s.model, s.description, s.image_path, s.tracking_type,
       s.minimum_stock, s.default_location, s.inactive, s.notes, s.quantity_stock, s.created_at, s.updated_at,
       coalesce(u.total_units, 0)::integer as total_units,
       case when s.tracking_type = 'unit' then coalesce(u.available_units, 0)::integer
            else (s.quantity_stock + coalesce(v.variant_quantity, 0))::integer end as available_stock,
       case when s.inactive then 'Inativo'
            when (case when s.tracking_type = 'unit' then coalesce(u.available_units, 0) else s.quantity_stock + coalesce(v.variant_quantity, 0) end) = 0 then 'Sem estoque'
            when (case when s.tracking_type = 'unit' then coalesce(u.available_units, 0) else s.quantity_stock + coalesce(v.variant_quantity, 0) end) <= s.minimum_stock then 'Estoque baixo'
            else 'Normal' end as stock_status,
       s.inventory_group_key
from public.supplies s
left join lateral (select count(*) as total_units, count(*) filter (where status = 'Em estoque') as available_units from public.supply_units where supply_id = s.id) u on true
left join lateral (select sum(quantity_stock) as variant_quantity from public.supply_variants where supply_id = s.id) v on true;
grant select on public.supply_stock_summary to authenticated;

create or replace function public.supply_ensure_inventory_catalog(
  p_group_key text, p_name text, p_existing_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid; normalized_key text;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem organizar o catálogo.'; end if;
  normalized_key := lower(btrim(coalesce(p_group_key,'')));
  if char_length(normalized_key) not between 1 and 160 or char_length(btrim(coalesce(p_name,''))) not between 1 and 160 then
    raise exception 'Tipo de equipamento inválido.';
  end if;
  select id into result_id from public.supplies where inventory_group_key = normalized_key;
  if result_id is not null then return result_id; end if;
  if p_existing_id is not null then
    update public.supplies s set inventory_group_key = normalized_key, tracking_type = 'unit', updated_at = now()
    where s.id = p_existing_id and s.inventory_group_key is null and s.quantity_stock = 0
      and not exists (select 1 from public.supply_units u where u.supply_id = s.id)
      and not exists (select 1 from public.supply_variants v where v.supply_id = s.id)
    returning s.id into result_id;
    if result_id is not null then return result_id; end if;
  end if;
  insert into public.supplies (name, category, tracking_type, minimum_stock, inventory_group_key)
  values (btrim(p_name), 'Inventário', 'unit', 0, normalized_key)
  on conflict (inventory_group_key) where inventory_group_key is not null do nothing
  returning id into result_id;
  if result_id is null then
    select id into result_id from public.supplies where inventory_group_key = normalized_key;
  end if;
  return result_id;
end; $$;
revoke all on function public.supply_ensure_inventory_catalog(text,text,uuid) from public;
grant execute on function public.supply_ensure_inventory_catalog(text,text,uuid) to authenticated;

create or replace function public.supply_ensure_inventory_catalog_batch(p_groups jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare entry jsonb;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem organizar o catálogo.'; end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 500 then
    raise exception 'Lista de tipos de equipamento inválida.';
  end if;
  for entry in select value from jsonb_array_elements(p_groups) loop
    perform public.supply_ensure_inventory_catalog(entry->>'key', entry->>'name', nullif(entry->>'existingId','')::uuid);
  end loop;
end; $$;
revoke all on function public.supply_ensure_inventory_catalog_batch(jsonb) from public;
grant execute on function public.supply_ensure_inventory_catalog_batch(jsonb) to authenticated;

create or replace function app.prevent_inventory_supply_units() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.supplies where id = new.supply_id and inventory_group_key is not null) then
    raise exception 'Equipamentos do Inventário não podem ser duplicados como unidades de Suprimentos.';
  end if;
  return new;
end; $$;
drop trigger if exists inventory_supply_units_are_read_only on public.supply_units;
create trigger inventory_supply_units_are_read_only before insert or update of supply_id on public.supply_units
  for each row execute function app.prevent_inventory_supply_units();

create table if not exists public.inventory_replacements (
  id uuid primary key default gen_random_uuid(),
  removed_item_id uuid references public.inventory_items(id) on delete set null,
  installed_item_id uuid references public.inventory_items(id) on delete set null,
  removed_identity uuid not null,
  installed_identity uuid not null,
  removed_tag text not null,
  installed_tag text not null,
  previous_location text not null,
  removed_location text not null,
  removed_status text not null check (removed_status in ('Manutenção','Defeito','Troca')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (removed_identity <> installed_identity)
);
create index if not exists inventory_replacements_removed_idx on public.inventory_replacements (removed_identity, created_at desc);
create index if not exists inventory_replacements_installed_idx on public.inventory_replacements (installed_identity, created_at desc);

-- Restaurações existentes podem recriar os mesmos IDs: reata o vínculo sem recriar o evento.
create or replace function app.relink_inventory_replacements() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.inventory_replacements set removed_item_id = new.id
    where removed_identity = new.id and removed_item_id is null;
  update public.inventory_replacements set installed_item_id = new.id
    where installed_identity = new.id and installed_item_id is null;
  return new;
end; $$;
drop trigger if exists inventory_replacements_relink on public.inventory_items;
create trigger inventory_replacements_relink after insert on public.inventory_items
  for each row execute function app.relink_inventory_replacements();

alter table public.inventory_replacements enable row level security;
revoke all on public.inventory_replacements from anon, authenticated;
grant select on public.inventory_replacements to authenticated;
drop policy if exists "Contas ativas consultam substituições" on public.inventory_replacements;
create policy "Contas ativas consultam substituições" on public.inventory_replacements
  for select to authenticated using (app.has_active_account());

create or replace function public.inventory_replace_equipment(
  p_removed_item_id uuid, p_installed_item_id uuid, p_removed_status text,
  p_removed_location text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  outgoing public.inventory_items%rowtype;
  incoming public.inventory_items%rowtype;
  result_id uuid;
  outgoing_label text;
  incoming_label text;
begin
  if p_removed_item_id is null or p_installed_item_id is null or p_removed_item_id = p_installed_item_id then
    raise exception 'Selecione dois equipamentos físicos diferentes.';
  end if;
  if p_removed_status is null or p_removed_status not in ('Manutenção','Defeito','Troca')
    or nullif(btrim(coalesce(p_removed_location,'')), '') is null
    or nullif(btrim(coalesce(p_reason,'')), '') is null
    or char_length(btrim(p_reason)) > 500 then
    raise exception 'Informe o destino, o status e o motivo da substituição.';
  end if;
  -- Ordem fixa de bloqueio evita duas trocas simultâneas com lock invertido.
  perform 1 from public.inventory_items where id in (p_removed_item_id, p_installed_item_id) order by id for update;
  select * into outgoing from public.inventory_items where id = p_removed_item_id;
  select * into incoming from public.inventory_items where id = p_installed_item_id;
  if outgoing.id is null or incoming.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not coalesce(app.can_manage_module_table(outgoing.table_id, 'inventory', 'update'), false)
    or not coalesce(app.can_manage_module_table(incoming.table_id, 'inventory', 'update'), false) then
    raise exception 'Sem permissão para substituir equipamentos do Inventário.';
  end if;
  if outgoing.table_id <> incoming.table_id then
    raise exception 'A substituição exige equipamentos da mesma tabela do Inventário.';
  end if;
  if outgoing.status <> 'Ativo' or incoming.status <> 'Reserva' then
    raise exception 'O equipamento retirado deve estar Ativo e o substituto em Reserva.';
  end if;
  if nullif(btrim(outgoing.location), '') is null then
    raise exception 'O equipamento retirado precisa ter um local físico.';
  end if;
  outgoing_label := coalesce(nullif(btrim(outgoing.tag),''), nullif(btrim(outgoing.serial),''), outgoing.equipment);
  incoming_label := coalesce(nullif(btrim(incoming.tag),''), nullif(btrim(incoming.serial),''), incoming.equipment);

  update public.inventory_items set status = p_removed_status, location = btrim(p_removed_location)
    where id = outgoing.id;
  update public.inventory_items set status = 'Ativo', location = outgoing.location
    where id = incoming.id;
  insert into public.inventory_replacements
    (removed_item_id, installed_item_id, removed_identity, installed_identity, removed_tag, installed_tag,
     previous_location, removed_location, removed_status, reason, actor_id)
  values (outgoing.id, incoming.id, outgoing.id, incoming.id, outgoing_label, incoming_label,
    outgoing.location, btrim(p_removed_location), p_removed_status, btrim(p_reason), auth.uid())
  returning id into result_id;
  insert into public.inventory_item_logs (inventory_item_id, owner_id, action, message) values
    (outgoing.id, outgoing.owner_id, 'update', left(format('%s saiu de %s; status: %s; destino: %s; substituída por %s. Motivo: %s',
      outgoing_label, outgoing.location, p_removed_status, btrim(p_removed_location), incoming_label, btrim(p_reason)), 500)),
    (incoming.id, incoming.owner_id, 'update', left(format('%s instalada em %s em substituição a %s. Motivo: %s',
      incoming_label, outgoing.location, outgoing_label, btrim(p_reason)), 500));
  return result_id;
end; $$;
revoke all on function public.inventory_replace_equipment(uuid,uuid,text,text,text) from public;
grant execute on function public.inventory_replace_equipment(uuid,uuid,text,text,text) to authenticated;

commit;
