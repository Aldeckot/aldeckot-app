-- ALDECKOT | Identidade patrimonial, variações e eventos de manutenção do Flux.
-- Requer 060_inventory_replacements.sql. Preserva unidades e históricos existentes.
begin;

-- O antigo status patrimonial Troca passa a ser Inativo. Motivos do Flux chamados
-- Troca continuam sendo motivos de movimentação, não status de patrimônio.
alter table public.inventory_items drop constraint if exists inventory_items_status_check;
create temporary table aldeckot_migrated_inactive on commit drop as
  select id from public.inventory_items where status = 'Troca';
update public.inventory_items set status = 'Inativo' where status = 'Troca';
alter table public.inventory_items add constraint inventory_items_status_check
  check (status in ('Ativo','Reserva','Manutenção','Inativo','Defeito','Atenção'));
insert into public.inventory_item_logs (inventory_item_id, action, message)
select migrated.id, 'update', 'Status patrimonial legado Troca migrado para Inativo (migração 061).'
from pg_temp.aldeckot_migrated_inactive migrated
join public.inventory_items on inventory_items.id = migrated.id
where inventory_items.status = 'Inativo'
  and not exists (select 1 from public.inventory_item_logs l where l.inventory_item_id = inventory_items.id
    and l.message = 'Status patrimonial legado Troca migrado para Inativo (migração 061).');

alter table public.inventory_replacements drop constraint if exists inventory_replacements_removed_status_check;
alter table public.inventory_replacements add constraint inventory_replacements_removed_status_check
  check (removed_status in ('Manutenção','Defeito','Troca','Inativo'));
-- Marcadores legados '-' e '***' não são TAGs reais. A unicidade é aplicada
-- apenas aos identificadores operacionais válidos, sem alterar esses dados.
create unique index if not exists inventory_items_valid_tag_unique_idx
  on public.inventory_items (lower(btrim(tag)))
  where btrim(tag) <> '' and btrim(tag) not in ('-','***');

-- Registros do Inventário no catálogo são metadados visuais, nunca uma segunda
-- fonte de dados operacionais. O vínculo inicial da migração 060 permanece válido.
create or replace function app.guard_inventory_supply_catalog() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.inventory_group_key is not null then raise exception 'Item sincronizado do Inventário não pode ser excluído em Suprimentos.'; end if;
    return old;
  end if;
  if old.deleted_at is not null then raise exception 'O cadastro excluído não pode ser editado.'; end if;
  if old.inventory_group_key is not null and
    (to_jsonb(new) - array['image_path','updated_at']) is distinct from
    (to_jsonb(old) - array['image_path','updated_at']) then
    raise exception 'Itens sincronizados do Inventário permitem editar somente a imagem.';
  end if;
  return new;
end; $$;
alter table public.supplies add column if not exists deleted_at timestamptz;
drop trigger if exists inventory_supply_catalog_read_only on public.supplies;
create trigger inventory_supply_catalog_read_only before update or delete on public.supplies
  for each row execute function app.guard_inventory_supply_catalog();

alter table public.supply_variants add column if not exists inactive boolean not null default false;
alter table public.supply_logs add column if not exists variant_id uuid references public.supply_variants(id) on delete set null;
create index if not exists supply_variants_active_idx on public.supply_variants (supply_id, inactive);

create or replace function app.guard_inventory_supply_variant() returns trigger
language plpgsql set search_path = public as $$
declare catalog_key text;
begin
  if tg_op = 'DELETE' then
    select inventory_group_key into catalog_key from public.supplies where id = old.supply_id;
    if catalog_key is not null then raise exception 'Variações do Inventário são somente leitura.'; end if;
    return old;
  end if;
  select inventory_group_key into catalog_key from public.supplies where id = new.supply_id;
  if catalog_key is not null then raise exception 'Variações do Inventário são somente leitura.'; end if;
  if tg_op = 'UPDATE' and old.inactive and new.quantity_stock is distinct from old.quantity_stock then
    raise exception 'Reative a variação antes de movimentar seu estoque.';
  end if;
  return new;
end; $$;
drop trigger if exists supply_variant_origin_guard on public.supply_variants;
create trigger supply_variant_origin_guard before insert or update or delete on public.supply_variants
  for each row execute function app.guard_inventory_supply_variant();

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
left join lateral (select count(*) as total_units,
  count(*) filter (where u.status = 'Em estoque' and coalesce(v.inactive,false) = false) as available_units
  from public.supply_units u left join public.supply_variants v on v.id = u.variant_id
  where u.supply_id = s.id) u on true
left join lateral (select sum(quantity_stock) as variant_quantity from public.supply_variants
  where supply_id = s.id and inactive = false) v on true
where s.deleted_at is null;

create or replace function public.supply_delete_item(p_supply_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare item public.supplies%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem excluir cadastros.'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'Informe o motivo da exclusão.'; end if;
  select * into item from public.supplies where id = p_supply_id for update;
  if not found or item.deleted_at is not null then raise exception 'Suprimento não encontrado.'; end if;
  if item.inventory_group_key is not null then raise exception 'Equipamento do Inventário não pode ser excluído em Suprimentos.'; end if;
  if item.quantity_stock <> 0
    or exists(select 1 from public.supply_variants where supply_id = item.id)
    or exists(select 1 from public.supply_units where supply_id = item.id)
    or exists(select 1 from public.supply_movements where supply_id = item.id) then
    raise exception 'Há estoque ou histórico operacional. Use Inativar suprimento para preservar a rastreabilidade.';
  end if;
  update public.supplies set deleted_at = now(), updated_at = now() where id = item.id;
  insert into public.supply_logs(supply_id, action, old_value, new_value, details, actor_id)
  values(item.id, 'Cadastro excluído', 'Visível', 'Excluído', btrim(p_reason), auth.uid());
end; $$;
revoke all on function public.supply_delete_item(uuid,text) from public;
grant execute on function public.supply_delete_item(uuid,text) to authenticated;

create or replace function public.supply_set_active(p_supply_id uuid, p_active boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare item public.supplies%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem inativar ou reativar suprimentos.'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null then raise exception 'Informe o motivo.'; end if;
  select * into item from public.supplies where id = p_supply_id for update;
  if not found or item.deleted_at is not null then raise exception 'Suprimento não encontrado.'; end if;
  if item.inventory_group_key is not null then raise exception 'Altere o status do equipamento no Inventário.'; end if;
  if item.inactive = not p_active then return; end if;
  if not p_active and exists(select 1 from public.supply_units
    where supply_id = p_supply_id and status in ('Instalado','Manutenção')) then
    raise exception 'Resolva as unidades instaladas ou em manutenção antes de inativar o item.';
  end if;
  update public.supplies set inactive = not p_active, updated_at = now() where id = p_supply_id;
  insert into public.supply_logs(supply_id, action, old_value, new_value, details, actor_id)
  values(p_supply_id, 'Situação administrativa', case when item.inactive then 'Inativo' else 'Ativo' end,
    case when p_active then 'Ativo' else 'Inativo' end,
    format('Produto: %s. Motivo: %s', item.name, btrim(p_reason)), auth.uid());
end; $$;

create or replace function app.supply_available(p_supply_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case when s.tracking_type = 'unit'
    then (select count(*)::integer from public.supply_units u
      left join public.supply_variants v on v.id = u.variant_id
      where u.supply_id = s.id and u.status = 'Em estoque' and coalesce(v.inactive,false) = false)
    else s.quantity_stock + coalesce((select sum(v.quantity_stock)::integer from public.supply_variants v
      where v.supply_id = s.id and v.inactive = false), 0)
  end from public.supplies s where s.id = p_supply_id;
$$;

create or replace function public.supply_set_variant_active(p_variant_id uuid, p_active boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare variant public.supply_variants%rowtype; parent public.supplies%rowtype; parent_id uuid;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem alterar variações.'; end if;
  if nullif(btrim(coalesce(p_reason,'')), '') is null or length(btrim(p_reason)) > 500 then
    raise exception 'Informe um motivo de até 500 caracteres.';
  end if;
  select supply_id into parent_id from public.supply_variants where id = p_variant_id;
  if parent_id is null then raise exception 'Variação não encontrada.'; end if;
  select * into parent from public.supplies where id = parent_id for update;
  select * into variant from public.supply_variants where id = p_variant_id for update;
  if not found then raise exception 'Variação não encontrada.'; end if;
  if parent.inventory_group_key is not null then raise exception 'Variações do Inventário são somente leitura.'; end if;
  if variant.inactive = not p_active then return; end if;
  update public.supply_variants set inactive = not p_active, updated_at = now() where id = p_variant_id;
  insert into public.supply_logs(supply_id, variant_id, action, old_value, new_value, details, actor_id)
  values (variant.supply_id, variant.id, 'Situação da variação',
    case when variant.inactive then 'Inativa' else 'Ativa' end,
    case when p_active then 'Ativa' else 'Inativa' end,
    format('Variação: %s. Motivo: %s', variant.name, btrim(p_reason)), auth.uid());
end; $$;
revoke all on function public.supply_set_variant_active(uuid,boolean,text) from public;
grant execute on function public.supply_set_variant_active(uuid,boolean,text) to authenticated;

-- Para itens locais, uma variação inativa não recebe novas baixas/entradas.
-- A checagem também ocorre no banco, inclusive em chamadas RPC diretas.
create or replace function app.guard_inactive_variant_movement() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.variant_id is not null and exists (
    select 1 from public.supply_variants where id = new.variant_id and inactive
  ) then raise exception 'Reative a variação antes de movimentar seu estoque.'; end if;
  return new;
end; $$;
drop trigger if exists supply_movement_active_variant on public.supply_movements;
create trigger supply_movement_active_variant before insert on public.supply_movements
  for each row execute function app.guard_inactive_variant_movement();

-- A conclusão/descartado do Controle TI passa a produzir o mesmo status
-- patrimonial Inativo, preservando a ligação explícita com a unidade física.
create or replace function app.sync_inventory_status_from_control() returns trigger
language plpgsql security invoker set search_path = public as $$
declare inventory_status text; matched_item record; affected_tables uuid[] := array[]::uuid[];
begin
  inventory_status := case new.status
    when 'Manutenção concluída' then 'Reserva'
    when 'Em manutenção' then 'Manutenção'
    when 'Aguardando avaliação' then 'Defeito'
    when 'Em uso' then 'Atenção'
    when 'Em sala' then 'Manutenção'
    when 'Descartado' then 'Inativo'
    else null end;
  if inventory_status is null then return new; end if;
  if new.inventory_item_id is null and nullif(btrim(new.tag),'') is null
    and nullif(btrim(new.serial),'') is null then return new; end if;
  for matched_item in
    select item.id, item.table_id, item.equipment, item.brand, item.serial,
      item.tag, item.status as previous_status
    from public.inventory_items item
    where item.status is distinct from inventory_status and (
      (new.inventory_item_id is not null and item.id = new.inventory_item_id)
      or (new.inventory_item_id is null and (
        (nullif(btrim(new.tag),'') is not null and lower(btrim(coalesce(item.tag,''))) = lower(btrim(new.tag)))
        or (nullif(btrim(new.serial),'') is not null and lower(btrim(coalesce(item.serial,''))) = lower(btrim(new.serial)))
      )))
  loop
    update public.inventory_items set status = inventory_status where id = matched_item.id;
    insert into public.inventory_item_logs (inventory_item_id, action, message)
    values (matched_item.id, 'update', format('Status atualizado automaticamente pelo Controle TI: %s -> %s.',
      matched_item.previous_status, inventory_status));
    insert into public.sync_events (module, operation, details)
    values ('inventory', 'update', jsonb_build_object(
      'itemId', matched_item.id, 'tableId', matched_item.table_id,
      'tableName', (select name from public.module_tables where id = matched_item.table_id),
      'equipment', matched_item.equipment, 'brand', matched_item.brand,
      'serial', matched_item.serial, 'tag', matched_item.tag, 'status', inventory_status,
      'description', format('Status sincronizado pelo Controle TI: %s -> %s.',
        matched_item.previous_status, inventory_status),
      'targetUrl', format('inventory.html?table=%s&item=%s', matched_item.table_id, matched_item.id)));
    affected_tables := array_append(affected_tables, matched_item.table_id);
  end loop;
  if coalesce(array_length(affected_tables, 1), 0) > 0 then
    update public.module_tables set position = position + 1 where module = 'inventory';
    update public.module_tables set position = 0 where id = any(affected_tables);
  end if;
  return new;
end; $$;

-- Reutiliza a troca atômica da migração 060; apenas substitui o antigo status.
create or replace function public.inventory_replace_equipment(
  p_removed_item_id uuid, p_installed_item_id uuid, p_removed_status text,
  p_removed_location text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare outgoing public.inventory_items%rowtype; incoming public.inventory_items%rowtype;
  result_id uuid; outgoing_label text; incoming_label text;
begin
  if p_removed_item_id is null or p_installed_item_id is null or p_removed_item_id = p_installed_item_id then
    raise exception 'Selecione dois equipamentos físicos diferentes.';
  end if;
  if p_removed_status is null or p_removed_status not in ('Manutenção','Defeito','Inativo')
    or nullif(btrim(coalesce(p_removed_location,'')), '') is null
    or nullif(btrim(coalesce(p_reason,'')), '') is null or char_length(btrim(p_reason)) > 500 then
    raise exception 'Informe o destino, o status e o motivo da substituição.';
  end if;
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
  update public.inventory_items set status = p_removed_status, location = btrim(p_removed_location) where id = outgoing.id;
  update public.inventory_items set status = 'Ativo', location = outgoing.location where id = incoming.id;
  insert into public.inventory_replacements
    (removed_item_id, installed_item_id, removed_identity, installed_identity, removed_tag, installed_tag,
     previous_location, removed_location, removed_status, reason, actor_id)
  values (outgoing.id, incoming.id, outgoing.id, incoming.id, outgoing_label, incoming_label,
    outgoing.location, btrim(p_removed_location), p_removed_status, btrim(p_reason), auth.uid())
  returning id into result_id;
  insert into public.inventory_item_logs (inventory_item_id, action, message) values
    (outgoing.id, 'update', left(format('%s saiu de %s; status: %s; destino: %s; substituída por %s. Motivo: %s',
      outgoing_label, outgoing.location, p_removed_status, btrim(p_removed_location), incoming_label, btrim(p_reason)), 500)),
    (incoming.id, 'update', left(format('%s instalada em %s em substituição a %s. Motivo: %s',
      incoming_label, outgoing.location, outgoing_label, btrim(p_reason)), 500));
  return result_id;
end; $$;

-- O ID da movimentação do Flux é a chave de idempotência do evento. O registro
-- técnico não duplica o equipamento; Inventário continua sendo a fonte de status.
create table if not exists public.equipment_sync_events (
  id uuid primary key default gen_random_uuid(),
  source_module text not null,
  source_id uuid not null,
  event_type text not null,
  equipment_id uuid not null references public.inventory_items(id) on delete restrict,
  tag text not null,
  old_status text not null,
  new_status text not null,
  effect_applied boolean not null default false,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (source_module, source_id, event_type)
);
create index if not exists equipment_sync_events_equipment_idx
  on public.equipment_sync_events (equipment_id, created_at desc);
alter table public.equipment_sync_events enable row level security;
revoke all on public.equipment_sync_events from anon, authenticated;
grant select on public.equipment_sync_events to authenticated;
drop policy if exists "Contas ativas consultam eventos de equipamentos" on public.equipment_sync_events;
create policy "Contas ativas consultam eventos de equipamentos" on public.equipment_sync_events
  for select to authenticated using (app.has_active_account());

create or replace function app.sync_flux_maintenance_to_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
declare item public.inventory_items%rowtype; matching_count integer;
  previous_event public.equipment_sync_events%rowtype; event_id uuid; control_changed boolean := false;
begin
  select * into previous_event from public.equipment_sync_events
    where source_module = 'flux' and source_id = new.id and event_type = 'maintenance';
  if previous_event.id is not null then
    if lower(btrim(new.tag)) <> lower(btrim(previous_event.tag)) or new.reason <> 'Manutenção' then
      raise exception 'Movimentação de manutenção já processada para a TAG %. Altere o patrimônio no Inventário.', previous_event.tag;
    end if;
    return new;
  end if;
  if new.reason <> 'Manutenção' or new.movement <> 'Envio' then return new; end if;
  if nullif(btrim(new.tag),'') is null or btrim(new.tag) in ('-','***') then
    raise exception 'Informe uma TAG real do equipamento para manutenção.';
  end if;
  select count(*) into matching_count from public.inventory_items
    where lower(btrim(tag)) = lower(btrim(new.tag));
  if matching_count = 0 then
    raise exception 'Equipamento TAG % não localizado no Inventário. Evento não processado.', new.tag;
  elsif matching_count > 1 then
    raise exception 'TAG % corresponde a mais de um equipamento no Inventário. Corrija a duplicidade antes de salvar.', new.tag;
  end if;
  select * into item from public.inventory_items
    where lower(btrim(tag)) = lower(btrim(new.tag)) for update;
  if item.status = 'Inativo' then
    raise exception 'Equipamento TAG % está Inativo no Inventário. Reative-o na fonte antes de abrir manutenção.', item.tag;
  end if;
  insert into public.equipment_sync_events
    (source_module, source_id, event_type, equipment_id, tag, old_status, new_status, effect_applied, actor_id)
  values ('flux', new.id, 'maintenance', item.id, item.tag, item.status, 'Manutenção',
    item.status is distinct from 'Manutenção', auth.uid())
  on conflict (source_module, source_id, event_type) do nothing returning id into event_id;
  if event_id is null then return new; end if;
  if item.status is distinct from 'Manutenção' then
    update public.inventory_items set status = 'Manutenção' where id = item.id;
    insert into public.inventory_item_logs
      (inventory_item_id, action, message, source_module, source_log_id)
    values (item.id, 'update', left(format(
      'Flux: %s -> Manutenção. TAG: %s. Destino: %s. Movimentação: %s.',
      item.status, item.tag, new.destination_company, new.id), 500), 'flux', new.id)
    on conflict (inventory_item_id, source_module, source_log_id)
      where source_module is not null and source_log_id is not null do nothing;
  end if;
  -- O gatilho Inventário -> Controle TI ignora profundidade > 1. O evento do
  -- Flux chama a rotina existente diretamente para manter o mesmo UUID físico.
  control_changed := app.sync_inventory_maintenance_to_control(item.id);
  if control_changed then
    update public.equipment_sync_events set effect_applied = true where id = event_id;
  end if;
  if item.status = 'Manutenção' and not control_changed then return new; end if;
  insert into public.sync_events (module, operation, details)
  values ('inventory', 'update', jsonb_build_object(
    'eventId', event_id, 'sourceModule', 'flux', 'sourceId', new.id,
    'itemId', item.id, 'tableId', item.table_id, 'tag', item.tag,
    'oldStatus', item.status, 'status', 'Manutenção', 'controlChanged', control_changed,
    'description', format('Flux: %s enviado para manutenção.', item.tag),
    'targetUrl', format('inventory.html?table=%s&item=%s', item.table_id, item.id)));
  return new;
end; $$;
drop trigger if exists flux_maintenance_inventory_sync on public.flux_items;
create trigger flux_maintenance_inventory_sync after insert or update of tag, reason, movement, status on public.flux_items
  for each row execute function app.sync_flux_maintenance_to_inventory();
revoke all on function app.sync_flux_maintenance_to_inventory() from public, anon, authenticated;

commit;
