-- ALDECKOT | Suprimentos rastreáveis e vínculo com equipamentos/Controle TI.
-- Requer 057_inventory_control_maintenance_sync.sql. Não cria dados de exemplo.
begin;

create table if not exists public.supplies (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category text not null default 'Outros',
  brand text not null default '',
  model text not null default '',
  description text not null default '',
  image_path text,
  tracking_type text not null check (tracking_type in ('quantity', 'unit')),
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  quantity_stock integer not null default 0 check (quantity_stock >= 0),
  default_location text not null default 'Almoxarifado',
  inactive boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracked_supply_has_no_direct_stock check (tracking_type = 'quantity' or quantity_stock = 0)
);

create table if not exists public.supply_variants (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '',
  image_path text,
  minimum_stock integer not null default 0 check (minimum_stock >= 0),
  quantity_stock integer not null default 0 check (quantity_stock >= 0),
  location text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supply_id, name)
);

create table if not exists public.supply_units (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  variant_id uuid references public.supply_variants(id) on delete restrict,
  code text not null check (char_length(btrim(code)) between 1 and 100),
  serial_number text not null default '',
  status text not null default 'Em estoque' check (status in ('Em estoque', 'Instalado', 'Reserva', 'Manutenção', 'Defeito', 'Inativo')),
  physical_location text not null default 'Almoxarifado',
  installed_inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  installed_management_record_id uuid references public.module_records(id) on delete restrict,
  origin_inventory_item_id uuid references public.inventory_items(id) on delete set null,
  origin_management_record_id uuid references public.module_records(id) on delete set null,
  reserved_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_unit_installation_consistency check (
    (status = 'Instalado' and num_nonnulls(installed_inventory_item_id, installed_management_record_id) = 1)
    or (status <> 'Instalado' and installed_inventory_item_id is null and installed_management_record_id is null)
  )
);
create unique index if not exists supply_units_code_unique on public.supply_units (lower(btrim(code)));
create index if not exists supply_units_inventory_idx on public.supply_units (installed_inventory_item_id) where installed_inventory_item_id is not null;
create index if not exists supply_units_management_idx on public.supply_units (installed_management_record_id) where installed_management_record_id is not null;
create index if not exists supply_units_stock_idx on public.supply_units (supply_id, status);

create table if not exists public.supply_installations (
  id uuid primary key default gen_random_uuid(),
  supply_unit_id uuid not null references public.supply_units(id) on delete restrict,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  management_record_id uuid references public.module_records(id) on delete set null,
  installed_at timestamptz not null default now(),
  removed_at timestamptz,
  installed_by uuid references auth.users(id),
  removed_by uuid references auth.users(id),
  removal_reason text not null default '',
  check (num_nonnulls(inventory_item_id, management_record_id) = 1)
);
create unique index if not exists supply_installations_one_active on public.supply_installations (supply_unit_id) where removed_at is null;

create table if not exists public.supply_movements (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  variant_id uuid references public.supply_variants(id) on delete restrict,
  supply_unit_id uuid references public.supply_units(id) on delete restrict,
  type text not null,
  quantity integer not null default 1 check (quantity > 0),
  origin text not null default '',
  destination text not null default '',
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  management_record_id uuid references public.module_records(id) on delete set null,
  previous_stock integer not null check (previous_stock >= 0),
  new_stock integer not null check (new_stock >= 0),
  reason text not null default '',
  actor_id uuid references auth.users(id),
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists supply_movements_supply_time_idx on public.supply_movements (supply_id, created_at desc);

create table if not exists public.supply_logs (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.supplies(id) on delete restrict,
  supply_unit_id uuid references public.supply_units(id) on delete restrict,
  action text not null,
  old_value text not null default '',
  new_value text not null default '',
  details text not null default '',
  actor_id uuid references auth.users(id),
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists supply_logs_supply_time_idx on public.supply_logs (supply_id, created_at desc);

create or replace function app.stamp_supply_actor() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.actor_id := coalesce(new.actor_id, auth.uid());
  select coalesce(nullif(display_name,''), 'Equipe ALDECKOT') into new.actor_name
  from public.profiles where id = new.actor_id;
  new.actor_name := coalesce(new.actor_name, 'Equipe ALDECKOT');
  return new;
end; $$;
drop trigger if exists supply_movements_actor on public.supply_movements;
create trigger supply_movements_actor before insert on public.supply_movements for each row execute function app.stamp_supply_actor();
drop trigger if exists supply_logs_actor on public.supply_logs;
create trigger supply_logs_actor before insert on public.supply_logs for each row execute function app.stamp_supply_actor();

alter table public.control_items add column if not exists supply_unit_id uuid references public.supply_units(id) on delete restrict;
create index if not exists control_items_supply_unit_idx on public.control_items (supply_unit_id) where supply_unit_id is not null;

create table if not exists public.supply_maintenance_links (
  id uuid primary key default gen_random_uuid(),
  supply_unit_id uuid not null references public.supply_units(id) on delete restrict,
  control_item_id uuid not null unique references public.control_items(id) on delete restrict,
  status text not null default 'Aberta' check (status in ('Aberta', 'Em andamento', 'Aguardando peça', 'Concluída', 'Sem reparo')),
  origin_inventory_item_id uuid references public.inventory_items(id) on delete set null,
  origin_management_record_id uuid references public.module_records(id) on delete set null,
  defect text not null default '',
  notes text not null default '',
  destination text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  check ((status in ('Concluída', 'Sem reparo')) = (closed_at is not null))
);
create unique index if not exists supply_maintenance_one_active on public.supply_maintenance_links (supply_unit_id) where closed_at is null;

-- Um suprimento rastreável nunca pode ter estoque por quantidade, nem em variações.
create or replace function app.validate_supply_variant() returns trigger language plpgsql set search_path = public as $$
declare parent_tracking text;
begin
  select tracking_type into parent_tracking from public.supplies where id = new.supply_id;
  if parent_tracking = 'unit' and new.quantity_stock <> 0 then
    raise exception 'Suprimentos rastreáveis não possuem estoque por quantidade.';
  end if;
  return new;
end; $$;
drop trigger if exists supply_variant_validate on public.supply_variants;
create trigger supply_variant_validate before insert or update on public.supply_variants for each row execute function app.validate_supply_variant();

create or replace function app.validate_supply_unit() returns trigger language plpgsql set search_path = public as $$
declare parent_tracking text; variant_parent uuid; target_module text;
begin
  select tracking_type into parent_tracking from public.supplies where id = new.supply_id;
  if parent_tracking <> 'unit' then raise exception 'Apenas suprimentos rastreáveis aceitam unidades.'; end if;
  if new.variant_id is not null then
    select supply_id into variant_parent from public.supply_variants where id = new.variant_id;
    if variant_parent is distinct from new.supply_id then raise exception 'A variação pertence a outro suprimento.'; end if;
  end if;
  if new.installed_management_record_id is not null then
    select t.module into target_module from public.module_records r join public.module_tables t on t.id = r.table_id where r.id = new.installed_management_record_id;
    if target_module <> 'management' then raise exception 'O destino não é um equipamento da Gestão TI.'; end if;
  end if;
  if new.status = 'Instalado' and new.physical_location = '' then raise exception 'Informe o local físico da unidade instalada.'; end if;
  return new;
end; $$;
drop trigger if exists supply_unit_validate on public.supply_units;
create trigger supply_unit_validate before insert or update on public.supply_units for each row execute function app.validate_supply_unit();

create or replace view public.supply_stock_summary with (security_invoker = true) as
select s.id, s.name, s.category, s.brand, s.model, s.description, s.image_path, s.tracking_type,
       s.minimum_stock, s.default_location, s.inactive, s.notes, s.quantity_stock, s.created_at, s.updated_at,
       coalesce(u.total_units, 0)::integer as total_units,
       case when s.tracking_type = 'unit' then coalesce(u.available_units, 0)::integer
            else (s.quantity_stock + coalesce(v.variant_quantity, 0))::integer end as available_stock,
       case when s.inactive then 'Inativo'
            when (case when s.tracking_type = 'unit' then coalesce(u.available_units, 0) else s.quantity_stock + coalesce(v.variant_quantity, 0) end) = 0 then 'Sem estoque'
            when (case when s.tracking_type = 'unit' then coalesce(u.available_units, 0) else s.quantity_stock + coalesce(v.variant_quantity, 0) end) <= s.minimum_stock then 'Estoque baixo'
            else 'Normal' end as stock_status
from public.supplies s
left join lateral (select count(*) as total_units, count(*) filter (where status = 'Em estoque') as available_units from public.supply_units where supply_id = s.id) u on true
left join lateral (select sum(quantity_stock) as variant_quantity from public.supply_variants where supply_id = s.id) v on true;

-- Dados privados, leitura para contas ativas e escrita de catálogo somente para administradores.
do $$ declare target_table text; begin
  foreach target_table in array array['supplies','supply_variants','supply_units','supply_installations','supply_movements','supply_logs','supply_maintenance_links'] loop
    execute format('alter table public.%I enable row level security', target_table);
    execute format('revoke all on public.%I from anon, authenticated', target_table);
    execute format('grant select on public.%I to authenticated', target_table);
    execute format('drop policy if exists %I on public.%I', 'Contas ativas consultam suprimentos', target_table);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_active_account())', 'Contas ativas consultam suprimentos', target_table);
  end loop;
end $$;
grant select on public.supply_stock_summary to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supply-images', 'supply-images', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/png','image/jpeg','image/webp'];
drop policy if exists "Contas ativas leem imagens de suprimentos" on storage.objects;
drop policy if exists "Administradores gravam imagens de suprimentos" on storage.objects;
drop policy if exists "Administradores atualizam imagens de suprimentos" on storage.objects;
drop policy if exists "Administradores removem imagens de suprimentos" on storage.objects;
create policy "Contas ativas leem imagens de suprimentos" on storage.objects for select to authenticated using (bucket_id = 'supply-images' and app.has_active_account());
create policy "Administradores gravam imagens de suprimentos" on storage.objects for insert to authenticated with check (bucket_id = 'supply-images' and app.is_admin());
create policy "Administradores atualizam imagens de suprimentos" on storage.objects for update to authenticated using (bucket_id = 'supply-images' and app.is_admin()) with check (bucket_id = 'supply-images' and app.is_admin());
create policy "Administradores removem imagens de suprimentos" on storage.objects for delete to authenticated using (bucket_id = 'supply-images' and app.is_admin());

create or replace function app.supply_available(p_supply_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case when s.tracking_type = 'unit'
    then (select count(*)::integer from public.supply_units u where u.supply_id = s.id and u.status = 'Em estoque')
    else s.quantity_stock + coalesce((select sum(v.quantity_stock)::integer from public.supply_variants v where v.supply_id = s.id), 0)
  end from public.supplies s where s.id = p_supply_id;
$$;

create or replace function app.audit_supply_catalog() returns trigger
language plpgsql security definer set search_path = public as $$
declare item_id uuid; action_name text; old_text text; new_text text;
begin
  if tg_table_name = 'supplies' then
    item_id := new.id;
    action_name := case when tg_op = 'INSERT' then 'Item criado' else 'Item editado' end;
    old_text := case when tg_op = 'INSERT' then '' else row_to_json(old)::text end;
    new_text := row_to_json(new)::text;
  else
    item_id := new.supply_id;
    action_name := case when tg_op = 'INSERT' then 'Variação criada' else 'Variação editada' end;
    old_text := case when tg_op = 'INSERT' then '' else row_to_json(old)::text end;
    new_text := row_to_json(new)::text;
  end if;
  if tg_op = 'UPDATE' and old_text = new_text then return new; end if;
  insert into public.supply_logs(supply_id, action, old_value, new_value, actor_id)
  values (item_id, action_name, left(old_text, 2000), left(new_text, 2000), auth.uid());
  return new;
end; $$;
drop trigger if exists supplies_audit on public.supplies;
create trigger supplies_audit after insert or update on public.supplies for each row execute function app.audit_supply_catalog();
drop trigger if exists supply_variants_audit on public.supply_variants;
create trigger supply_variants_audit after insert or update on public.supply_variants for each row execute function app.audit_supply_catalog();

create or replace function public.supply_save_item(
  p_id uuid, p_name text, p_category text, p_brand text, p_model text,
  p_description text, p_tracking_type text, p_minimum_stock integer,
  p_default_location text, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid; previous public.supplies%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem alterar suprimentos.'; end if;
  if p_tracking_type not in ('quantity', 'unit') or p_name is null or btrim(p_name) = '' or p_minimum_stock < 0 then
    raise exception 'Informe nome, tipo de controle e estoque mínimo válidos.';
  end if;
  if p_id is null then
    insert into public.supplies(owner_id, name, category, brand, model, description, tracking_type, minimum_stock, default_location, notes)
    values (auth.uid(), btrim(p_name), coalesce(nullif(btrim(p_category), ''), 'Outros'), coalesce(btrim(p_brand), ''),
      coalesce(btrim(p_model), ''), coalesce(p_description, ''), p_tracking_type, p_minimum_stock,
      coalesce(nullif(btrim(p_default_location), ''), 'Almoxarifado'), coalesce(p_notes, '')) returning id into result_id;
  else
    select * into previous from public.supplies where id = p_id for update;
    if not found then raise exception 'Suprimento não encontrado.'; end if;
    if previous.tracking_type <> p_tracking_type and (
      previous.quantity_stock > 0 or exists(select 1 from public.supply_variants where supply_id = p_id and quantity_stock > 0)
      or exists(select 1 from public.supply_units where supply_id = p_id)
    ) then raise exception 'Esvazie o estoque e resolva as unidades antes de mudar o tipo de controle.'; end if;
    update public.supplies set name = btrim(p_name), category = coalesce(nullif(btrim(p_category), ''), 'Outros'),
      brand = coalesce(btrim(p_brand), ''), model = coalesce(btrim(p_model), ''), description = coalesce(p_description, ''),
      tracking_type = p_tracking_type, minimum_stock = p_minimum_stock,
      default_location = coalesce(nullif(btrim(p_default_location), ''), 'Almoxarifado'), notes = coalesce(p_notes, ''), updated_at = now()
    where id = p_id returning id into result_id;
  end if;
  return result_id;
end; $$;

create or replace function public.supply_save_variant(
  p_id uuid, p_supply_id uuid, p_name text, p_description text, p_minimum_stock integer, p_location text
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem alterar variações.'; end if;
  if p_name is null or btrim(p_name) = '' or p_minimum_stock < 0 then raise exception 'Nome e mínimo inválidos.'; end if;
  perform 1 from public.supplies where id = p_supply_id for update;
  if not found then raise exception 'Suprimento não encontrado.'; end if;
  if p_id is null then
    insert into public.supply_variants(supply_id, name, description, minimum_stock, location)
    values(p_supply_id, btrim(p_name), coalesce(p_description, ''), p_minimum_stock, coalesce(p_location, '')) returning id into result_id;
  else
    update public.supply_variants set name = btrim(p_name), description = coalesce(p_description, ''),
      minimum_stock = p_minimum_stock, location = coalesce(p_location, ''), updated_at = now()
    where id = p_id and supply_id = p_supply_id returning id into result_id;
    if result_id is null then raise exception 'Variação não encontrada.'; end if;
  end if;
  return result_id;
end; $$;

create or replace function public.supply_adjust_quantity(
  p_supply_id uuid, p_variant_id uuid, p_delta integer, p_reason text
) returns integer language plpgsql security definer set search_path = public as $$
declare parent public.supplies%rowtype; previous_stock integer; next_stock integer;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem movimentar estoque.'; end if;
  if p_delta is null or p_delta = 0 or btrim(coalesce(p_reason, '')) = '' then raise exception 'Informe quantidade e motivo.'; end if;
  select * into parent from public.supplies where id = p_supply_id for update;
  if not found or parent.tracking_type <> 'quantity' or parent.inactive then raise exception 'Item por quantidade ativo não encontrado.'; end if;
  if p_variant_id is null then
    previous_stock := parent.quantity_stock;
    next_stock := previous_stock + p_delta;
    if next_stock < 0 then raise exception 'Estoque insuficiente.'; end if;
    update public.supplies set quantity_stock = next_stock, updated_at = now() where id = p_supply_id;
  else
    select quantity_stock into previous_stock from public.supply_variants where id = p_variant_id and supply_id = p_supply_id for update;
    if not found then raise exception 'Variação não encontrada.'; end if;
    next_stock := previous_stock + p_delta;
    if next_stock < 0 then raise exception 'Estoque insuficiente.'; end if;
    update public.supply_variants set quantity_stock = next_stock, updated_at = now() where id = p_variant_id;
  end if;
  insert into public.supply_movements(supply_id, variant_id, type, quantity, previous_stock, new_stock, reason, actor_id)
  values(p_supply_id, p_variant_id, case when p_delta > 0 then 'Entrada' else 'Saída' end,
    abs(p_delta), previous_stock, next_stock, btrim(p_reason), auth.uid());
  insert into public.supply_logs(supply_id, action, old_value, new_value, details, actor_id)
  values(p_supply_id, 'Estoque movimentado', previous_stock::text, next_stock::text, p_reason, auth.uid());
  return next_stock;
end; $$;

create or replace function public.supply_create_unit(
  p_supply_id uuid, p_variant_id uuid, p_code text, p_serial_number text, p_location text
) returns uuid language plpgsql security definer set search_path = public as $$
declare result_id uuid; previous_stock integer; parent public.supplies%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem criar unidades.'; end if;
  select * into parent from public.supplies where id = p_supply_id for update;
  if not found or parent.tracking_type <> 'unit' or parent.inactive then raise exception 'Suprimento rastreável ativo não encontrado.'; end if;
  previous_stock := app.supply_available(p_supply_id);
  insert into public.supply_units(supply_id, variant_id, code, serial_number, physical_location)
  values(p_supply_id, p_variant_id, btrim(p_code), coalesce(btrim(p_serial_number), ''),
    coalesce(nullif(btrim(p_location), ''), parent.default_location)) returning id into result_id;
  insert into public.supply_movements(supply_id, variant_id, supply_unit_id, type, previous_stock, new_stock, reason, actor_id)
  values(p_supply_id, p_variant_id, result_id, 'Entrada', previous_stock, previous_stock + 1, 'Unidade cadastrada', auth.uid());
  insert into public.supply_logs(supply_id, supply_unit_id, action, new_value, actor_id)
  values(p_supply_id, result_id, 'Unidade criada', btrim(p_code), auth.uid());
  return result_id;
end; $$;

create or replace function public.supply_edit_unit(
  p_unit_id uuid, p_code text, p_serial_number text, p_location text
) returns void language plpgsql security definer set search_path = public as $$
declare unit_row public.supply_units%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem editar unidades.'; end if;
  select * into unit_row from public.supply_units where id = p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada.'; end if;
  if unit_row.status = 'Instalado' and coalesce(nullif(btrim(p_location),''),unit_row.physical_location) <> unit_row.physical_location then
    raise exception 'O local de uma unidade instalada vem do equipamento. Use transferência para alterá-lo.';
  end if;
  update public.supply_units set code = btrim(p_code), serial_number = coalesce(btrim(p_serial_number),''),
    physical_location = coalesce(nullif(btrim(p_location),''),unit_row.physical_location), updated_at = now()
  where id = p_unit_id;
  insert into public.supply_logs(supply_id,supply_unit_id,action,old_value,new_value,actor_id)
  values(unit_row.supply_id,p_unit_id,'Unidade editada',unit_row.code,btrim(p_code),auth.uid());
end; $$;

-- Apenas as rotinas transacionais abaixo podem modificar unidades, vínculos e histórico.
grant execute on function public.supply_save_item(uuid,text,text,text,text,text,text,integer,text,text) to authenticated;
grant execute on function public.supply_save_variant(uuid,uuid,text,text,integer,text) to authenticated;
grant execute on function public.supply_adjust_quantity(uuid,uuid,integer,text) to authenticated;
grant execute on function public.supply_create_unit(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.supply_edit_unit(uuid,text,text,text) to authenticated;

create or replace function public.supply_transition_unit(
  p_unit_id uuid, p_status text, p_inventory_item_id uuid,
  p_management_record_id uuid, p_location text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare source public.supply_units%rowtype; item public.supplies%rowtype;
  before_stock integer; after_stock integer; destination_label text; origin_label text;
  target_module text; target_name text; target_location text;
  control_table_id uuid; control_item_owner_id uuid; control_items_require_owner boolean;
  control_id uuid; order_id uuid;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem movimentar unidades.'; end if;
  if p_status not in ('Em estoque','Instalado','Reserva','Manutenção','Defeito','Inativo') then raise exception 'Status operacional inválido.'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Informe o motivo da movimentação.'; end if;
  select * into source from public.supply_units where id = p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada.'; end if;
  select * into item from public.supplies where id = source.supply_id for update;
  if item.inactive and p_status <> 'Inativo' then raise exception 'Reative o suprimento principal antes de movimentar a unidade.'; end if;
  if source.status = 'Inativo' and p_status <> 'Inativo' and p_reason not like 'REATIVAR:%' then
    raise exception 'Reativação exige ação explícita e motivo iniciado por REATIVAR:.';
  end if;
  if source.status = 'Defeito' and p_status = 'Em estoque' and p_reason not like 'REPARO:%' then
    raise exception 'Voltar de Defeito para estoque exige reparo explícito (REPARO:).';
  end if;
  if source.status = 'Manutenção' and coalesce(current_setting('app.supply_completion', true), '') <> '1' then
    raise exception 'Finalize a ordem no Controle TI e escolha o destino da unidade.';
  end if;
  if p_status = 'Instalado' then
    if num_nonnulls(p_inventory_item_id, p_management_record_id) <> 1 then
      raise exception 'Selecione exatamente um equipamento do Inventário ou Gestão TI.';
    end if;
    if p_inventory_item_id is not null then
      select equipment, coalesce(nullif(location,''), nullif(sector,''), item.default_location)
      into target_name, target_location from public.inventory_items where id = p_inventory_item_id;
      if not found then raise exception 'Equipamento não encontrado no Inventário.'; end if;
    else
      select t.module, coalesce(r.payload->>'equipment', r.payload->>'name', 'Computador'),
        coalesce(nullif(r.payload->>'location',''), nullif(r.payload->>'area',''), item.default_location)
      into target_module, target_name, target_location
      from public.module_records r join public.module_tables t on t.id = r.table_id where r.id = p_management_record_id;
      if not found or target_module <> 'management' then raise exception 'Computador não encontrado na Gestão TI.'; end if;
    end if;
  elsif p_inventory_item_id is not null or p_management_record_id is not null then
    raise exception 'Apenas unidades instaladas podem ter vínculo ativo com equipamento.';
  end if;
  if p_status = 'Manutenção' and exists (
    select 1 from public.supply_maintenance_links where supply_unit_id = p_unit_id and closed_at is null
  ) then raise exception 'Esta unidade já possui uma manutenção em andamento.'; end if;
  if source.status = p_status and source.installed_inventory_item_id is not distinct from p_inventory_item_id
    and source.installed_management_record_id is not distinct from p_management_record_id
    and coalesce(p_location, source.physical_location) = source.physical_location then
    raise exception 'A unidade já está neste estado e destino.';
  end if;
  before_stock := app.supply_available(source.supply_id);
  origin_label := coalesce((select equipment from public.inventory_items where id = source.installed_inventory_item_id),
    (select coalesce(payload->>'equipment', payload->>'name') from public.module_records where id = source.installed_management_record_id),
    source.physical_location);
  destination_label := case when p_status = 'Instalado' then target_name else coalesce(nullif(btrim(p_location),''), item.default_location) end;

  if source.status = 'Instalado' then
    update public.supply_installations set removed_at = now(), removed_by = auth.uid(), removal_reason = p_reason
    where supply_unit_id = p_unit_id and removed_at is null;
  end if;
  update public.supply_units set status = p_status,
    installed_inventory_item_id = case when p_status = 'Instalado' then p_inventory_item_id end,
    installed_management_record_id = case when p_status = 'Instalado' then p_management_record_id end,
    origin_inventory_item_id = case when p_status = 'Manutenção' then source.installed_inventory_item_id else origin_inventory_item_id end,
    origin_management_record_id = case when p_status = 'Manutenção' then source.installed_management_record_id else origin_management_record_id end,
    physical_location = case when p_status = 'Instalado' then coalesce(nullif(btrim(p_location),''), target_location)
      else coalesce(nullif(btrim(p_location),''), item.default_location) end,
    reserved_reason = case when p_status = 'Reserva' then p_reason else '' end,
    updated_at = now()
  where id = p_unit_id;

  if p_status = 'Instalado' then
    insert into public.supply_installations(supply_unit_id, inventory_item_id, management_record_id, installed_by)
    values(p_unit_id, p_inventory_item_id, p_management_record_id, auth.uid());
  end if;

  if p_status = 'Manutenção' then
    select id, nullif(to_jsonb(t)->>'owner_id', '')::uuid
      into control_table_id, control_item_owner_id from public.module_tables t
    where module = 'control' and lower(btrim(name)) = lower(app.current_control_maintenance_table_name())
    order by created_at desc limit 1;
    if control_table_id is null then
      insert into public.module_tables(module, name, icon)
      values('control', app.current_control_maintenance_table_name(), '🔧') returning id into control_table_id;
      select nullif(to_jsonb(t)->>'owner_id', '')::uuid into control_item_owner_id
      from public.module_tables t where t.id = control_table_id;
    end if;
    select exists(select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'control_items' and column_name = 'owner_id')
      into control_items_require_owner;
    if control_items_require_owner then
      if control_item_owner_id is null then
        raise exception 'Não foi possível identificar o proprietário da tabela do Controle TI.';
      end if;
      execute $insert_control_with_owner$
        insert into public.control_items(
          table_id, owner_id, supply_unit_id, equipment, model, brand, serial, tag,
          sector, entry_date, status, notes, position
        ) values ($1,$2,$3,$4,$5,$6,$7,'',$8,current_date,'Em manutenção',$9,0)
        returning id
      $insert_control_with_owner$ into control_id using
        control_table_id, control_item_owner_id, p_unit_id, source.code,
        coalesce(nullif(item.model,''), item.name), item.brand, source.serial_number,
        item.category, format('Suprimentos: %s. Retirado de: %s. Motivo: %s', item.name, origin_label, p_reason);
    else
      insert into public.control_items(
        table_id, supply_unit_id, equipment, model, brand, serial, tag,
        sector, entry_date, status, notes, position
      ) values (
        control_table_id, p_unit_id, source.code,
        coalesce(nullif(item.model,''), item.name), item.brand, source.serial_number, '',
        item.category, current_date, 'Em manutenção',
        format('Suprimentos: %s. Retirado de: %s. Motivo: %s', item.name, origin_label, p_reason), 0
      ) returning id into control_id;
    end if;
    insert into public.supply_maintenance_links(
      supply_unit_id, control_item_id, origin_inventory_item_id, origin_management_record_id,
      defect, opened_by
    ) values(p_unit_id, control_id, source.installed_inventory_item_id, source.installed_management_record_id,
      p_reason, auth.uid()) returning id into order_id;
    perform app.add_management_control_log(control_id, 'create',
      left(format('Manutenção aberta para %s. Origem: %s. Motivo: %s', source.code, origin_label, p_reason), 500));
  end if;

  after_stock := app.supply_available(source.supply_id);
  insert into public.supply_movements(
    supply_id, variant_id, supply_unit_id, type, origin, destination,
    inventory_item_id, management_record_id, previous_stock, new_stock, reason, actor_id
  ) values (
    source.supply_id, source.variant_id, p_unit_id,
    case when p_status = 'Instalado' and source.status = 'Instalado' then 'Troca/transferência'
      when p_status = 'Instalado' then 'Instalação'
      when source.status = 'Manutenção' then 'Retorno de manutenção'
      when p_status = 'Manutenção' then 'Manutenção'
      when source.status = 'Instalado' then 'Remoção' else p_status end,
    origin_label, destination_label,
    coalesce(p_inventory_item_id, source.installed_inventory_item_id),
    coalesce(p_management_record_id, source.installed_management_record_id),
    before_stock, after_stock, p_reason, auth.uid()
  );
  insert into public.supply_logs(supply_id, supply_unit_id, action, old_value, new_value, details, actor_id)
  values(source.supply_id, p_unit_id, 'Status alterado', source.status, p_status,
    format('Origem: %s; destino: %s; motivo: %s', origin_label, destination_label, p_reason), auth.uid());

  if source.installed_inventory_item_id is not null then
    insert into public.inventory_item_logs(inventory_item_id, action, message)
    values(source.installed_inventory_item_id, 'update',
      left(format('%s: %s removido/transferido. Novo status: %s. Motivo: %s', item.name, source.code, p_status, p_reason), 500));
  end if;
  if p_inventory_item_id is not null then
    insert into public.inventory_item_logs(inventory_item_id, action, message)
    values(p_inventory_item_id, 'update',
      left(format('Componente instalado: %s (%s). Motivo: %s', source.code, item.name, p_reason), 500));
  end if;
  if source.installed_management_record_id is not null then
    update public.module_records set payload = jsonb_set(payload, '{logs}',
      coalesce(payload->'logs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'at', now(), 'text', format('%s removido/transferido. Novo status: %s. Motivo: %s', source.code, p_status, p_reason)
      ))) where id = source.installed_management_record_id;
  end if;
  if p_management_record_id is not null then
    update public.module_records set payload = jsonb_set(payload, '{logs}',
      coalesce(payload->'logs', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'at', now(), 'text', format('Componente instalado: %s (%s). Motivo: %s', source.code, item.name, p_reason)
      ))) where id = p_management_record_id;
  end if;
  return coalesce(order_id, p_unit_id);
end; $$;

create or replace function public.supply_set_maintenance_status(p_control_item_id uuid, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
declare order_row public.supply_maintenance_links%rowtype; unit_row public.supply_units%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem atualizar manutenções.'; end if;
  if p_status not in ('Aberta','Em andamento','Aguardando peça') then
    raise exception 'Para concluir, escolha o destino da unidade.';
  end if;
  select * into order_row from public.supply_maintenance_links where control_item_id = p_control_item_id for update;
  if not found or order_row.closed_at is not null then raise exception 'Manutenção ativa não encontrada.'; end if;
  select * into unit_row from public.supply_units where id = order_row.supply_unit_id for update;
  if unit_row.status <> 'Manutenção' then raise exception 'A unidade não está em manutenção.'; end if;
  update public.supply_maintenance_links set status = p_status, notes = coalesce(p_notes,'') where id = order_row.id;
  insert into public.supply_logs(supply_id, supply_unit_id, action, old_value, new_value, details, actor_id)
  values(unit_row.supply_id, unit_row.id, 'Ordem atualizada', order_row.status, p_status, coalesce(p_notes,''), auth.uid());
  perform app.add_management_control_log(p_control_item_id, 'update',
    left(format('Manutenção: %s → %s. %s', order_row.status, p_status, coalesce(p_notes,'')), 500));
end; $$;

create or replace function public.supply_complete_maintenance(
  p_control_item_id uuid, p_result text, p_destination text,
  p_inventory_item_id uuid, p_management_record_id uuid, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare order_row public.supply_maintenance_links%rowtype; unit_row public.supply_units%rowtype;
  final_status text; target_inventory uuid; target_management uuid;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem concluir manutenções.'; end if;
  if p_result not in ('Concluída','Sem reparo') then raise exception 'Resultado inválido.'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'Informe o resultado da manutenção.'; end if;
  select * into order_row from public.supply_maintenance_links where control_item_id = p_control_item_id for update;
  if not found or order_row.closed_at is not null then raise exception 'Manutenção ativa não encontrada.'; end if;
  select * into unit_row from public.supply_units where id = order_row.supply_unit_id for update;
  if unit_row.status <> 'Manutenção' then raise exception 'A unidade não está em manutenção.'; end if;
  if p_result = 'Concluída' then
    if p_destination = 'reinstall' then
      target_inventory := order_row.origin_inventory_item_id;
      target_management := order_row.origin_management_record_id;
      if num_nonnulls(target_inventory,target_management) <> 1 then raise exception 'Não há equipamento de origem para reinstalar.'; end if;
      final_status := 'Instalado';
    elsif p_destination = 'other' then
      target_inventory := p_inventory_item_id; target_management := p_management_record_id;
      final_status := 'Instalado';
    elsif p_destination = 'stock' then final_status := 'Em estoque';
    elsif p_destination = 'reserve' then final_status := 'Reserva';
    else raise exception 'Escolha reinstalar, outro equipamento, estoque ou reserva.';
    end if;
  else
    if p_destination = 'defect' then final_status := 'Defeito';
    elsif p_destination = 'inactive' then final_status := 'Inativo';
    else raise exception 'Sem reparo exige destino Defeito ou Inativo.';
    end if;
  end if;
  perform set_config('app.supply_completion', '1', true);
  perform public.supply_transition_unit(order_row.supply_unit_id, final_status, target_inventory, target_management,
    null, format('%s: %s', p_result, p_reason));
  update public.supply_maintenance_links set status = p_result, destination = p_destination,
    notes = concat_ws(E'\n', nullif(notes,''), p_reason), closed_at = now(), closed_by = auth.uid()
  where id = order_row.id;
  perform set_config('app.supply_completion', '', true);
  perform set_config('app.supply_control_update', '1', true);
  update public.control_items set status = 'Manutenção concluída', exit_date = current_date
  where id = p_control_item_id;
  perform set_config('app.supply_control_update', '', true);
  perform app.add_management_control_log(p_control_item_id, 'update',
    left(format('Manutenção %s. Destino: %s. %s', p_result, p_destination, p_reason), 500));
end; $$;

create or replace function app.guard_supply_control_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.supply_unit_id is not null and new.status is distinct from old.status
    and coalesce(current_setting('app.supply_control_update', true),'') <> '1' then
    raise exception 'Use o fluxo de manutenção do suprimento para alterar o status desta ordem.';
  end if;
  return new;
end; $$;
drop trigger if exists supply_control_status_guard on public.control_items;
create trigger supply_control_status_guard before update of status on public.control_items
for each row execute function app.guard_supply_control_status();

create or replace function public.supply_set_active(p_supply_id uuid, p_active boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare item public.supplies%rowtype;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem inativar ou reativar suprimentos.'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'Informe o motivo.'; end if;
  select * into item from public.supplies where id = p_supply_id for update;
  if not found then raise exception 'Suprimento não encontrado.'; end if;
  if not p_active and exists(select 1 from public.supply_units where supply_id = p_supply_id and status in ('Instalado','Manutenção')) then
    raise exception 'Resolva as unidades instaladas ou em manutenção antes de inativar o item.';
  end if;
  update public.supplies set inactive = not p_active, updated_at = now() where id = p_supply_id;
  insert into public.supply_logs(supply_id, action, old_value, new_value, details, actor_id)
  values(p_supply_id, 'Situação administrativa', case when item.inactive then 'Inativo' else 'Ativo' end,
    case when p_active then 'Ativo' else 'Inativo' end, p_reason, auth.uid());
end; $$;

create or replace function public.supply_set_image(p_target text, p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare item_id uuid; previous_path text;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem alterar imagens.'; end if;
  if p_path is not null and (p_path !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$' or length(p_path) > 100) then
    raise exception 'Caminho de imagem inválido.';
  end if;
  if p_target = 'supply' then
    select id, image_path into item_id, previous_path from public.supplies where id = p_id for update;
    if not found then raise exception 'Suprimento não encontrado.'; end if;
    update public.supplies set image_path = p_path, updated_at = now() where id = p_id;
  elsif p_target = 'variant' then
    select supply_id, image_path into item_id, previous_path from public.supply_variants where id = p_id for update;
    if not found then raise exception 'Variação não encontrada.'; end if;
    update public.supply_variants set image_path = p_path, updated_at = now() where id = p_id;
  else raise exception 'Destino de imagem inválido.';
  end if;
  insert into public.supply_logs(supply_id, action, old_value, new_value, actor_id)
  values(item_id, 'Imagem alterada', coalesce(previous_path,''), coalesce(p_path,''), auth.uid());
end; $$;

create or replace function public.supply_replace_unit(
  p_old_unit_id uuid, p_new_unit_id uuid, p_old_destination text, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare old_unit public.supply_units%rowtype; new_unit public.supply_units%rowtype;
  old_category text; new_category text;
begin
  if not app.is_admin() then raise exception 'Apenas administradores podem substituir componentes.'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'Informe o motivo da substituição.'; end if;
  if p_old_unit_id = p_new_unit_id then raise exception 'Selecione outra unidade.'; end if;
  select * into old_unit from public.supply_units where id = p_old_unit_id for update;
  select * into new_unit from public.supply_units where id = p_new_unit_id for update;
  if old_unit.status <> 'Instalado' or new_unit.status <> 'Em estoque' then
    raise exception 'A unidade antiga deve estar instalada e a nova deve estar em estoque.';
  end if;
  select category into old_category from public.supplies where id = old_unit.supply_id;
  select category into new_category from public.supplies where id = new_unit.supply_id;
  if lower(btrim(old_category)) <> lower(btrim(new_category)) then
    raise exception 'A substituição exige componentes da mesma categoria.';
  end if;
  if p_old_destination not in ('Em estoque','Reserva','Manutenção','Defeito','Inativo') then
    raise exception 'Escolha o destino da unidade substituída.';
  end if;
  perform public.supply_transition_unit(p_old_unit_id, p_old_destination, null, null, null, format('Substituição: %s', p_reason));
  perform public.supply_transition_unit(p_new_unit_id, 'Instalado', old_unit.installed_inventory_item_id,
    old_unit.installed_management_record_id, old_unit.physical_location, format('Substituição: %s', p_reason));
end; $$;

grant execute on function public.supply_transition_unit(uuid,text,uuid,uuid,text,text) to authenticated;
grant execute on function public.supply_set_maintenance_status(uuid,text,text) to authenticated;
grant execute on function public.supply_complete_maintenance(uuid,text,text,uuid,uuid,text) to authenticated;
grant execute on function public.supply_set_active(uuid,boolean,text) to authenticated;
grant execute on function public.supply_set_image(text,uuid,text) to authenticated;
grant execute on function public.supply_replace_unit(uuid,uuid,text,text) to authenticated;

revoke all on function app.supply_available(uuid) from public, anon;
revoke all on function app.audit_supply_catalog() from public, anon;
revoke all on function app.stamp_supply_actor() from public, anon;
revoke all on function app.validate_supply_variant() from public, anon;
revoke all on function app.validate_supply_unit() from public, anon;
revoke all on function app.guard_supply_control_status() from public, anon;
revoke all on function public.supply_save_item(uuid,text,text,text,text,text,text,integer,text,text) from public, anon;
revoke all on function public.supply_save_variant(uuid,uuid,text,text,integer,text) from public, anon;
revoke all on function public.supply_adjust_quantity(uuid,uuid,integer,text) from public, anon;
revoke all on function public.supply_create_unit(uuid,uuid,text,text,text) from public, anon;
revoke all on function public.supply_edit_unit(uuid,text,text,text) from public, anon;
revoke all on function public.supply_transition_unit(uuid,text,uuid,uuid,text,text) from public, anon;
revoke all on function public.supply_set_maintenance_status(uuid,text,text) from public, anon;
revoke all on function public.supply_complete_maintenance(uuid,text,text,uuid,uuid,text) from public, anon;
revoke all on function public.supply_set_active(uuid,boolean,text) from public, anon;
revoke all on function public.supply_set_image(text,uuid,text) from public, anon;
revoke all on function public.supply_replace_unit(uuid,uuid,text,text) from public, anon;
grant execute on function public.supply_save_item(uuid,text,text,text,text,text,text,integer,text,text),
  public.supply_save_variant(uuid,uuid,text,text,integer,text),
  public.supply_adjust_quantity(uuid,uuid,integer,text),
  public.supply_create_unit(uuid,uuid,text,text,text),
  public.supply_edit_unit(uuid,text,text,text),
  public.supply_transition_unit(uuid,text,uuid,uuid,text,text),
  public.supply_set_maintenance_status(uuid,text,text),
  public.supply_complete_maintenance(uuid,text,text,uuid,uuid,text),
  public.supply_set_active(uuid,boolean,text),
  public.supply_set_image(text,uuid,text),
  public.supply_replace_unit(uuid,uuid,text,text) to authenticated;

alter table public.notification_acknowledgements drop constraint if exists notification_acknowledgements_module_check;
alter table public.notification_acknowledgements add constraint notification_acknowledgements_module_check
  check (module in ('inventory','management','control','flux','nfe','supplies'));

do $$ declare table_name text; begin
  foreach table_name in array array['supplies','supply_variants','supply_units','supply_movements','supply_logs','supply_maintenance_links'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then execute format('alter publication supabase_realtime add table public.%I', table_name); end if;
  end loop;
end $$;

commit;
