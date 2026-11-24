-- Foto oficial por identidade física confirmada. Migração aditiva; executar só após validação no ambiente de desenvolvimento.
begin;

create table if not exists public.equipment_photos (
  equipment_id uuid primary key,
  image_path text not null check (image_path = '' or image_path ~ '^equipment/[0-9a-f-]{36}/[0-9a-f]{32}\.(png|jpg|webp)$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists equipment_photos_path_idx on public.equipment_photos(image_path)
  where image_path <> '';
alter table public.equipment_photos enable row level security;
revoke all on public.equipment_photos from anon, authenticated;
grant select on public.equipment_photos to authenticated;
drop policy if exists "Contas ativas consultam fotos dos equipamentos" on public.equipment_photos;
create policy "Contas ativas consultam fotos dos equipamentos" on public.equipment_photos
  for select to authenticated using (app.has_active_account());

create or replace function app.equipment_photo_candidates(p_module text, p_id uuid)
returns uuid[] language plpgsql stable security definer
set search_path = pg_catalog, public, app, pg_temp as $$
declare
  ids uuid[] := array[p_id];
  inv uuid; mgmt uuid; supply uuid; uid uuid; src_module text; src_id uuid;
  resolved_inv uuid; resolved_mgmt uuid; resolved_supply uuid;
  linked uuid;
begin
  if p_id is null or p_module not in ('inventory','control','flux','management','supplies') then
    raise exception 'Identidade do equipamento inválida.';
  end if;
  if p_module = 'inventory' then
    select id into inv from public.inventory_items where id = p_id;
    if inv is null then raise exception 'Equipamento do Inventário não encontrado.'; end if;
  elsif p_module = 'control' then
    select inventory_item_id, management_record_id, supply_unit_id
      into inv, mgmt, supply from public.control_items where id = p_id;
    if not found then raise exception 'Equipamento do Controle TI não encontrado.'; end if;
  elsif p_module = 'flux' then
    select inventory_item_id, management_computer_id, equipment_uid, source_module, source_record_id
      into inv, mgmt, uid, src_module, src_id from public.flux_items where id = p_id;
    if not found then raise exception 'Movimentação do Flux não encontrada.'; end if;
    if src_module = 'inventory' then inv := coalesce(inv, src_id); end if;
    if src_module = 'management' then mgmt := coalesce(mgmt, src_id); end if;
    if src_module = 'supplies' then supply := src_id; end if;
    if src_module = 'control' then
      ids := array_append(ids, src_id);
      select inventory_item_id, management_record_id, supply_unit_id
        into resolved_inv, resolved_mgmt, resolved_supply
        from public.control_items where id = src_id;
      inv := coalesce(inv, resolved_inv);
      mgmt := coalesce(mgmt, resolved_mgmt);
      supply := coalesce(supply, resolved_supply);
    end if;
  elsif p_module = 'supplies' then
    select installed_inventory_item_id, installed_management_record_id
      into inv, mgmt from public.supply_units where id = p_id;
    if not found then raise exception 'Unidade de Suprimentos não encontrada.'; end if;
    supply := p_id;
  else
    select r.id into mgmt from public.module_records r
      join public.module_tables t on t.id = r.table_id
      where r.id = p_id and t.module = 'management';
    if mgmt is null then raise exception 'Registro da Gestão TI não encontrado.'; end if;
  end if;
  -- Somente chaves estrangeiras explícitas ampliam a identidade física.
  -- Nunca combinar equipamentos por TAG, número de série ou nome.
  if inv is not null and mgmt is null then
    select management_record_id into resolved_mgmt from public.control_items
      where inventory_item_id = inv and management_record_id is not null limit 1;
    mgmt := resolved_mgmt;
  end if;
  if mgmt is not null and inv is null then
    select inventory_item_id into resolved_inv from public.control_items
      where management_record_id = mgmt and inventory_item_id is not null limit 1;
    inv := resolved_inv;
  end if;
  if inv is not null then ids := array_append(ids, inv); end if;
  if mgmt is not null then ids := array_append(ids, mgmt); end if;
  if supply is not null then ids := array_append(ids, supply); end if;
  if uid is not null then ids := array_append(ids, uid); end if;
  if inv is not null then
    for linked in select id from public.control_items where inventory_item_id = inv loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select management_record_id from public.control_items
      where inventory_item_id = inv and management_record_id is not null loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select id from public.supply_units where installed_inventory_item_id = inv loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select distinct equipment_uid from public.flux_items
      where inventory_item_id = inv and equipment_uid is not null loop
      ids := array_append(ids, linked);
    end loop;
  end if;
  if mgmt is not null then
    for linked in select id from public.control_items where management_record_id = mgmt loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select inventory_item_id from public.control_items
      where management_record_id = mgmt and inventory_item_id is not null loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select id from public.supply_units where installed_management_record_id = mgmt loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select distinct equipment_uid from public.flux_items
      where (management_computer_id = mgmt or (source_module = 'management' and source_record_id = mgmt))
        and equipment_uid is not null loop
      ids := array_append(ids, linked);
    end loop;
  end if;
  if supply is not null then
    for linked in select id from public.control_items where supply_unit_id = supply loop
      ids := array_append(ids, linked);
    end loop;
    for linked in select distinct equipment_uid from public.flux_items
      where source_module = 'supplies' and source_record_id = supply
        and equipment_uid is not null loop
      ids := array_append(ids, linked);
    end loop;
  end if;
  if p_module = 'control' then
    for linked in select distinct equipment_uid from public.flux_items
      where source_module = 'control' and source_record_id = p_id
        and equipment_uid is not null loop
      ids := array_append(ids, linked);
    end loop;
  end if;
  return array(select distinct candidate.id from unnest(ids) as candidate(id) where candidate.id is not null);
end;
$$;
revoke all on function app.equipment_photo_candidates(text,uuid) from public, anon, authenticated;

create or replace function public.equipment_photo_get(p_module text, p_id uuid)
returns text language plpgsql stable security definer
set search_path = pg_catalog, public, app, pg_temp as $$
declare ids uuid[]; result text; matches integer;
begin
  if not app.has_active_account() then raise exception 'Conta inativa.'; end if;
  ids := app.equipment_photo_candidates(p_module, p_id);
  select count(*), max(image_path) into matches, result
    from public.equipment_photos where equipment_id = any(ids);
  if matches > 1 then
    raise exception 'Mais de uma fotografia oficial foi encontrada para os vínculos. Regularize a identidade antes de consultar.';
  end if;
  return result;
end;
$$;
revoke all on function public.equipment_photo_get(text,uuid) from public, anon;
grant execute on function public.equipment_photo_get(text,uuid) to authenticated;

create or replace function public.equipment_photo_set(p_module text, p_id uuid, p_path text, p_expected_path text default null)
returns text language plpgsql security definer
set search_path = pg_catalog, public, app, pg_temp as $$
declare ids uuid[]; canonical uuid; old_path text; existing_count integer;
  inv uuid; mgmt uuid; supply uuid; uid uuid; linked uuid;
  src_module text; src_id uuid; resolved_inv uuid; resolved_mgmt uuid; resolved_supply uuid;
begin
  if not app.is_admin() then raise exception 'Apenas administradores alteram fotos.'; end if;
  if p_path is not null and p_path !~ '^equipment/[0-9a-f-]{36}/[0-9a-f]{32}\.(png|jpg|webp)$' then
    raise exception 'Caminho da fotografia inválido.';
  end if;
  if p_path is not null and not exists (
    select 1 from storage.objects where bucket_id = 'supply-images' and name = p_path
  ) then raise exception 'O arquivo da fotografia ainda não foi confirmado no armazenamento.';
  end if;
  ids := app.equipment_photo_candidates(p_module, p_id);
  for linked in select distinct candidate.id from unnest(ids) as candidate(id)
    order by candidate.id loop
    perform pg_advisory_xact_lock(hashtextextended(linked::text, 0));
  end loop;
  select count(*), max(image_path), (array_agg(equipment_id))[1]
    into existing_count, old_path, canonical
    from public.equipment_photos where equipment_id = any(ids);
  if existing_count > 1 then raise exception 'Mais de uma fotografia oficial foi encontrada para os vínculos. Regularize a identidade antes de alterar.'; end if;
  if old_path is distinct from p_expected_path then raise exception 'A fotografia foi alterada por outra sessão. Atualize e tente novamente.'; end if;
  if old_path is not distinct from p_path or (p_path is null and old_path = '') then return old_path; end if;
  -- A primeira foto pertence à identidade persistente do equipamento,
  -- não ao ID de uma movimentação mensal do Flux.
  if canonical is null then
    if p_module = 'inventory' then inv := p_id;
    elsif p_module = 'management' then mgmt := p_id;
    elsif p_module = 'control' then
      select inventory_item_id, management_record_id, supply_unit_id
        into inv, mgmt, supply from public.control_items where id = p_id;
    elsif p_module = 'supplies' then
      select installed_inventory_item_id, installed_management_record_id
        into inv, mgmt from public.supply_units where id = p_id;
      supply := p_id;
    elsif p_module = 'flux' then
      select inventory_item_id, management_computer_id, equipment_uid, source_module, source_record_id
        into inv, mgmt, uid, src_module, src_id from public.flux_items where id = p_id;
      if src_module = 'inventory' then inv := coalesce(inv, src_id); end if;
      if src_module = 'management' then mgmt := coalesce(mgmt, src_id); end if;
      if src_module = 'supplies' then supply := src_id; end if;
      if src_module = 'control' then
        select inventory_item_id, management_record_id, supply_unit_id
          into resolved_inv, resolved_mgmt, resolved_supply
          from public.control_items where id = src_id;
        inv := coalesce(inv, resolved_inv);
        mgmt := coalesce(mgmt, resolved_mgmt);
        supply := coalesce(supply, resolved_supply);
      end if;
    end if;
    canonical := coalesce(inv, mgmt, supply, uid, p_id);
  end if;
  if p_path is null then
    insert into public.equipment_photos(equipment_id,image_path,updated_by)
      values(canonical,'',auth.uid())
      on conflict(equipment_id) do update set image_path = '',
        updated_by = excluded.updated_by, updated_at = now();
  else
    insert into public.equipment_photos(equipment_id,image_path,updated_by)
      values(canonical,p_path,auth.uid())
      on conflict(equipment_id) do update set image_path = excluded.image_path,
        updated_by = excluded.updated_by, updated_at = now();
  end if;
  if p_module = 'inventory' then inv := p_id;
  elsif p_module = 'control' then select inventory_item_id into inv from public.control_items where id = p_id;
  elsif p_module = 'flux' then
    select inventory_item_id, source_module, source_record_id, management_computer_id
      into inv, src_module, src_id, mgmt from public.flux_items where id = p_id;
    if inv is null and src_module = 'inventory' then inv := src_id; end if;
    if inv is null and src_module = 'control' then
      select inventory_item_id into inv from public.control_items where id = src_id;
    end if;
    if inv is null and src_module = 'supplies' then
      select installed_inventory_item_id into inv from public.supply_units where id = src_id;
    end if;
    if inv is null and mgmt is not null then
      select inventory_item_id into inv from public.control_items
        where management_record_id = mgmt and inventory_item_id is not null limit 1;
    end if;
  elsif p_module = 'supplies' then select installed_inventory_item_id into inv from public.supply_units where id = p_id;
  end if;
  insert into public.equipment_events(source_module,source_event_key,source_id,inventory_item_id,action,
    affected_modules,metadata,actor_id)
    values(p_module,'photo:' || gen_random_uuid()::text,p_id,inv,
      case when p_path is null then 'Foto removida' when old_path is null or old_path = '' then 'Foto adicionada' else 'Foto substituída' end,
      jsonb_build_array(p_module),
      jsonb_build_object('equipment_id',canonical,'previous_path',old_path,'new_path',p_path),auth.uid());
  return old_path;
end;
$$;
revoke all on function public.equipment_photo_set(text,uuid,text,text) from public, anon;
grant execute on function public.equipment_photo_set(text,uuid,text,text) to authenticated;

commit;
