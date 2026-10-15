-- Paginação de ramificações sem duplicar equipamentos compartilhados.
begin;

create or replace function public.inventory_branch_page(
  p_category uuid, p_branch uuid, p_query text default '',
  p_status text default null, p_situation text default null,
  p_page integer default 1, p_page_size integer default 25,
  p_order text default 'recent')
returns jsonb language plpgsql stable security invoker set search_path = public, app as $$
declare
  v_key text;
  v_query text := left(btrim(coalesce(p_query, '')), 100);
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_size integer := greatest(1, least(100, coalesce(p_page_size, 25)));
  v_total bigint;
  v_items jsonb;
begin
  if not app.has_active_account() then raise exception 'Conta sem acesso ao Inventário'; end if;
  if p_order not in ('recent', 'oldest', 'name', 'tag') then raise exception 'Ordenação inválida'; end if;
  select b.classification_key into v_key from public.inventory_branches b
    join public.module_tables t on t.id = b.table_id and t.module = 'inventory'
    where b.id = p_branch and b.table_id = p_category;
  if not found then raise exception 'Ramificação não pertence à categoria'; end if;

  select count(*) into v_total from public.inventory_items i
    where i.table_id = p_category
      and (i.branch_id = p_branch
        or exists (select 1 from public.inventory_branch_memberships m
          where m.item_id = i.id and m.branch_id = p_branch)
        or (i.branch_id is null and app.inventory_matches_virtual_branch(v_key, i.equipment)))
      and (p_status is null or i.status = p_status)
      and (p_situation is null or i.situation = p_situation)
      and (v_query = '' or i.tag ilike '%' || v_query || '%'
        or i.serial ilike '%' || v_query || '%'
        or i.equipment ilike '%' || v_query || '%'
        or i.brand ilike '%' || v_query || '%'
        or i.model ilike '%' || v_query || '%'
        or i.sector ilike '%' || v_query || '%'
        or i.location ilike '%' || v_query || '%');

  select coalesce(jsonb_agg(to_jsonb(p) order by
      case when p_order = 'name' then lower(p.equipment) end asc nulls last,
      case when p_order = 'tag' then lower(p.tag) end asc nulls last,
      case when p_order = 'oldest' then p.changed_at end asc nulls last,
      case when p_order = 'recent' then p.changed_at end desc nulls last,
      p.id), '[]'::jsonb) into v_items
    from (
      select i.id, i.table_id, i.branch_id, i.equipment, i.tag, i.serial,
        i.brand, i.model, i.sector, i.location, i.status, i.situation,
        i.cleaning_type, i.created_at, i.updated_at,
        greatest(i.updated_at, coalesce((select max(l.created_at)
          from public.inventory_item_logs l where l.inventory_item_id = i.id), i.updated_at)) as changed_at
      from public.inventory_items i
      where i.table_id = p_category
        and (i.branch_id = p_branch
          or exists (select 1 from public.inventory_branch_memberships m
            where m.item_id = i.id and m.branch_id = p_branch)
          or (i.branch_id is null and app.inventory_matches_virtual_branch(v_key, i.equipment)))
        and (p_status is null or i.status = p_status)
        and (p_situation is null or i.situation = p_situation)
        and (v_query = '' or i.tag ilike '%' || v_query || '%'
          or i.serial ilike '%' || v_query || '%'
          or i.equipment ilike '%' || v_query || '%'
          or i.brand ilike '%' || v_query || '%'
          or i.model ilike '%' || v_query || '%'
          or i.sector ilike '%' || v_query || '%'
          or i.location ilike '%' || v_query || '%')
      order by
        case when p_order = 'name' then lower(i.equipment) end asc nulls last,
        case when p_order = 'tag' then lower(i.tag) end asc nulls last,
        case when p_order = 'oldest' then greatest(i.updated_at, coalesce((
          select max(l.created_at) from public.inventory_item_logs l
          where l.inventory_item_id = i.id), i.updated_at)) end asc nulls last,
        case when p_order = 'recent' then greatest(i.updated_at, coalesce((
          select max(l.created_at) from public.inventory_item_logs l
          where l.inventory_item_id = i.id), i.updated_at)) end desc nulls last,
        i.id
      limit v_size offset (v_page - 1) * v_size
    ) p;
  return jsonb_build_object('items', v_items, 'total', v_total,
    'page', v_page, 'pageSize', v_size);
end $$;

revoke all on function public.inventory_branch_page(uuid,uuid,text,text,text,integer,integer,text) from public, anon;
grant execute on function public.inventory_branch_page(uuid,uuid,text,text,text,integer,integer,text) to authenticated;
commit;
