-- ALDECKOT | Aquisição recebida no Flux -> Inventário.
-- Requer 063 (eventos) e 068 (identidade da origem). Sem backfill e sem efeitos
-- em Suprimentos: o catálogo patrimonial já é uma projeção do Inventário.
begin;

create table if not exists public.flux_acquisition_intents (
  flux_item_id uuid primary key references public.flux_items(id) on delete cascade,
  destination text not null check (destination in ('inventory', 'none')),
  inventory_table_id uuid references public.module_tables(id) on delete restrict,
  status text not null check (status in ('pending', 'completed', 'skipped')),
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((destination = 'inventory' and inventory_table_id is not null and status <> 'skipped') or
         (destination = 'none' and inventory_table_id is null and inventory_item_id is null and status = 'skipped')),
  check ((status = 'completed' and inventory_item_id is not null) or
         (status <> 'completed' and inventory_item_id is null))
);

create index if not exists flux_acquisition_intents_pending_idx
  on public.flux_acquisition_intents(status, updated_at) where status = 'pending';

alter table public.flux_acquisition_intents enable row level security;
revoke all on public.flux_acquisition_intents from anon, authenticated;
grant select on public.flux_acquisition_intents to authenticated;
drop policy if exists "Aquisições visíveis a contas ativas" on public.flux_acquisition_intents;
create policy "Aquisições visíveis a contas ativas" on public.flux_acquisition_intents
  for select to authenticated using (app.has_active_account());

create or replace function public.flux_set_acquisition_intent(
  p_flux_item_id uuid, p_destination text, p_inventory_table_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  current_intent public.flux_acquisition_intents%rowtype;
  next_status text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') then
    raise exception 'Sem permissão para definir o destino da aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if not found or movement.reason <> 'Aquisição' then
    raise exception 'A movimentação não é uma aquisição válida.';
  end if;
  if p_destination is null or p_destination not in ('inventory', 'none') then
    raise exception 'Destino de aquisição indisponível nesta etapa.';
  end if;
  if p_destination = 'inventory' then
    if not app.can_manage_module('inventory', 'create') then
      raise exception 'Sem permissão para cadastrar no Inventário.';
    end if;
    if not exists (select 1 from public.module_tables where id = p_inventory_table_id and module = 'inventory') then
      raise exception 'Selecione uma tabela real do Inventário.';
    end if;
    next_status := 'pending';
  else
    if p_inventory_table_id is not null then raise exception 'Não informe categoria ao dispensar o cadastro.'; end if;
    next_status := 'skipped';
  end if;

  select * into current_intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if found and current_intent.status = 'completed' then
    if p_destination <> current_intent.destination or p_inventory_table_id is distinct from current_intent.inventory_table_id then
      raise exception 'A aquisição já foi integrada. Não é possível trocar o destino concluído.';
    end if;
    return jsonb_build_object('status', 'completed', 'inventoryItemId', current_intent.inventory_item_id);
  end if;

  insert into public.flux_acquisition_intents
    (flux_item_id, destination, inventory_table_id, status, actor_id)
  values (p_flux_item_id, p_destination, p_inventory_table_id, next_status, auth.uid())
  on conflict (flux_item_id) do update set
    destination = excluded.destination,
    inventory_table_id = excluded.inventory_table_id,
    status = excluded.status,
    inventory_item_id = null,
    actor_id = excluded.actor_id,
    updated_at = now();
  return jsonb_build_object('status', next_status);
end;
$$;

create or replace function public.flux_preview_inventory_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  candidate public.inventory_items%rowtype;
  candidate_count integer := 0;
  target_id uuid;
  table_name text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('inventory', 'create') then
    raise exception 'Sem permissão para consultar esta aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id;
  if not found or movement.reason <> 'Aquisição' then
    raise exception 'A movimentação não é uma aquisição válida.';
  end if;
  if lower(btrim(movement.tag)) in ('', '-', '***') or
     lower(btrim(movement.serial)) in ('', '-', '***') then
    return jsonb_build_object('state', 'invalid-identity');
  end if;
  for candidate in select * from public.inventory_items
    where lower(btrim(tag)) = lower(btrim(movement.tag)) or
          lower(btrim(serial)) = lower(btrim(movement.serial))
  loop
    candidate_count := candidate_count + 1;
    if candidate_count > 1 or lower(btrim(candidate.tag)) <> lower(btrim(movement.tag)) or
       lower(btrim(candidate.serial)) <> lower(btrim(movement.serial)) then
      return jsonb_build_object('state', 'conflict');
    end if;
    target_id := candidate.id;
    select name into table_name from public.module_tables where id = candidate.table_id;
  end loop;
  if target_id is null then return jsonb_build_object('state', 'new'); end if;
  return jsonb_build_object('state', 'existing', 'inventoryItemId', target_id,
                            'tableName', table_name);
end;
$$;

create or replace function public.flux_complete_inventory_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  candidate public.inventory_items%rowtype;
  target_id uuid;
  event_id uuid;
  category_name text;
  matched_count integer := 0;
  linked_existing boolean := false;
  norm_tag text;
  norm_serial text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('inventory', 'create') then
    raise exception 'Sem permissão para concluir esta aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if not found or movement.reason <> 'Aquisição' then
    raise exception 'A movimentação não é uma aquisição válida.';
  end if;
  select * into intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if not found or intent.destination <> 'inventory' then
    raise exception 'Defina primeiro a tabela de destino do Inventário.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'inventoryItemId', intent.inventory_item_id, 'alreadyApplied', true);
  end if;
  if intent.status <> 'pending' or movement.status <> 'Recebido' then
    raise exception 'A entrada patrimonial exige recebimento confirmado no Flux.';
  end if;
  select name into category_name from public.module_tables
    where id = intent.inventory_table_id and module = 'inventory';
  if not found then raise exception 'A tabela de destino não existe mais.'; end if;
  norm_tag := lower(btrim(movement.tag));
  norm_serial := lower(btrim(movement.serial));
  if norm_tag in ('', '-', '***') or norm_serial in ('', '-', '***') then
    raise exception 'Informe TAG e número de série válidos antes de cadastrar no Inventário.';
  end if;

  -- A TAG e a série podem ter registros legados conflitantes. Não escolhemos
  -- arbitrariamente um deles; uma unicidade concorrente também aborta a transação.
  for candidate in
    select * from public.inventory_items
    where lower(btrim(tag)) = norm_tag or lower(btrim(serial)) = norm_serial
    for update
  loop
    matched_count := matched_count + 1;
    if matched_count > 1 or lower(btrim(candidate.tag)) <> norm_tag or
       lower(btrim(candidate.serial)) <> norm_serial then
      raise exception 'Há conflito de TAG ou série no Inventário. Revise a identidade antes de integrar.';
    end if;
    target_id := candidate.id;
    linked_existing := true;
  end loop;

  if target_id is null then
    insert into public.inventory_items
      (table_id, equipment, model, brand, serial, tag, sector, location,
       status, situation, cleaning_type, notes, position)
    values
      (intent.inventory_table_id, movement.equipment, movement.model, movement.brand,
       movement.serial, movement.tag, '', '', 'Reserva', 'Normal', 'Não realizada', '', 0)
    returning id into target_id;
  elsif candidate.table_id is distinct from intent.inventory_table_id then
    -- O usuário confirmou vincular um registro existente, sem movê-lo de categoria.
    select name into category_name from public.module_tables where id = candidate.table_id;
    intent.inventory_table_id := candidate.table_id;
  end if;

  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     previous_status, new_status, origin_location, destination_location, reason,
     affected_modules, processing_result, metadata, actor_id)
  values
    ('flux', 'inventory-acquisition:' || p_flux_item_id::text, p_flux_item_id, target_id,
     'Aquisição recebida', null, case when linked_existing then candidate.status else 'Reserva' end,
     movement.sender_company, movement.destination_company, 'Aquisição',
     '["flux","inventory","supplies"]'::jsonb,
     jsonb_build_object('inventory', case when linked_existing then 'linked' else 'created' end,
                        'supplies', 'derived-from-inventory'),
     jsonb_build_object('fluxItemId', p_flux_item_id, 'category', category_name,
       'equipment', movement.equipment, 'model', movement.model, 'brand', movement.brand,
       'tag', movement.tag, 'serial', movement.serial, 'senderCompany', movement.sender_company,
       'destinationCompany', movement.destination_company,
       'senderResponsible', movement.sender_responsible,
       'receiverResponsible', movement.receiver_responsible,
       'sendDate', movement.send_date, 'receivedDate', movement.received_date,
       'shippingType', movement.shipping_type,
       'priority', case when movement.notes like '[[aldeckot:item-priority:%]]%'
         then split_part(split_part(movement.notes, 'item-priority:', 2), ']]', 1) else null end,
       'notes', movement.notes, 'linkedExisting', linked_existing), auth.uid())
  returning id into event_id;

  insert into public.inventory_item_logs(inventory_item_id, action, message, event_id)
  values (target_id, case when linked_existing then 'update' else 'create' end,
    left('Aquisição recebida via Flux · ' || movement.tag || ' · série ' || movement.serial ||
         ' · categoria ' || category_name || ' · movimentação ' || p_flux_item_id::text, 500), event_id);
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
  values (p_flux_item_id, 'update',
    left(case when linked_existing then 'Equipamento existente vinculado ao Inventário' else
      'Equipamento cadastrado em Reserva no Inventário' end ||
      ' · ' || category_name || ' · TAG ' || movement.tag, 500), event_id);
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
  values (event_id, 'inventory', 'applied', 1, now()), (event_id, 'flux', 'applied', 1, now());
  update public.flux_acquisition_intents set status = 'completed',
    inventory_table_id = intent.inventory_table_id, inventory_item_id = target_id,
    actor_id = auth.uid(), updated_at = now()
    where flux_item_id = p_flux_item_id;
  return jsonb_build_object('status', 'completed', 'inventoryItemId', target_id,
                            'linkedExisting', linked_existing, 'alreadyApplied', false);
end;
$$;

create or replace function app.guard_completed_flux_acquisition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.flux_acquisition_intents
               where flux_item_id = old.id and status = 'completed') then
      raise exception 'Aquisição já integrada não pode ser excluída; preserve a trilha histórica.';
    end if;
    return old;
  end if;
  if exists (select 1 from public.flux_acquisition_intents
             where flux_item_id = old.id and status = 'completed') and
     (new.reason is distinct from old.reason or new.status not in ('Recebido', 'Entregue') or
      new.tag is distinct from old.tag or new.serial is distinct from old.serial) then
    raise exception 'Aquisição integrada: motivo, recebimento, TAG e série não podem ser alterados.';
  end if;
  return new;
end;
$$;
drop trigger if exists flux_completed_acquisition_guard on public.flux_items;
create trigger flux_completed_acquisition_guard
  before update of reason, status, tag, serial or delete on public.flux_items
  for each row execute function app.guard_completed_flux_acquisition();

revoke all on function public.flux_set_acquisition_intent(uuid, text, uuid),
  public.flux_preview_inventory_acquisition(uuid),
  public.flux_complete_inventory_acquisition(uuid) from public, anon;
grant execute on function public.flux_set_acquisition_intent(uuid, text, uuid),
  public.flux_preview_inventory_acquisition(uuid),
  public.flux_complete_inventory_acquisition(uuid) to authenticated;

commit;
