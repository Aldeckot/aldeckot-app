-- O crédito em Suprimentos exige entrada física e aprovação do saldo revisado.
begin;

alter function public.flux_set_supply_acquisition_intent(uuid,uuid,uuid,integer) set schema app;
alter function public.flux_preview_supply_acquisition(uuid) set schema app;
alter function public.flux_complete_supply_acquisition(uuid) set schema app;
revoke all on function app.flux_set_supply_acquisition_intent(uuid,uuid,uuid,integer),
  app.flux_preview_supply_acquisition(uuid), app.flux_complete_supply_acquisition(uuid)
  from public, anon, authenticated;

create function app.flux_supply_has_inventory_origin(p_flux_item_id uuid)
returns boolean language sql stable set search_path = pg_catalog, public, pg_temp as $$
  with recursive lineage(id) as (
    select p_flux_item_id
    union
    select parent.id from lineage l join public.flux_items f on f.id = l.id
    cross join lateral (values (f.return_of), (
      case when f.source_module = 'flux' then f.source_record_id end
    )) parent(id)
    where parent.id is not null
  )
  select exists (
    select 1 from lineage l join public.flux_items f on f.id = l.id
    where f.source_module = 'inventory' or f.inventory_item_id is not null
      or exists (select 1 from public.flux_acquisition_intents a where a.flux_item_id = f.id
        and a.status = 'completed' and a.inventory_item_id is not null)
      or exists (select 1 from public.inventory_items i
        where app.flux_peripheral_identity_value(i.serial) = app.flux_peripheral_identity_value(f.serial)
          or app.flux_peripheral_identity_value(i.tag) = app.flux_peripheral_identity_value(f.tag))
  );
$$;

create function app.assert_flux_supply_credit_permission(p_table_id uuid)
returns void language plpgsql stable set search_path = pg_catalog, public, pg_temp as $$
begin
  if auth.uid() is null or not coalesce(app.is_admin(), false)
    or not coalesce(app.can_manage_module_table(p_table_id, 'flux', 'update'), false)
    or not coalesce(app.can_manage_module('supplies', 'update'), false) then
    raise exception 'Sem permissão para confirmar a entrada em Suprimentos.';
  end if;
end;
$$;

create function public.flux_set_supply_acquisition_intent(
  p_flux_item_id uuid, p_supply_id uuid, p_variant_id uuid, p_quantity integer
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  item public.flux_items%rowtype;
begin
  select * into item from public.flux_items where id = p_flux_item_id for update;
  perform app.assert_flux_supply_credit_permission(item.table_id);
  if app.flux_supply_has_inventory_origin(item.id) then
    raise exception 'A identidade já é controlada pelo Inventário. Não é permitido lançar outro crédito.';
  end if;
  return app.flux_set_supply_acquisition_intent(p_flux_item_id, p_supply_id, p_variant_id, p_quantity);
end;
$$;

create function public.flux_preview_supply_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  item public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  stock_review jsonb;
begin
  select * into item from public.flux_items where id = p_flux_item_id;
  perform app.assert_flux_supply_credit_permission(item.table_id);
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id;
  if item.reason is distinct from 'Aquisição' or intent.destination is distinct from 'supplies' then
    raise exception 'Selecione primeiro um item próprio de Suprimentos.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('state', 'completed', 'supplyMovementId', intent.supply_movement_id);
  end if;
  if app.flux_supply_has_inventory_origin(item.id) then
    raise exception 'A identidade já é controlada pelo Inventário. Não é permitido lançar outro crédito.';
  end if;
  if item.movement <> 'Recebimento' or item.status <> 'Recebido'
    or item.received_date is null or item.received_date > (now() at time zone 'America/Sao_Paulo')::date
    or item.return_of is not null then
    return jsonb_build_object('state', 'awaiting-receipt');
  end if;

  stock_review := app.flux_preview_supply_acquisition(item.id);
  return stock_review || jsonb_build_object('token', md5(jsonb_build_array(
    item.id, item.updated_at, item.received_date, intent.supply_id,
    intent.supply_variant_id, intent.supply_quantity, intent.updated_at, stock_review
  )::text));
end;
$$;

create function public.flux_complete_supply_acquisition(p_flux_item_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  item public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  review jsonb;
begin
  select * into item from public.flux_items where id = p_flux_item_id for update;
  perform app.assert_flux_supply_credit_permission(item.table_id);
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id for update;
  if item.reason is distinct from 'Aquisição' or intent.destination is distinct from 'supplies' then
    raise exception 'Selecione primeiro um item próprio de Suprimentos.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'supplyMovementId', intent.supply_movement_id,
      'alreadyApplied', true);
  end if;

  lock table public.inventory_items in share mode;
  perform 1 from public.supplies s where s.id = intent.supply_id for update;
  if intent.supply_variant_id is not null then
    perform 1 from public.supply_variants v where v.id = intent.supply_variant_id for update;
  end if;
  review := public.flux_preview_supply_acquisition(p_flux_item_id);
  if review->>'state' is distinct from 'ready' then
    raise exception 'A entrada no estoque exige recebimento físico no Flux.';
  end if;
  if p_token is null or review->>'token' is distinct from p_token then
    raise exception 'O saldo, o recebimento ou o destino mudou. Abra a prévia novamente.';
  end if;
  return app.flux_complete_supply_acquisition(p_flux_item_id);
end;
$$;

revoke all on function app.flux_supply_has_inventory_origin(uuid),
  app.assert_flux_supply_credit_permission(uuid) from public, anon, authenticated;
revoke all on function public.flux_set_supply_acquisition_intent(uuid,uuid,uuid,integer),
  public.flux_preview_supply_acquisition(uuid), public.flux_complete_supply_acquisition(uuid,text)
  from public, anon;
grant execute on function public.flux_set_supply_acquisition_intent(uuid,uuid,uuid,integer),
  public.flux_preview_supply_acquisition(uuid), public.flux_complete_supply_acquisition(uuid,text)
  to authenticated;

commit;
