-- Organizational branches. Applying this migration does not reclassify existing equipment.
-- Migration 014 removes module_tables.owner_id in the centralized database.
-- If an earlier failed attempt left an owner_id column, keep its data but stop
-- requiring or populating it; branches are shared in the centralized model.
begin;
create or replace function app.inventory_branch_key(p_value text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(translate(lower(btrim(coalesce(p_value, ''))),
    'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'), '[[:space:]]+', ' ', 'g')
$$;

create table if not exists public.inventory_branches (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.module_tables(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  name_key text generated always as (app.inventory_branch_key(name)) stored,
  classification_key text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (table_id, name_key),
  unique (table_id, classification_key),
  unique (id, table_id)
);
do $$
begin
  if exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'inventory_branches' and column_name = 'owner_id') then
    alter table public.inventory_branches alter column owner_id drop default;
    alter table public.inventory_branches alter column owner_id drop not null;
  end if;
end $$;
alter table public.inventory_items add column if not exists branch_id uuid;
alter table public.inventory_items drop constraint if exists inventory_items_branch_category_fk;
alter table public.inventory_items add constraint inventory_items_branch_category_fk
  foreign key (branch_id, table_id) references public.inventory_branches(id, table_id)
  on update restrict on delete set null (branch_id);
create index if not exists inventory_items_branch_id_idx on public.inventory_items(branch_id) where branch_id is not null;

create or replace function app.validate_inventory_branch_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.module_tables t where t.id = new.table_id
    and t.module = 'inventory') then
    raise exception 'A ramificação deve pertencer a uma categoria do Inventário';
  end if;
  return new;
end $$;
drop trigger if exists inventory_branch_owner on public.inventory_branches;
create trigger inventory_branch_owner before insert or update of table_id
  on public.inventory_branches for each row execute function app.validate_inventory_branch_owner();

create table if not exists public.inventory_branch_events (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.module_tables(id) on delete cascade,
  branch_id uuid,
  item_id uuid,
  operation text not null,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid default auth.uid(),
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index if not exists inventory_branch_events_table_created_idx
  on public.inventory_branch_events(table_id, created_at desc);
create unique index if not exists inventory_branch_events_operation_item_uidx
  on public.inventory_branch_events(correlation_id, item_id) where item_id is not null;
alter table public.inventory_branches enable row level security;
alter table public.inventory_branch_events enable row level security;
revoke all on public.inventory_branches, public.inventory_branch_events from anon, authenticated;
grant select on public.inventory_branches, public.inventory_branch_events to authenticated;
drop policy if exists "Contas ativas consultam ramificações" on public.inventory_branches;
create policy "Contas ativas consultam ramificações" on public.inventory_branches
  for select to authenticated using (app.has_active_account());
drop policy if exists "Contas ativas consultam histórico de ramificações" on public.inventory_branch_events;
create policy "Contas ativas consultam histórico de ramificações" on public.inventory_branch_events
  for select to authenticated using (app.has_active_account());

-- Only explicitly named categories receive initial branches. No inventory_items row is updated.
insert into public.inventory_branches(table_id, name, classification_key, position)
select t.id, n.name, n.name, n.position
from public.module_tables t
cross join lateral (
  values ('balancas', 'Balanças de Checkout', 0), ('balancas', 'Balanças de Setor', 1),
    ('impressoras', 'Impressoras de Checkout', 0), ('impressoras', 'Impressoras de Setor', 1),
    ('maquinas de cartao', 'Pin Pads de PDV', 0), ('maquinas de cartao', 'Maquininhas de Cartão', 1)
) as n(category_key, name, position)
where t.module = 'inventory' and app.inventory_branch_key(t.name) = n.category_key
on conflict (table_id, name_key) do nothing;

create or replace function public.inventory_branch_create(p_table_id uuid, p_name text, p_classification_key text default null)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v_branch public.inventory_branches%rowtype;
begin
  if not app.can_manage_module('inventory', 'create') then raise exception 'Sem permissão para criar ramificações'; end if;
  if app.inventory_branch_key(p_name) = '' then raise exception 'Informe o nome da ramificação'; end if;
  if p_classification_key is not null and not exists (
    select 1 from public.module_tables t
    where t.id = p_table_id and (
      (app.inventory_branch_key(t.name) = 'balancas' and p_classification_key in ('Balanças de Checkout', 'Balanças de Setor')) or
      (app.inventory_branch_key(t.name) = 'impressoras' and p_classification_key in ('Impressoras de Checkout', 'Impressoras de Setor')) or
      (app.inventory_branch_key(t.name) = 'maquinas de cartao' and p_classification_key in ('Pin Pads de PDV', 'Maquininhas de Cartão'))
    )
  ) then raise exception 'Chave de classificação inválida para esta categoria'; end if;
  insert into public.inventory_branches(table_id, name, classification_key)
    select t.id, btrim(p_name), p_classification_key from public.module_tables t
    where t.id = p_table_id and t.module = 'inventory'
    returning * into v_branch;
  if v_branch.id is null then raise exception 'Categoria do Inventário não encontrada'; end if;
  insert into public.inventory_branch_events(table_id, branch_id, operation, details)
    values (p_table_id, v_branch.id, 'create', jsonb_build_object('name', v_branch.name));
  return v_branch.id;
end $$;

create or replace function public.inventory_branch_rename(p_branch_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_before public.inventory_branches%rowtype;
begin
  if not app.can_manage_module('inventory', 'update') then raise exception 'Sem permissão para renomear ramificações'; end if;
  if app.inventory_branch_key(p_name) = '' then raise exception 'Informe o nome da ramificação'; end if;
  select * into v_before from public.inventory_branches where id = p_branch_id for update;
  if v_before.id is null then raise exception 'Ramificação não encontrada'; end if;
  update public.inventory_branches set name = btrim(p_name), updated_at = now() where id = p_branch_id;
  insert into public.inventory_branch_events(table_id, branch_id, operation, details)
    values (v_before.table_id, p_branch_id, 'rename', jsonb_build_object('previous', v_before.name, 'next', btrim(p_name)));
end $$;

create or replace function public.inventory_branch_delete(p_branch_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_branch public.inventory_branches%rowtype;
begin
  if not app.can_manage_module('inventory', 'delete') then raise exception 'Sem permissão para excluir ramificações'; end if;
  select * into v_branch from public.inventory_branches where id = p_branch_id for update;
  if v_branch.id is null then raise exception 'Ramificação não encontrada'; end if;
  if exists (select 1 from public.inventory_items where branch_id = p_branch_id) then
    raise exception 'Realocar os equipamentos antes de excluir a ramificação';
  end if;
  if v_branch.classification_key is not null and exists (
    select 1 from public.inventory_items i
    where i.table_id = v_branch.table_id and i.branch_id is null
      and app.inventory_branch_key(v_branch.classification_key) = app.inventory_branch_key(
        case
          when v_branch.classification_key in ('Balanças de Checkout', 'Balanças de Setor') then
            case when position('balanca pdv' in app.inventory_branch_key(i.equipment)) > 0 then 'Balanças de Checkout' else 'Balanças de Setor' end
          when v_branch.classification_key in ('Impressoras de Checkout', 'Impressoras de Setor') then
            case when app.inventory_branch_key(i.equipment) = 'impressora termica' then 'Impressoras de Checkout' else 'Impressoras de Setor' end
          when v_branch.classification_key in ('Pin Pads de PDV', 'Maquininhas de Cartão') then
            case when app.inventory_branch_key(i.equipment) = 'pin pad' then 'Pin Pads de PDV' else 'Maquininhas de Cartão' end
        end)
  ) then raise exception 'Realocar os equipamentos antes de excluir a ramificação'; end if;
  delete from public.inventory_branches where id = p_branch_id;
  insert into public.inventory_branch_events(table_id, branch_id, operation, details)
    values (v_branch.table_id, p_branch_id, 'delete', jsonb_build_object('name', v_branch.name));
end $$;

-- A single database transaction swaps only sector and location, then records both sides.
create or replace function public.inventory_swap_locations(p_first uuid, p_second uuid, p_operation_id uuid,
  p_first_sector text, p_first_location text, p_second_sector text, p_second_location text)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_first public.inventory_items%rowtype; v_second public.inventory_items%rowtype;
begin
  if not app.can_manage_module('inventory', 'update') then raise exception 'Sem permissão para transferir equipamentos'; end if;
  if p_first is null or p_second is null or p_first = p_second or p_operation_id is null then
    raise exception 'Escolha dois equipamentos diferentes e uma operação válida';
  end if;
  perform id from public.inventory_items where id in (p_first, p_second) order by id for update;
  if exists (select 1 from public.inventory_branch_events
    where correlation_id = p_operation_id and operation = 'swap') then
    if (select count(*) from public.inventory_branch_events where correlation_id = p_operation_id
      and operation = 'swap' and item_id in (p_first, p_second)) = 2 then return; end if;
    raise exception 'Identificador de permuta já utilizado em outra operação';
  end if;
  select * into v_first from public.inventory_items where id = p_first;
  select * into v_second from public.inventory_items where id = p_second;
  if v_first.id is null or v_second.id is null or v_first.table_id <> v_second.table_id then
    raise exception 'Os equipamentos devem pertencer à mesma categoria';
  end if;
  if v_first.sector is distinct from p_first_sector or v_first.location is distinct from p_first_location
    or v_second.sector is distinct from p_second_sector or v_second.location is distinct from p_second_location then
    raise exception 'Setor ou Local mudou após a prévia. Reabra a transferência para revisar os dados atuais';
  end if;
  if v_first.sector is not distinct from v_second.sector and v_first.location is not distinct from v_second.location then
    raise exception 'Os equipamentos já possuem o mesmo Setor e Local';
  end if;
  if v_first.location is not distinct from v_second.location then
    -- Não dispara a sincronização de periféricos quando somente o Setor mudou.
    update public.inventory_items set sector = v_second.sector where id = p_first;
    update public.inventory_items set sector = v_first.sector where id = p_second;
  else
    update public.inventory_items set sector = v_second.sector, location = v_second.location where id = p_first;
    update public.inventory_items set sector = v_first.sector, location = v_first.location where id = p_second;
  end if;
  insert into public.inventory_item_logs(inventory_item_id, action, message) values
    (p_first, 'update', left('Permuta ' || p_operation_id || ': Setor/Local com ' || coalesce(v_second.tag, v_second.equipment), 500)),
    (p_second, 'update', left('Permuta ' || p_operation_id || ': Setor/Local com ' || coalesce(v_first.tag, v_first.equipment), 500));
  insert into public.inventory_branch_events(table_id, item_id, operation, correlation_id, details) values
    (v_first.table_id, p_first, 'swap', p_operation_id, jsonb_build_object('other_item_id', p_second, 'previous_sector', v_first.sector, 'previous_location', v_first.location, 'next_sector', v_second.sector, 'next_location', v_second.location)),
    (v_second.table_id, p_second, 'swap', p_operation_id, jsonb_build_object('other_item_id', p_first, 'previous_sector', v_second.sector, 'previous_location', v_second.location, 'next_sector', v_first.sector, 'next_location', v_first.location));
end $$;

revoke all on function public.inventory_branch_create(uuid,text,text), public.inventory_branch_rename(uuid,text),
  public.inventory_branch_delete(uuid), public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text) from public, anon;
grant execute on function public.inventory_branch_create(uuid,text,text), public.inventory_branch_rename(uuid,text),
  public.inventory_branch_delete(uuid), public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text) to authenticated;
commit;
