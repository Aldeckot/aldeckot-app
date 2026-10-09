-- ALDECKOT | Metadados por modelo sem duplicar unidades do Inventário.
-- Requer 063. Preserva mínimos legados em supplies.minimum_stock como base "Sem variação".
begin;

alter table public.supply_variants add column if not exists inventory_variant_key text;
alter table public.supply_variants add column if not exists inventory_brand text not null default '';
alter table public.supply_variants add column if not exists inventory_model text not null default '';
alter table public.supply_variants drop constraint if exists supply_variants_supply_id_name_key;
create unique index if not exists supply_variants_local_name_unique
  on public.supply_variants (supply_id, name) where inventory_variant_key is null;
create unique index if not exists supply_variants_inventory_key_unique
  on public.supply_variants (supply_id, inventory_variant_key) where inventory_variant_key is not null;

create or replace function app.guard_inventory_supply_variant() returns trigger
language plpgsql set search_path = public as $$
declare catalog_key text; syncing boolean := current_setting('app.inventory_variant_sync', true) = 'on';
begin
  if tg_op = 'DELETE' then
    select inventory_group_key into catalog_key from public.supplies where id = old.supply_id;
    if catalog_key is not null then raise exception 'Variações do Inventário não podem ser excluídas.'; end if;
    return old;
  end if;
  select inventory_group_key into catalog_key from public.supplies where id = new.supply_id;
  if catalog_key is not null then
    if tg_op = 'INSERT' then
      if not syncing or new.inventory_variant_key is null or new.quantity_stock <> 0 then
        raise exception 'Variações do Inventário exigem vínculo de origem e não armazenam estoque.';
      end if;
    elsif (to_jsonb(new) - array['minimum_stock','image_path','updated_at']) is distinct from
          (to_jsonb(old) - array['minimum_stock','image_path','updated_at']) and
          (not syncing or (to_jsonb(new) - array['minimum_stock','image_path','updated_at','name','inventory_brand','inventory_model']) is distinct from
                         (to_jsonb(old) - array['minimum_stock','image_path','updated_at','name','inventory_brand','inventory_model'])) then
      raise exception 'Equipamentos do Inventário permitem editar somente imagem e mínimo em Suprimentos.';
    end if;
  elsif new.inventory_variant_key is not null then
    raise exception 'Somente o catálogo do Inventário aceita chave de modelo sincronizado.';
  end if;
  if tg_op = 'UPDATE' and old.inactive and new.quantity_stock is distinct from old.quantity_stock then
    raise exception 'Reative a variação antes de movimentar seu estoque.';
  end if;
  return new;
end; $$;

create or replace function public.supply_ensure_inventory_variants_batch(p_variants jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare entry jsonb; parent_id uuid; model_key text; model_name text; brand_name text;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem organizar modelos.'; end if;
  if jsonb_typeof(p_variants) <> 'array' or jsonb_array_length(p_variants) > 500 then
    raise exception 'Lista de modelos inválida.';
  end if;
  perform set_config('app.inventory_variant_sync', 'on', true);
  for entry in select value from jsonb_array_elements(p_variants) loop
    parent_id := nullif(entry->>'supplyId','')::uuid;
    model_key := entry->>'key';
    model_name := coalesce(nullif(btrim(entry->>'name'),''), 'Modelo não informado');
    brand_name := coalesce(btrim(entry->>'brand'), '');
    if parent_id is null or char_length(model_key) not between 1 and 240 or char_length(model_name) > 120
       or char_length(brand_name) > 120 or not exists (
         select 1 from public.supplies where id = parent_id and inventory_group_key is not null and deleted_at is null
       ) or not exists (
         select 1 from public.inventory_items source
         join public.module_tables source_table on source_table.id = source.table_id and source_table.module = 'inventory'
         where source.id = nullif(entry->>'sampleId','')::uuid
           and lower(btrim(regexp_replace(coalesce(source.brand,''), '[[:space:]]+', ' ', 'g'))) || chr(31) ||
               lower(btrim(regexp_replace(coalesce(source.model,''), '[[:space:]]+', ' ', 'g'))) = model_key
       ) then raise exception 'Vínculo de modelo inválido.'; end if;
    insert into public.supply_variants(supply_id, inventory_variant_key, name, inventory_brand, inventory_model)
    values(parent_id, model_key, model_name, brand_name, coalesce(btrim(entry->>'model'),''))
    on conflict (supply_id, inventory_variant_key) where inventory_variant_key is not null
    do update set name = excluded.name, inventory_brand = excluded.inventory_brand,
      inventory_model = excluded.inventory_model, updated_at = case
        when (public.supply_variants.name, public.supply_variants.inventory_brand, public.supply_variants.inventory_model)
          is distinct from (excluded.name, excluded.inventory_brand, excluded.inventory_model)
        then now() else public.supply_variants.updated_at end;
  end loop;
end; $$;
revoke all on function public.supply_ensure_inventory_variants_batch(jsonb) from public, anon;
grant execute on function public.supply_ensure_inventory_variants_batch(jsonb) to authenticated;

create or replace function public.supply_set_inventory_variant_minimum(p_variant_id uuid, p_minimum_stock integer)
returns void language plpgsql security definer set search_path = public as $$
declare variant public.supply_variants%rowtype; parent_name text;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem alterar mínimos.'; end if;
  if p_minimum_stock is null or p_minimum_stock < 0 then raise exception 'Informe um mínimo inteiro não negativo.'; end if;
  select * into variant from public.supply_variants where id = p_variant_id for update;
  if not found or variant.inventory_variant_key is null then raise exception 'Modelo sincronizado não encontrado.'; end if;
  if variant.minimum_stock = p_minimum_stock then return; end if;
  select name into parent_name from public.supplies where id = variant.supply_id;
  update public.supply_variants set minimum_stock = p_minimum_stock, updated_at = now() where id = variant.id;
  insert into public.supply_logs(supply_id,variant_id,action,old_value,new_value,details,actor_id)
  values(variant.supply_id,variant.id,'Mínimo da variação alterado',variant.minimum_stock::text,
    p_minimum_stock::text,format('%s · %s %s',parent_name,variant.inventory_brand,variant.inventory_model),auth.uid());
end; $$;
revoke all on function public.supply_set_inventory_variant_minimum(uuid,integer) from public, anon;
grant execute on function public.supply_set_inventory_variant_minimum(uuid,integer) to authenticated;

create or replace function app.audit_supply_catalog() returns trigger
language plpgsql security definer set search_path = public as $$
declare item_id uuid; action_name text; old_text text; new_text text;
begin
  if tg_table_name = 'supplies' then
    if tg_op = 'UPDATE' and (to_jsonb(new) - array['image_path','updated_at']) is not distinct from
      (to_jsonb(old) - array['image_path','updated_at']) then return new; end if;
    item_id := new.id;
    action_name := case when tg_op = 'INSERT' then 'Item criado' else 'Item editado' end;
  else
    if new.inventory_variant_key is not null then return new; end if;
    if tg_op = 'UPDATE' and (to_jsonb(new) - array['image_path','updated_at']) is not distinct from
      (to_jsonb(old) - array['image_path','updated_at']) then return new; end if;
    item_id := new.supply_id;
    action_name := case when tg_op = 'INSERT' then 'Variação criada' else 'Variação editada' end;
  end if;
  old_text := case when tg_op = 'INSERT' then '' else row_to_json(old)::text end;
  new_text := row_to_json(new)::text;
  if tg_op = 'UPDATE' and old_text = new_text then return new; end if;
  insert into public.supply_logs(supply_id,variant_id,action,old_value,new_value,actor_id)
  values(item_id,case when tg_table_name = 'supply_variants' then new.id else null end,
    action_name,left(old_text,2000),left(new_text,2000),auth.uid());
  return new;
end; $$;

create or replace function public.supply_set_image(p_target text, p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare item_id uuid; previous_path text; variant_name text;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem alterar imagens.'; end if;
  if p_path is not null and (p_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$'
    or length(p_path) > 100 or split_part(p_path,'/',1) <> p_id::text) then
    raise exception 'Caminho de imagem inválido.';
  end if;
  if p_target = 'supply' then
    select id,image_path into item_id,previous_path from public.supplies where id = p_id for update;
    if not found then raise exception 'Suprimento não encontrado.'; end if;
    if previous_path is not distinct from p_path then return; end if;
    update public.supplies set image_path = p_path, updated_at = now() where id = p_id;
  elsif p_target = 'variant' then
    select supply_id,image_path,name into item_id,previous_path,variant_name
      from public.supply_variants where id = p_id for update;
    if not found then raise exception 'Variação não encontrada.'; end if;
    if previous_path is not distinct from p_path then return; end if;
    update public.supply_variants set image_path = p_path, updated_at = now() where id = p_id;
  else raise exception 'Destino de imagem inválido.';
  end if;
  insert into public.supply_logs(supply_id,variant_id,action,old_value,new_value,details,actor_id)
  values(item_id,case when p_target = 'variant' then p_id else null end,
    case when previous_path is null then 'Imagem incluída' when p_path is null then 'Imagem removida' else 'Imagem substituída' end,
    coalesce(previous_path,''),coalesce(p_path,''),coalesce(variant_name,''),auth.uid());
end; $$;

-- O mínimo legado do item local corresponde ao saldo base "Sem variação".
-- Para catálogos importados, só os mínimos dos modelos sincronizados compõem o total.
create or replace view public.supply_stock_summary with (security_invoker = true) as
select s.id, s.name, s.category, s.brand, s.model, s.description, s.image_path, s.tracking_type,
       (case when s.inventory_group_key is null then s.minimum_stock else 0 end
         + coalesce(v.variant_minimum,0))::integer as minimum_stock,
       s.default_location, s.inactive, s.notes, s.quantity_stock, s.created_at, s.updated_at,
       coalesce(u.total_units,0)::integer as total_units,
       c.available_stock::integer as available_stock,
       case when s.inactive then 'Inativo'
            when (s.inventory_group_key is null and s.minimum_stock > 0
              and (case when s.tracking_type = 'unit' then coalesce(u.base_available,0) else s.quantity_stock end) < s.minimum_stock)
              or coalesce(v.variant_deficit,false) then 'Estoque baixo'
            when c.available_stock = 0 then 'Sem estoque'
            else 'Normal' end as stock_status,
       s.inventory_group_key, s.minimum_stock as base_minimum_stock
from public.supplies s
left join lateral (select count(*) as total_units,
  count(*) filter (where u.status = 'Em estoque' and coalesce(v.inactive,false) = false) as available_units,
  count(*) filter (where u.status = 'Em estoque' and u.variant_id is null) as base_available
  from public.supply_units u left join public.supply_variants v on v.id = u.variant_id
  where u.supply_id = s.id) u on true
left join lateral (select sum(v.quantity_stock) filter (where not v.inactive) as variant_quantity,
  sum(v.minimum_stock) filter (where not v.inactive) as variant_minimum,
  bool_or(v.minimum_stock > 0 and
    (case when s.tracking_type = 'unit' then
      (select count(*) from public.supply_units vu where vu.variant_id = v.id and vu.status = 'Em estoque')
    else v.quantity_stock end) < v.minimum_stock) filter (where not v.inactive) as variant_deficit
  from public.supply_variants v where v.supply_id = s.id) v on true
cross join lateral (select case when s.tracking_type = 'unit' then coalesce(u.available_units,0)
  else s.quantity_stock + coalesce(v.variant_quantity,0) end as available_stock) c
where s.deleted_at is null;
grant select on public.supply_stock_summary to authenticated;

commit;
