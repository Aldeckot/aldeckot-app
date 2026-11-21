-- Recebimento de periféricos para a Gestão TI com identidade canônica no Inventário.
begin;

-- O formulário do Inventário sempre envia o setor ao salvar a TAG. Execute
-- apenas a consulta do catálogo dentro do trigger, sem liberar o esquema app.
alter function app.sync_inventory_sector_code() security definer;
alter function app.sync_inventory_sector_code() set search_path to pg_catalog, public, pg_temp;

create function app.is_management_peripheral_kind(p_kind text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(p_kind in ('Impressora', 'Leitor', 'Gaveta', 'Pin Pad', 'Balança', 'Monitor', 'Teclado'), false);
$$;

create function app.flux_peripheral_identity_value(p_value text)
returns text language sql immutable set search_path = pg_catalog as $$
  select case when lower(btrim(coalesce(p_value, ''))) not in
    ('', '-', '***', '—', 'n/a', 's/n', 'sem tag', 'sem série', 'sem serie', 'sem número', 'sem numero',
     'não informado', 'não informada') then lower(btrim(p_value)) end;
$$;

alter table public.inventory_items add column peripheral_kind text
  check (peripheral_kind is null or app.is_management_peripheral_kind(peripheral_kind));
alter table public.flux_acquisition_intents
  add column peripheral_kind text,
  add column peripheral_sector text references public.organizational_sectors(name) on update cascade on delete restrict,
  drop constraint flux_acquisition_intents_shape_check,
  drop constraint flux_acquisition_intents_result_check;

alter table public.flux_acquisition_intents
  add constraint flux_acquisition_intents_shape_check check (
    (destination = 'inventory' and inventory_table_id is not null
      and management_area is null and management_kind is null and management_record_id is null
      and supply_id is null and supply_variant_id is null and supply_quantity is null
      and supply_movement_id is null and status <> 'skipped') or
    (destination = 'management' and management_kind is not null and status <> 'skipped'
      and supply_id is null and supply_variant_id is null and supply_quantity is null
      and supply_movement_id is null and (
        (management_kind = 'computer' and inventory_table_id is null and inventory_item_id is null
          and management_area is not null and management_area in ('Frente de Loja', 'Escritório', 'Estoque')) or
        (management_kind = 'peripheral' and inventory_table_id is not null
          and management_area is null and management_record_id is null))) or
    (destination = 'supplies' and inventory_table_id is null and inventory_item_id is null
      and management_area is null and management_kind is null and management_record_id is null
      and supply_id is not null and supply_quantity between 1 and 1000000 and status <> 'skipped') or
    (destination = 'none' and inventory_table_id is null and inventory_item_id is null
      and management_area is null and management_kind is null and management_record_id is null
      and supply_id is null and supply_variant_id is null and supply_quantity is null
      and supply_movement_id is null and status = 'skipped')
  ),
  add constraint flux_acquisition_intents_result_check check (
    (status = 'completed' and (
        (destination = 'inventory' and inventory_item_id is not null) or
        (destination = 'management' and (
          (management_kind = 'computer' and management_record_id is not null) or
          (management_kind = 'peripheral' and inventory_item_id is not null))) or
        (destination = 'supplies' and supply_movement_id is not null))) or
    (status <> 'completed' and inventory_item_id is null and management_record_id is null
      and supply_movement_id is null)
  ),
  add constraint flux_acquisition_intents_peripheral_check check (
    case when destination = 'management' and management_kind = 'peripheral'
      then app.is_management_peripheral_kind(peripheral_kind) and peripheral_sector is not null
      else peripheral_kind is null and peripheral_sector is null end
  );

create function app.clear_old_flux_peripheral_destination()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.destination <> 'management' or new.management_kind is distinct from 'peripheral' then
    new.peripheral_kind := null;
    new.peripheral_sector := null;
  end if;
  return new;
end;
$$;
create trigger flux_clear_old_peripheral_destination before insert or update
  on public.flux_acquisition_intents for each row execute function app.clear_old_flux_peripheral_destination();

create function app.guard_classified_inventory_peripheral()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.peripheral_kind is not null
    and new.peripheral_kind is distinct from old.peripheral_kind then
    raise exception 'O tipo patrimonial do periférico não pode ser substituído por edição direta.';
  end if;
  if new.peripheral_kind is null then return new; end if;
  if app.flux_peripheral_identity_value(new.serial) is null then
    raise exception 'Informe um número de série válido para o periférico.';
  end if;
  if nullif(btrim(new.tag), '') is not null
    and app.inventory_tag_peripheral_type(new.tag) is distinct from new.peripheral_kind then
    raise exception 'A TAG não corresponde ao tipo de periférico %.', new.peripheral_kind;
  end if;
  if new.location ~* '^PDV[[:space:]]*[0-9]+$' and
    app.inventory_tag_peripheral_type(new.tag) is distinct from new.peripheral_kind then
    raise exception 'Atribua uma TAG compatível antes de instalar o periférico em PDV.';
  end if;
  return new;
end;
$$;
create trigger inventory_classified_peripheral_guard
  before insert or update of peripheral_kind, tag, serial, location on public.inventory_items
  for each row execute function app.guard_classified_inventory_peripheral();

create function app.record_classified_inventory_peripheral_tag()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  event_id uuid := gen_random_uuid();
  description text;
begin
  description := format('TAG do periférico %s: %s → %s.',
    new.peripheral_kind, coalesce(nullif(btrim(old.tag), ''), 'sem TAG'),
    coalesce(nullif(btrim(new.tag), ''), 'sem TAG'));
  insert into public.equipment_events(id, source_module, source_event_key, source_id,
    inventory_item_id, action, previous_status, new_status, previous_location, new_location,
    reason, affected_modules, processing_result, metadata, actor_id)
  values(event_id, 'inventory', 'peripheral-tag:' || event_id::text, new.id,
    new.id, 'TAG do periférico atualizada', old.status, new.status, old.location, new.location,
    description, jsonb_build_array('inventory'), '{"status":"applied"}'::jsonb,
    jsonb_build_object('previousTag', old.tag, 'newTag', new.tag, 'serial', new.serial,
      'peripheralKind', new.peripheral_kind), auth.uid());
  insert into public.inventory_item_logs(inventory_item_id, action, message, event_id)
    values(new.id, 'update', description, event_id);
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
    values(event_id, 'inventory', 'applied', 1, now());
  return new;
end;
$$;
create trigger inventory_classified_peripheral_tag_audit after update of tag on public.inventory_items
  for each row when (new.peripheral_kind is not null and old.tag is distinct from new.tag)
  execute function app.record_classified_inventory_peripheral_tag();

create function public.flux_set_peripheral_acquisition_intent(
  p_flux_item_id uuid, p_inventory_table_id uuid, p_kind text, p_sector text
) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
begin
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if movement.reason is distinct from 'Aquisição' then raise exception 'Aquisição não encontrada.'; end if;
  if auth.uid() is null or not coalesce(app.can_manage_module_table(movement.table_id, 'flux', 'update'), false)
    or not coalesce(app.can_manage_module('management', 'create'), false)
    or not coalesce(app.can_manage_module_table(p_inventory_table_id, 'inventory', 'create'), false) then
    raise exception 'Sem permissão para definir este destino patrimonial.';
  end if;
  if not app.is_management_peripheral_kind(p_kind) or not exists (
      select 1 from public.organizational_sectors s where s.name = p_sector and s.active) then
    raise exception 'Selecione o tipo de periférico e o setor do catálogo.';
  end if;
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id for update;
  if intent.status = 'completed' then
    if intent.destination = 'management' and intent.management_kind = 'peripheral'
      and intent.inventory_table_id = p_inventory_table_id
      and intent.peripheral_kind = p_kind and intent.peripheral_sector = p_sector then
      return jsonb_build_object('status', 'completed', 'inventoryItemId', intent.inventory_item_id);
    end if;
    raise exception 'A aquisição já foi integrada e o destino não pode mudar.';
  end if;
  insert into public.flux_acquisition_intents(flux_item_id, destination, inventory_table_id,
    management_kind, peripheral_kind, peripheral_sector, status, actor_id)
  values(p_flux_item_id, 'management', p_inventory_table_id, 'peripheral', p_kind, p_sector, 'pending', auth.uid())
  on conflict (flux_item_id) do update set destination = excluded.destination,
    inventory_table_id = excluded.inventory_table_id, management_kind = excluded.management_kind,
    peripheral_kind = excluded.peripheral_kind, peripheral_sector = excluded.peripheral_sector,
    status = 'pending', management_area = null, management_record_id = null, inventory_item_id = null,
    actor_id = auth.uid(), updated_at = now();
  return jsonb_build_object('status', 'pending');
end;
$$;

create function public.flux_preview_peripheral_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  candidate public.inventory_items%rowtype;
  match_count integer;
  category_name text;
  norm_tag text;
  norm_serial text;
begin
  select * into movement from public.flux_items where id = p_flux_item_id;
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id;
  if auth.uid() is null or not coalesce(app.can_manage_module_table(movement.table_id, 'flux', 'update'), false)
    or not coalesce(app.can_manage_module('management', 'create'), false)
    or not coalesce(app.can_manage_module_table(intent.inventory_table_id, 'inventory', 'create'), false) then
    raise exception 'Sem permissão para conferir este recebimento.';
  end if;
  if movement.reason is distinct from 'Aquisição' or intent.destination is distinct from 'management'
    or intent.management_kind is distinct from 'peripheral' or intent.status is distinct from 'pending' then
    raise exception 'Defina primeiro o destino de periférico.';
  end if;
  if movement.movement <> 'Recebimento' or movement.status <> 'Recebido' or movement.received_date is null then
    return jsonb_build_object('state', 'awaiting-receipt');
  end if;
  norm_tag := app.flux_peripheral_identity_value(movement.tag);
  norm_serial := app.flux_peripheral_identity_value(movement.serial);
  if norm_serial is null then return jsonb_build_object('state', 'invalid-identity'); end if;
  if norm_tag is not null and app.inventory_tag_peripheral_type(norm_tag) is distinct from intent.peripheral_kind then
    return jsonb_build_object('state', 'invalid-type');
  end if;
  if movement.management_computer_id is not null or exists (
    select 1 from public.module_records r
    where r.management_computer_id is not null and (
      app.flux_peripheral_identity_value(coalesce(r.payload->>'serial', r.payload->>'numeroSerie',
        r.payload->>'numero_série', r.payload->>'numero_serie')) = norm_serial
      or app.flux_peripheral_identity_value(r.payload->>'tag') = norm_tag)
  ) or exists (
    select 1 from public.supply_units u where app.flux_peripheral_identity_value(u.serial_number) = norm_serial
      or app.flux_peripheral_identity_value(u.code) = norm_tag
  ) then
    return jsonb_build_object('state', 'conflict');
  end if;
  select count(*) into match_count from public.inventory_items i
    where app.flux_peripheral_identity_value(i.serial) = norm_serial
      or app.flux_peripheral_identity_value(i.tag) = norm_tag;
  if match_count > 1 then return jsonb_build_object('state', 'conflict'); end if;
  if match_count = 1 then
    select * into candidate from public.inventory_items i
      where app.flux_peripheral_identity_value(i.serial) = norm_serial
        or app.flux_peripheral_identity_value(i.tag) = norm_tag;
    if app.flux_peripheral_identity_value(candidate.serial) is distinct from norm_serial
      or (norm_tag is not null and app.flux_peripheral_identity_value(candidate.tag) is distinct from norm_tag)
      or (movement.inventory_item_id is not null and movement.inventory_item_id is distinct from candidate.id)
      or (candidate.peripheral_kind is not null and candidate.peripheral_kind is distinct from intent.peripheral_kind)
      or (nullif(btrim(candidate.tag), '') is not null
        and app.inventory_tag_peripheral_type(candidate.tag) is distinct from intent.peripheral_kind)
      or (candidate.location ~* '^PDV[[:space:]]*[0-9]+$' and
        app.inventory_tag_peripheral_type(candidate.tag) is distinct from intent.peripheral_kind) then
      return jsonb_build_object('state', 'conflict');
    end if;
    if not coalesce(app.can_manage_module_table(candidate.table_id, 'inventory', 'update'), false) then
      raise exception 'Sem permissão para vincular ao equipamento existente no Inventário.';
    end if;
    if candidate.table_id is distinct from intent.inventory_table_id then
      select name into category_name from public.module_tables where id = candidate.table_id;
      return jsonb_build_object('state', 'category-conflict', 'tableName', category_name);
    end if;
  elsif movement.inventory_item_id is not null then
    return jsonb_build_object('state', 'conflict');
  end if;
  if exists (select 1 from public.control_items c
    where (app.flux_peripheral_identity_value(c.serial) = norm_serial or
        app.flux_peripheral_identity_value(c.tag) = norm_tag)
      and (candidate.id is null or (c.inventory_item_id is distinct from candidate.id
        and c.verification_inventory_item_id is distinct from candidate.id))) then
    return jsonb_build_object('state', 'conflict');
  end if;
  select name into category_name from public.module_tables
    where id = coalesce(candidate.table_id, intent.inventory_table_id) and module = 'inventory';
  return jsonb_build_object('state', case when candidate.id is null then 'new' else 'existing' end,
    'inventoryItemId', candidate.id, 'tableName', category_name, 'peripheralKind', intent.peripheral_kind,
    'sector', coalesce(candidate.sector, intent.peripheral_sector),
    'status', coalesce(candidate.status, 'Reserva'), 'location', coalesce(candidate.location, 'Sala CPD'),
    'token', md5(jsonb_build_array(movement.id, movement.updated_at, movement.tag, movement.serial,
      intent.inventory_table_id, intent.peripheral_kind, intent.peripheral_sector, intent.updated_at,
      candidate.id, candidate.updated_at, candidate.tag, candidate.serial, category_name)::text));
end;
$$;

create function public.flux_complete_peripheral_acquisition(p_flux_item_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  asset public.inventory_items%rowtype;
  review jsonb;
  event_id uuid;
  linked boolean;
  message_text text;
begin
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id for update;
  if auth.uid() is null or not coalesce(app.can_manage_module_table(movement.table_id, 'flux', 'update'), false)
    or not coalesce(app.can_manage_module('management', 'create'), false)
    or not coalesce(app.can_manage_module_table(intent.inventory_table_id, 'inventory', 'create'), false) then
    raise exception 'Sem permissão para confirmar o recebimento.';
  end if;
  if intent.destination is distinct from 'management' or intent.management_kind is distinct from 'peripheral' then
    raise exception 'A aquisição não está destinada à Gestão TI como periférico.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'alreadyApplied', true, 'inventoryItemId', intent.inventory_item_id);
  end if;
  -- Mesmo bloqueio de série usado nos dois caminhos de aquisição existentes.
  perform pg_advisory_xact_lock(89116, hashtext(app.flux_peripheral_identity_value(movement.serial)));
  lock table public.inventory_items, public.module_records, public.control_items, public.supply_units
    in share row exclusive mode;
  review := public.flux_preview_peripheral_acquisition(p_flux_item_id);
  if review->>'state' not in ('new', 'existing') then
    raise exception 'Recebimento ou identidade do periférico precisa ser conferido antes de cadastrar.';
  end if;
  if p_token is null or p_token is distinct from review->>'token' then
    raise exception 'O destino ou a identidade mudou. Abra a prévia novamente.';
  end if;
  linked := review->>'state' = 'existing';
  if linked then
    select * into strict asset from public.inventory_items where id = (review->>'inventoryItemId')::uuid for update;
    if asset.peripheral_kind is null then
      update public.inventory_items set peripheral_kind = intent.peripheral_kind where id = asset.id returning * into asset;
    end if;
  else
    insert into public.inventory_items(table_id, equipment, model, brand, serial, tag, sector, location,
      status, situation, cleaning_type, notes, position, peripheral_kind)
    values(intent.inventory_table_id, movement.equipment, movement.model, movement.brand, btrim(movement.serial),
      case when app.flux_peripheral_identity_value(movement.tag) is null then '' else upper(btrim(movement.tag)) end,
      intent.peripheral_sector, 'Sala CPD', 'Reserva', 'Normal', 'Não realizada', '', 0, intent.peripheral_kind)
    returning * into asset;
  end if;

  message_text := left(format('%s recebido para Gestão TI. Série %s, %s, categoria %s. %s',
    intent.peripheral_kind, asset.serial, coalesce(nullif(btrim(asset.tag), ''), 'sem TAG'),
    review->>'tableName', case when linked then 'Vínculo com patrimônio existente, sem alteração de local.'
      else 'Cadastrado em Reserva na Sala CPD. Instalação por conferência de PDV.' end), 500);
  insert into public.equipment_events(source_module, source_event_key, source_id, inventory_item_id,
    action, new_status, new_location, reason, affected_modules, processing_result, metadata, actor_id)
  values ('flux', 'peripheral-acquisition:' || movement.id::text, movement.id, asset.id,
    'Aquisição recebida', asset.status, asset.location, 'Aquisição', jsonb_build_array('flux', 'inventory', 'management'),
    jsonb_build_object('inventory', case when linked then 'linked' else 'created' end,
      'management', 'installation-not-executed'),
    jsonb_build_object('fluxItemId', movement.id, 'peripheralKind', intent.peripheral_kind,
      'tag', asset.tag, 'serial', asset.serial, 'sector', asset.sector, 'linkedExisting', linked), auth.uid())
  returning id into event_id;
  insert into public.inventory_item_logs(inventory_item_id, action, message, event_id)
    values(asset.id, case when linked then 'update' else 'create' end, message_text, event_id);
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
    values(movement.id, 'update', message_text, event_id);
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
    values(event_id, 'inventory', 'applied', 1, now()), (event_id, 'flux', 'applied', 1, now()),
          (event_id, 'management', 'skipped', 0, now());
  update public.flux_acquisition_intents set status = 'completed', inventory_item_id = asset.id,
    inventory_table_id = asset.table_id, actor_id = auth.uid(), updated_at = now()
    where flux_item_id = movement.id;
  return jsonb_build_object('status', 'completed', 'alreadyApplied', false,
    'inventoryItemId', asset.id, 'linkedExisting', linked, 'eventId', event_id);
end;
$$;

revoke all on function public.flux_set_peripheral_acquisition_intent(uuid,uuid,text,text),
  public.flux_preview_peripheral_acquisition(uuid), public.flux_complete_peripheral_acquisition(uuid,text)
  from public, anon;
grant execute on function public.flux_set_peripheral_acquisition_intent(uuid,uuid,text,text),
  public.flux_preview_peripheral_acquisition(uuid), public.flux_complete_peripheral_acquisition(uuid,text)
  to authenticated;
revoke all on function app.clear_old_flux_peripheral_destination(),
  app.guard_classified_inventory_peripheral(), app.record_classified_inventory_peripheral_tag()
  from public, anon, authenticated;

commit;
