-- ALDECKOT | Aquisição recebida no Flux -> estoque próprio de Suprimentos.
-- Requer 070. Não cria patrimônio nem altera projeções do Inventário.
begin;

alter table public.flux_acquisition_intents
  add column if not exists supply_id uuid references public.supplies(id) on delete restrict,
  add column if not exists supply_variant_id uuid references public.supply_variants(id) on delete restrict,
  add column if not exists supply_quantity integer,
  add column if not exists supply_movement_id uuid references public.supply_movements(id) on delete restrict;
alter table public.supply_movements
  add column if not exists event_id uuid references public.equipment_events(id) on delete set null;
create unique index if not exists supply_movements_event_unique
  on public.supply_movements(event_id) where event_id is not null;

alter table public.flux_acquisition_intents
  drop constraint if exists flux_acquisition_intents_destination_check,
  drop constraint if exists flux_acquisition_intents_shape_check,
  drop constraint if exists flux_acquisition_intents_result_check;
alter table public.flux_acquisition_intents
  add constraint flux_acquisition_intents_destination_check
    check (destination in ('inventory', 'management', 'supplies', 'none')),
  add constraint flux_acquisition_intents_shape_check check (
    (destination = 'inventory' and inventory_table_id is not null
      and management_area is null and management_kind is null and management_record_id is null
      and supply_id is null and supply_variant_id is null and supply_quantity is null
      and supply_movement_id is null and status <> 'skipped') or
    (destination = 'management' and inventory_table_id is null and inventory_item_id is null
      and management_area in ('Frente de Loja', 'Escritório', 'Estoque')
      and management_kind = 'computer' and supply_id is null and supply_variant_id is null
      and supply_quantity is null and supply_movement_id is null and status <> 'skipped') or
    (destination = 'supplies' and inventory_table_id is null and inventory_item_id is null
      and management_area is null and management_kind is null and management_record_id is null
      and supply_id is not null and supply_quantity between 1 and 1000000 and status <> 'skipped') or
    (destination = 'none' and inventory_table_id is null and inventory_item_id is null
      and management_area is null and management_kind is null and management_record_id is null
      and supply_id is null and supply_variant_id is null and supply_quantity is null
      and supply_movement_id is null and status = 'skipped')
  ),
  add constraint flux_acquisition_intents_result_check check (
    (status = 'completed' and
      ((destination = 'inventory' and inventory_item_id is not null) or
       (destination = 'management' and management_record_id is not null) or
       (destination = 'supplies' and supply_movement_id is not null))) or
    (status <> 'completed' and inventory_item_id is null and management_record_id is null
      and supply_movement_id is null)
  );

-- Clientes de versões anteriores podem mudar uma intenção pendente. O trigger
-- remove somente campos do destino antigo; a operação concluída continua imutável.
create or replace function app.clear_old_flux_supply_destination()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.destination <> 'supplies' then
    new.supply_id := null;
    new.supply_variant_id := null;
    new.supply_quantity := null;
    new.supply_movement_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists flux_clear_old_supply_destination on public.flux_acquisition_intents;
create trigger flux_clear_old_supply_destination before insert or update
  on public.flux_acquisition_intents for each row
  execute function app.clear_old_flux_supply_destination();

create or replace function public.flux_set_supply_acquisition_intent(
  p_flux_item_id uuid, p_supply_id uuid, p_variant_id uuid, p_quantity integer
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  current_intent public.flux_acquisition_intents%rowtype;
  parent public.supplies%rowtype;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('supplies', 'update') or not app.is_admin() then
    raise exception 'Sem permissão para registrar entrada em Suprimentos.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if not found or movement.reason <> 'Aquisição' then
    raise exception 'A movimentação não é uma aquisição válida.';
  end if;
  if movement.source_module = 'inventory' or movement.inventory_item_id is not null or
     (movement.source_module = 'flux' and exists (
       select 1 from public.flux_items source_row where source_row.id = movement.source_record_id
         and (source_row.source_module = 'inventory' or source_row.inventory_item_id is not null))) then
    raise exception 'Equipamentos originados no Inventário não recebem crédito manual em Suprimentos.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception 'Informe uma quantidade inteira positiva para o suprimento.';
  end if;
  select * into parent from public.supplies where id = p_supply_id;
  if not found or parent.inventory_group_key is not null or parent.deleted_at is not null or
     parent.inactive or parent.tracking_type <> 'quantity' then
    raise exception 'Selecione um item próprio, ativo e controlado por quantidade.';
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.supply_variants where id = p_variant_id and supply_id = p_supply_id
      and inventory_variant_key is null and not inactive) then
    raise exception 'A variação escolhida não pertence a este item próprio ou está inativa.';
  end if;
  select * into current_intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if found and current_intent.status = 'completed' then
    if current_intent.destination <> 'supplies' or current_intent.supply_id is distinct from p_supply_id or
       current_intent.supply_variant_id is distinct from p_variant_id or
       current_intent.supply_quantity is distinct from p_quantity then
      raise exception 'A aquisição já foi integrada. Não é possível trocar o destino concluído.';
    end if;
    return jsonb_build_object('status', 'completed', 'supplyMovementId', current_intent.supply_movement_id);
  end if;
  insert into public.flux_acquisition_intents
    (flux_item_id, destination, status, supply_id, supply_variant_id, supply_quantity, actor_id)
  values (p_flux_item_id, 'supplies', 'pending', p_supply_id, p_variant_id, p_quantity, auth.uid())
  on conflict (flux_item_id) do update set
    destination = 'supplies', status = 'pending', inventory_table_id = null,
    inventory_item_id = null, management_area = null, management_kind = null,
    management_record_id = null, supply_id = excluded.supply_id,
    supply_variant_id = excluded.supply_variant_id, supply_quantity = excluded.supply_quantity,
    supply_movement_id = null, actor_id = excluded.actor_id, updated_at = now();
  return jsonb_build_object('status', 'pending');
end;
$$;

create or replace function public.flux_preview_supply_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  parent public.supplies%rowtype;
  variant public.supply_variants%rowtype;
  before_stock integer;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('supplies', 'update') or not app.is_admin() then
    raise exception 'Sem permissão para consultar esta entrada.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id;
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id;
  if movement.id is null or movement.reason <> 'Aquisição' or intent.destination is distinct from 'supplies' then
    raise exception 'Selecione primeiro um item próprio de Suprimentos.';
  end if;
  if movement.source_module = 'inventory' or movement.inventory_item_id is not null or
     (movement.source_module = 'flux' and exists (
       select 1 from public.flux_items source_row where source_row.id = movement.source_record_id
         and (source_row.source_module = 'inventory' or source_row.inventory_item_id is not null))) then
    raise exception 'Esta origem é controlada pelo Inventário; não lance uma segunda entrada.';
  end if;
  select * into parent from public.supplies where id = intent.supply_id;
  if not found or parent.inventory_group_key is not null or parent.deleted_at is not null or
     parent.inactive or parent.tracking_type <> 'quantity' then
    raise exception 'O suprimento próprio não está mais disponível para entrada.';
  end if;
  if intent.supply_variant_id is null then
    before_stock := parent.quantity_stock;
  else
    select * into variant from public.supply_variants
      where id = intent.supply_variant_id and supply_id = parent.id
        and inventory_variant_key is null and not inactive;
    if not found then raise exception 'A variação não está mais disponível.'; end if;
    before_stock := variant.quantity_stock;
  end if;
  if before_stock > 1000000000 - intent.supply_quantity then
    raise exception 'A quantidade excede o limite de estoque permitido.';
  end if;
  return jsonb_build_object('state', 'ready', 'itemName', parent.name,
    'category', parent.category, 'variantName', case when intent.supply_variant_id is null
      then 'Sem variação' else variant.name end,
    'quantity', intent.supply_quantity, 'previousStock', before_stock,
    'predictedStock', before_stock + intent.supply_quantity);
end;
$$;

create or replace function public.flux_complete_supply_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  parent public.supplies%rowtype;
  variant public.supply_variants%rowtype;
  previous_stock integer;
  next_stock integer;
  event_id uuid;
  movement_id uuid;
  variant_name text := 'Sem variação';
  log_details text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('supplies', 'update') or not app.is_admin() then
    raise exception 'Sem permissão para registrar entrada em Suprimentos.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  select * into intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if movement.id is null or movement.reason <> 'Aquisição' or intent.destination is distinct from 'supplies' then
    raise exception 'Selecione primeiro um item próprio de Suprimentos.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'supplyMovementId', intent.supply_movement_id,
      'alreadyApplied', true);
  end if;
  if intent.status <> 'pending' or movement.status <> 'Recebido' then
    raise exception 'A entrada no estoque exige recebimento confirmado no Flux.';
  end if;
  if movement.source_module = 'inventory' or movement.inventory_item_id is not null or
     (movement.source_module = 'flux' and exists (
       select 1 from public.flux_items source_row where source_row.id = movement.source_record_id
         and (source_row.source_module = 'inventory' or source_row.inventory_item_id is not null))) then
    raise exception 'Esta origem é controlada pelo Inventário; não lance uma segunda entrada.';
  end if;
  if intent.supply_quantity is null or intent.supply_quantity < 1 or intent.supply_quantity > 1000000 then
    raise exception 'Informe uma quantidade inteira positiva.';
  end if;
  select * into parent from public.supplies where id = intent.supply_id for update;
  if not found or parent.inventory_group_key is not null or parent.deleted_at is not null or
     parent.inactive or parent.tracking_type <> 'quantity' then
    raise exception 'O suprimento próprio não está mais disponível para entrada.';
  end if;
  if intent.supply_variant_id is null then
    previous_stock := parent.quantity_stock;
  else
    select * into variant from public.supply_variants where id = intent.supply_variant_id
      and supply_id = parent.id and inventory_variant_key is null and not inactive for update;
    if not found then raise exception 'A variação não está mais disponível.'; end if;
    previous_stock := variant.quantity_stock;
    variant_name := variant.name;
  end if;
  if previous_stock > 1000000000 - intent.supply_quantity then
    raise exception 'A quantidade excede o limite de estoque permitido.';
  end if;
  next_stock := previous_stock + intent.supply_quantity;
  if intent.supply_variant_id is null then
    update public.supplies set quantity_stock = next_stock, updated_at = now() where id = parent.id;
  else
    update public.supply_variants set quantity_stock = next_stock, updated_at = now()
      where id = variant.id;
  end if;
  insert into public.equipment_events
    (source_module, source_event_key, source_id, action, reason,
     origin_location, destination_location, affected_modules, processing_result, metadata, actor_id)
  values ('flux', 'supply-acquisition:' || p_flux_item_id::text, p_flux_item_id,
    'Entrada de suprimento', 'Aquisição', movement.sender_company, movement.destination_company,
    '["flux","supplies"]'::jsonb, '{"supplies":"credited"}'::jsonb,
    jsonb_build_object('fluxItemId', p_flux_item_id, 'supplyId', parent.id,
      'supplyName', parent.name, 'category', parent.category,
      'variantId', intent.supply_variant_id, 'variantName', variant_name,
      'quantity', intent.supply_quantity, 'previousStock', previous_stock,
      'newStock', next_stock, 'senderCompany', movement.sender_company,
      'destinationCompany', movement.destination_company,
      'senderResponsible', movement.sender_responsible,
      'receiverResponsible', movement.receiver_responsible,
      'sendDate', movement.send_date, 'receivedDate', movement.received_date,
      'shippingType', movement.shipping_type, 'notes', movement.notes), auth.uid())
  returning id into event_id;
  log_details := format('Aquisição recebida via Flux · %s / %s · %s unidade(s) · saldo %s → %s',
    parent.name, variant_name, intent.supply_quantity, previous_stock, next_stock);
  insert into public.supply_movements
    (supply_id, variant_id, type, quantity, previous_stock, new_stock,
     origin, destination, reason, actor_id, event_id)
  values (parent.id, intent.supply_variant_id, 'Entrada', intent.supply_quantity,
    previous_stock, next_stock, movement.sender_company, movement.destination_company,
    'Aquisição recebida via Flux', auth.uid(), event_id) returning id into movement_id;
  insert into public.supply_logs
    (supply_id, variant_id, action, old_value, new_value, details, actor_id, event_id)
  values (parent.id, intent.supply_variant_id, 'Entrada via Flux', previous_stock::text,
    next_stock::text, log_details, auth.uid(), event_id);
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
  values (p_flux_item_id, 'update', left(log_details, 500), event_id);
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
  values (event_id, 'supplies', 'applied', 1, now()),
         (event_id, 'flux', 'applied', 1, now());
  update public.flux_acquisition_intents set status = 'completed',
    supply_movement_id = movement_id, actor_id = auth.uid(), updated_at = now()
    where flux_item_id = p_flux_item_id;
  return jsonb_build_object('status', 'completed', 'supplyMovementId', movement_id,
    'previousStock', previous_stock, 'newStock', next_stock, 'alreadyApplied', false);
end;
$$;

revoke all on function public.flux_set_supply_acquisition_intent(uuid, uuid, uuid, integer),
  public.flux_preview_supply_acquisition(uuid),
  public.flux_complete_supply_acquisition(uuid) from public, anon;
grant execute on function public.flux_set_supply_acquisition_intent(uuid, uuid, uuid, integer),
  public.flux_preview_supply_acquisition(uuid),
  public.flux_complete_supply_acquisition(uuid) to authenticated;
commit;
