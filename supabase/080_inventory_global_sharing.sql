-- Global Inventory reads and explicit multi-branch references. No equipment is copied or reclassified.
begin;

create unique index if not exists inventory_items_id_table_uidx
  on public.inventory_items(id, table_id);
create index if not exists inventory_items_global_updated_idx
  on public.inventory_items(updated_at desc, id);
create index if not exists inventory_items_global_status_idx
  on public.inventory_items(status, situation);

create table if not exists public.inventory_branch_memberships (
  item_id uuid not null,
  table_id uuid not null,
  branch_id uuid not null,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (item_id, branch_id),
  foreign key (item_id, table_id) references public.inventory_items(id, table_id)
    on update restrict on delete cascade,
  foreign key (branch_id, table_id) references public.inventory_branches(id, table_id)
    on update restrict on delete restrict
);
create index if not exists inventory_branch_memberships_branch_idx
  on public.inventory_branch_memberships(branch_id, item_id);
alter table public.inventory_branch_memberships enable row level security;
revoke all on public.inventory_branch_memberships from anon, authenticated;
grant select on public.inventory_branch_memberships to authenticated;
drop policy if exists "Contas ativas consultam vínculos do Inventário" on public.inventory_branch_memberships;
create policy "Contas ativas consultam vínculos do Inventário"
  on public.inventory_branch_memberships for select to authenticated
  using (app.has_active_account());

create or replace function public.inventory_branch_share_add(p_item_id uuid, p_branch_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_item public.inventory_items%rowtype; v_branch public.inventory_branches%rowtype;
begin
  if not app.can_manage_module('inventory', 'update') then
    raise exception 'Sem permissão para compartilhar equipamentos';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  select * into v_branch from public.inventory_branches where id = p_branch_id for key share;
  if v_item.id is null or v_branch.id is null or v_item.table_id <> v_branch.table_id then
    raise exception 'Equipamento e ramificação devem existir na mesma categoria';
  end if;
  if v_item.branch_id = p_branch_id or exists (
    select 1 from public.inventory_branch_memberships
    where item_id = p_item_id and branch_id = p_branch_id
  ) then raise exception 'Equipamento já associado a esta ramificação'; end if;
  insert into public.inventory_branch_memberships(item_id, table_id, branch_id)
    values (p_item_id, v_item.table_id, p_branch_id);
  insert into public.inventory_branch_events(table_id, branch_id, item_id, operation, details)
    values (v_item.table_id, p_branch_id, p_item_id, 'share_add',
      jsonb_build_object('equipment', v_item.equipment, 'tag', v_item.tag,
        'branch', v_branch.name, 'primary_branch_id', v_item.branch_id));
  insert into public.inventory_item_logs(inventory_item_id, action, message)
    values (p_item_id, 'update', left('Compartilhamento adicionado: ' || v_branch.name, 500));
end $$;

create or replace function public.inventory_branch_share_remove(p_item_id uuid, p_branch_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_item public.inventory_items%rowtype; v_branch public.inventory_branches%rowtype;
begin
  if not app.can_manage_module('inventory', 'update') then
    raise exception 'Sem permissão para remover compartilhamentos';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  select * into v_branch from public.inventory_branches where id = p_branch_id for key share;
  if v_item.id is null or v_branch.id is null or v_item.table_id <> v_branch.table_id then
    raise exception 'Equipamento e ramificação devem existir na mesma categoria';
  end if;
  if v_item.branch_id = p_branch_id then
    raise exception 'A ramificação principal deve ser alterada pela transferência';
  end if;
  delete from public.inventory_branch_memberships
    where item_id = p_item_id and branch_id = p_branch_id;
  if not found then raise exception 'Compartilhamento não encontrado'; end if;
  insert into public.inventory_branch_events(table_id, branch_id, item_id, operation, details)
    values (v_item.table_id, p_branch_id, p_item_id, 'share_remove',
      jsonb_build_object('equipment', v_item.equipment, 'tag', v_item.tag,
        'branch', v_branch.name, 'primary_branch_id', v_item.branch_id));
  insert into public.inventory_item_logs(inventory_item_id, action, message)
    values (p_item_id, 'update', left('Compartilhamento removido: ' || v_branch.name, 500));
end $$;

-- A transfer to a previously shared branch promotes it without keeping two references.
create or replace function app.inventory_branch_promote_shared()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.branch_id is distinct from old.branch_id and new.branch_id is not null then
    delete from public.inventory_branch_memberships
      where item_id = new.id and branch_id = new.branch_id;
    if found then
      insert into public.inventory_branch_events(table_id, branch_id, item_id, operation, details)
        values (new.table_id, new.branch_id, new.id, 'share_promote',
          jsonb_build_object('previous_primary_branch_id', old.branch_id));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists inventory_branch_promote_shared on public.inventory_items;
create trigger inventory_branch_promote_shared
  after update of branch_id on public.inventory_items for each row
  execute function app.inventory_branch_promote_shared();

create or replace function public.inventory_branch_delete(p_branch_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v_branch public.inventory_branches%rowtype;
begin
  if not app.can_manage_module('inventory', 'delete') then
    raise exception 'Sem permissão para excluir ramificações';
  end if;
  select * into v_branch from public.inventory_branches where id = p_branch_id for update;
  if v_branch.id is null then raise exception 'Ramificação não encontrada'; end if;
  if exists (select 1 from public.inventory_items where branch_id = p_branch_id)
    or exists (select 1 from public.inventory_branch_memberships where branch_id = p_branch_id) then
    raise exception 'Realocar ou desvincular os equipamentos antes de excluir a ramificação';
  end if;
  -- Preserve the virtual classification safeguard introduced by migration 079.
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

-- SECURITY INVOKER keeps the existing RLS of inventory_items and module_tables.
-- Match only the virtual branch rules that migration 079 already displays.
create or replace function app.inventory_matches_virtual_branch(p_key text, p_equipment text)
returns boolean language sql immutable set search_path = public, app as $$
  select app.inventory_branch_key(p_key) = app.inventory_branch_key(
    case
      when p_key in ('Balanças de Checkout', 'Balanças de Setor') then
        case when position('balanca pdv' in app.inventory_branch_key(p_equipment)) > 0 then 'Balanças de Checkout' else 'Balanças de Setor' end
      when p_key in ('Impressoras de Checkout', 'Impressoras de Setor') then
        case when app.inventory_branch_key(p_equipment) = 'impressora termica' then 'Impressoras de Checkout' else 'Impressoras de Setor' end
      when p_key in ('Pin Pads de PDV', 'Maquininhas de Cartão') then
        case when app.inventory_branch_key(p_equipment) = 'pin pad' then 'Pin Pads de PDV' else 'Maquininhas de Cartão' end
    end)
$$;
create or replace function public.inventory_global_overview()
returns jsonb language plpgsql stable security invoker set search_path = public, app as $$
declare v_recent jsonb; v_statuses jsonb; v_situations jsonb; v_total bigint;
begin
  if not app.has_active_account() then raise exception 'Conta sem acesso ao Inventário'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.changed_at desc, r.id), '[]'::jsonb)
    into v_recent from (
      select i.id, i.table_id, t.name as category, i.branch_id, i.equipment, i.tag,
        i.serial, i.brand, i.model, i.sector, i.location, i.status, i.situation,
        i.cleaning_type, i.created_at, i.updated_at,
        greatest(i.updated_at, coalesce((
          select max(l.created_at) from public.inventory_item_logs l
          where l.inventory_item_id = i.id
        ), i.updated_at)) as changed_at
      from public.inventory_items i
      join public.module_tables t on t.id = i.table_id and t.module = 'inventory'
      order by changed_at desc, i.id
      limit 5
    ) r;
  select count(*) into v_total from public.inventory_items i
    join public.module_tables t on t.id = i.table_id and t.module = 'inventory';
  select coalesce(jsonb_agg(jsonb_build_object('value', s.status, 'count', s.count)
    order by s.status), '[]'::jsonb) into v_statuses from (
      select i.status, count(*) as count from public.inventory_items i
      join public.module_tables t on t.id = i.table_id and t.module = 'inventory'
      group by i.status
    ) s;
  select coalesce(jsonb_agg(jsonb_build_object('value', s.situation, 'count', s.count)
    order by s.situation), '[]'::jsonb) into v_situations from (
      select i.situation, count(*) as count from public.inventory_items i
      join public.module_tables t on t.id = i.table_id and t.module = 'inventory'
      group by i.situation
    ) s;
  return jsonb_build_object('recent', v_recent, 'total', v_total,
    'statuses', v_statuses, 'situations', v_situations);
end $$;

create or replace function public.inventory_global_page(
  p_query text default '', p_category uuid default null, p_status text default null,
  p_situation text default null, p_page integer default 1, p_page_size integer default 25,
  p_order text default 'recent')
returns jsonb language plpgsql stable security invoker set search_path = public, app as $$
declare v_query text := left(btrim(coalesce(p_query, '')), 100);
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := greatest(1, least(100, coalesce(p_page_size, 25)));
  v_total bigint; v_items jsonb;
begin
  if not app.has_active_account() then raise exception 'Conta sem acesso ao Inventário'; end if;
  if p_order not in ('recent', 'oldest', 'name', 'tag') then
    raise exception 'Ordenação inválida';
  end if;
  select count(*) into v_total from public.inventory_items i
    join public.module_tables t on t.id = i.table_id and t.module = 'inventory'
    where (p_category is null or i.table_id = p_category)
      and (p_status is null or i.status = p_status)
      and (p_situation is null or i.situation = p_situation)
      and (v_query = '' or i.tag ilike '%' || v_query || '%'
        or i.serial ilike '%' || v_query || '%'
        or i.equipment ilike '%' || v_query || '%'
        or i.brand ilike '%' || v_query || '%'
        or i.model ilike '%' || v_query || '%'
        or i.sector ilike '%' || v_query || '%'
        or i.location ilike '%' || v_query || '%'
        or t.name ilike '%' || v_query || '%'
        or exists (select 1 from public.inventory_branches b
          where b.id = i.branch_id and b.name ilike '%' || v_query || '%')
        or exists (select 1 from public.inventory_branch_memberships m
          join public.inventory_branches b on b.id = m.branch_id
          where m.item_id = i.id and b.name ilike '%' || v_query || '%')
        or exists (select 1 from public.inventory_branches b
          where i.branch_id is null and b.table_id = i.table_id
            and b.name ilike '%' || v_query || '%'
            and app.inventory_matches_virtual_branch(b.classification_key, i.equipment)));
  select coalesce(jsonb_agg(to_jsonb(r) order by
      case when p_order = 'name' then lower(r.equipment) end asc nulls last,
      case when p_order = 'tag' then lower(r.tag) end asc nulls last,
      case when p_order = 'oldest' then r.changed_at end asc nulls last,
      case when p_order = 'recent' then r.changed_at end desc nulls last,
      r.id), '[]'::jsonb)
    into v_items from (
      select p.* from (
        select i.id, i.table_id, t.name as category, i.branch_id, i.equipment,
          i.tag, i.serial, i.brand, i.model, i.sector, i.location, i.status,
          i.situation, i.cleaning_type, i.created_at, i.updated_at,
          greatest(i.updated_at, coalesce((
            select max(l.created_at) from public.inventory_item_logs l
            where l.inventory_item_id = i.id
          ), i.updated_at)) as changed_at
        from public.inventory_items i
        join public.module_tables t on t.id = i.table_id and t.module = 'inventory'
        where (p_category is null or i.table_id = p_category)
          and (p_status is null or i.status = p_status)
          and (p_situation is null or i.situation = p_situation)
          and (v_query = '' or i.tag ilike '%' || v_query || '%'
            or i.serial ilike '%' || v_query || '%'
            or i.equipment ilike '%' || v_query || '%'
            or i.brand ilike '%' || v_query || '%'
            or i.model ilike '%' || v_query || '%'
            or i.sector ilike '%' || v_query || '%'
            or i.location ilike '%' || v_query || '%'
            or t.name ilike '%' || v_query || '%'
            or exists (select 1 from public.inventory_branches b
              where b.id = i.branch_id and b.name ilike '%' || v_query || '%')
            or exists (select 1 from public.inventory_branch_memberships m
              join public.inventory_branches b on b.id = m.branch_id
              where m.item_id = i.id and b.name ilike '%' || v_query || '%')
            or exists (select 1 from public.inventory_branches b
              where i.branch_id is null and b.table_id = i.table_id
                and b.name ilike '%' || v_query || '%'
                and app.inventory_matches_virtual_branch(b.classification_key, i.equipment)))
        order by
          case when p_order = 'name' then lower(i.equipment) end asc nulls last,
          case when p_order = 'tag' then lower(i.tag) end asc nulls last,
          case when p_order = 'oldest' then greatest(i.updated_at, coalesce((
            select max(l.created_at) from public.inventory_item_logs l
            where l.inventory_item_id = i.id
          ), i.updated_at)) end asc nulls last,
          case when p_order = 'recent' then greatest(i.updated_at, coalesce((
            select max(l.created_at) from public.inventory_item_logs l
            where l.inventory_item_id = i.id
          ), i.updated_at)) end desc nulls last,
          i.id
        limit v_size offset (v_page - 1) * v_size
      ) p
    ) r;
  return jsonb_build_object('items', v_items, 'total', v_total,
    'page', v_page, 'pageSize', v_size);
end $$;

revoke all on function public.inventory_branch_share_add(uuid,uuid),
  public.inventory_branch_share_remove(uuid,uuid), public.inventory_global_overview(),
  public.inventory_global_page(text,uuid,text,text,integer,integer,text) from public, anon;
grant execute on function public.inventory_branch_share_add(uuid,uuid),
  public.inventory_branch_share_remove(uuid,uuid), public.inventory_global_overview(),
  public.inventory_global_page(text,uuid,text,text,integer,integer,text) to authenticated;
commit;
