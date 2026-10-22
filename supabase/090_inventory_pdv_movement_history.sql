-- RASCUNHO LOCAL: não aplicar em produção; pendências em
-- docs/INVENTORY_PDV_MOVEMENT_090.md.
-- Registra movimentos reais de periféricos nas posições físicas dos PDVs.
-- Não cria eventos retroativos nem modifica computadores ou periféricos.
-- Dependências técnicas: 063, 079, 086 e 088.
begin;

do $$
begin
  if to_regprocedure('public.management_movement_history(uuid,uuid)') is null
    or to_regprocedure('public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text)') is null
    or to_regprocedure('public.inventory_replace_equipment(uuid,uuid,text,text,text)') is null
    or to_regprocedure('app.inventory_tag_peripheral_type(text)') is null
    or to_regclass('public.equipment_events') is null
    or to_regclass('public.inventory_replacements') is null then
    raise exception 'As migrações 063, 079, 086 e 088 são obrigatórias antes da 090.';
  end if;
end;
$$;

create or replace function app.record_inventory_pdv_peripheral_movement()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  previous_position uuid;
  next_position uuid;
  previous_count integer;
  next_count integer;
  requested_event_id text := nullif(current_setting('app.inventory_pdv_movement_id', true), '');
  requested_group_id text := nullif(current_setting('app.inventory_pdv_operation_id', true), '');
  movement_event_id uuid := coalesce(requested_event_id::uuid,
    md5(requested_group_id || ':' || new.id::text)::uuid, gen_random_uuid());
  peripheral_type text;
  movement_message text;
  reason_text text := nullif(btrim(current_setting('app.inventory_pdv_movement_reason', true)), '');
  request_hash text := nullif(current_setting('app.inventory_pdv_movement_hash', true), '');
begin
  if old.location is not distinct from new.location then return new; end if;
  peripheral_type := coalesce(app.inventory_tag_peripheral_type(new.tag),
    app.inventory_tag_peripheral_type(old.tag));
  if peripheral_type is null then return new; end if;

  select count(*), min(r.id::text)::uuid into previous_count, previous_position
  from public.module_records r
  join public.module_tables t on t.id = r.table_id and t.module = 'management'
  where r.payload ->> 'terminal' ~* '^PDV[[:space:]]+[0-9]+$'
    and lower(btrim(r.payload ->> 'terminal')) = lower(btrim(old.location));
  select count(*), min(r.id::text)::uuid into next_count, next_position
  from public.module_records r
  join public.module_tables t on t.id = r.table_id and t.module = 'management'
  where r.payload ->> 'terminal' ~* '^PDV[[:space:]]+[0-9]+$'
    and lower(btrim(r.payload ->> 'terminal')) = lower(btrim(new.location));
  if previous_count > 1 or next_count > 1 then
    raise exception 'Posição física de PDV ambígua; movimentação de periférico cancelada.';
  end if;
  if (btrim(coalesce(old.location, '')) ~* '^PDV[[:space:]]+[0-9]+$'
      and previous_count <> 1)
    or (btrim(coalesce(new.location, '')) ~* '^PDV[[:space:]]+[0-9]+$'
      and next_count <> 1) then
    raise exception 'PDV de origem ou destino inexistente; movimentação de periférico cancelada.';
  end if;
  if previous_position is null and next_position is null then return new; end if;
  if char_length(coalesce(reason_text, '')) not between 5 and 500 then
    raise exception 'Informe o motivo da movimentação física do periférico (5 a 500 caracteres).';
  end if;

  movement_message := left(format('Periférico %s (TAG %s): %s → %s. Motivo: %s. Evento %s.',
    coalesce(nullif(btrim(new.equipment), ''), peripheral_type),
    coalesce(nullif(btrim(new.tag), ''), 'sem TAG'),
    coalesce(nullif(btrim(old.location), ''), 'Local não informado'),
    coalesce(nullif(btrim(new.location), ''), 'Local não informado'),
    reason_text,
    movement_event_id), 500);
  insert into public.equipment_events (
    id, source_module, source_event_key, source_id, inventory_item_id,
    action, previous_status, new_status, previous_location, new_location,
    origin_location, destination_location, reason, affected_modules,
    processing_result, metadata, actor_id
  ) values (
    movement_event_id, 'inventory', 'peripheral-location:' || movement_event_id::text,
    new.id, new.id, 'peripheral-transfer', old.status, new.status,
    old.location, new.location, old.location, new.location,
    reason_text,
    '["inventory","management"]'::jsonb, '{"status":"applied"}'::jsonb,
    jsonb_build_object(
      'positionIds', to_jsonb(array_remove(array[previous_position, next_position], null)),
      'requestHash', request_hash,
      'operationId', coalesce(requested_group_id, movement_event_id::text),
      'peripheral', jsonb_build_object(
        'inventoryItemId', new.id, 'equipment', new.equipment,
        'tag', new.tag, 'serial', new.serial, 'type', peripheral_type,
        'fromPositionId', previous_position, 'toPositionId', next_position,
        'fromLocation', old.location, 'toLocation', new.location)
    ), auth.uid()
  );
  -- A permuta 079 já escreve seu próprio log. A RPC abaixo vincula esse log
  -- ao evento, evitando duas entradas idênticas no histórico do item.
  if requested_group_id is null then
    insert into public.inventory_item_logs (inventory_item_id, action, message, event_id)
    values (new.id, 'update', movement_message, movement_event_id);
  end if;
  insert into public.equipment_event_effects
    (event_id, module, status, attempts, processed_at)
  values (movement_event_id, 'inventory', 'applied', 1, now()),
         (movement_event_id, 'management', 'applied', 1, now());
  return new;
end;
$$;

-- A sincronização da 086 executa primeiro; se falhar, o evento também
-- será revertido pela mesma transação.
drop trigger if exists z_inventory_pdv_peripheral_movement on public.inventory_items;
create trigger z_inventory_pdv_peripheral_movement
  after update of location on public.inventory_items
  for each row execute function app.record_inventory_pdv_peripheral_movement();

-- O formulário envia uma única operação: edição, sincronização dos vínculos,
-- evento e log são revertidos juntos quando qualquer validação falhar.
create or replace function public.inventory_save_pdv_peripheral(
  p_item_id uuid, p_values jsonb, p_expected_updated_at timestamptz,
  p_reason text, p_operation_id uuid
) returns public.inventory_items language plpgsql security definer
  set search_path = public, app, pg_temp as $$
declare
  prior public.inventory_items%rowtype;
  proposed public.inventory_items%rowtype;
  saved public.inventory_items%rowtype;
  prior_event public.equipment_events%rowtype;
  request_hash text;
  reason_text text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or p_item_id is null or p_operation_id is null
    or p_expected_updated_at is null or jsonb_typeof(p_values) <> 'object'
    or char_length(reason_text) not between 5 and 500 then
    raise exception 'Informe equipamento, versão atual, operação e motivo (5 a 500 caracteres).';
  end if;
  request_hash := md5(p_item_id::text || ':' || p_expected_updated_at::text
    || ':' || p_values::text || ':' || reason_text);
  perform pg_advisory_xact_lock(89090, hashtext(p_operation_id::text));
  select * into prior_event from public.equipment_events
  where id = p_operation_id;
  if found then
    if prior_event.source_module <> 'inventory'
      or prior_event.inventory_item_id is distinct from p_item_id
      or prior_event.metadata ->> 'requestHash' is distinct from request_hash then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    select * into saved from public.inventory_items where id = p_item_id;
    if not found then raise exception 'Equipamento movimentado não foi encontrado.'; end if;
    if saved.location is distinct from prior_event.new_location then
      raise exception 'Operação já registrada, mas o equipamento foi movimentado novamente. Atualize a consulta.';
    end if;
    return saved;
  end if;

  select item.* into prior from public.inventory_items item
  join public.module_tables t on t.id = item.table_id and t.module = 'inventory'
  where item.id = p_item_id for update of item;
  if not found then raise exception 'Equipamento não encontrado no Inventário.'; end if;
  if not app.can_manage_module_table(prior.table_id, 'inventory', 'update') then
    raise exception 'Sem permissão para movimentar este equipamento no Inventário.';
  end if;
  if prior.updated_at is distinct from p_expected_updated_at then
    raise exception 'O equipamento mudou. Atualize os dados e revise a movimentação.';
  end if;
  proposed := jsonb_populate_record(prior, p_values);
  if proposed.table_id is distinct from prior.table_id
    or app.inventory_tag_peripheral_type(proposed.tag) is null
    or proposed.location is not distinct from prior.location
    or not (btrim(coalesce(prior.location, '')) ~* '^PDV[[:space:]]+[0-9]+$'
      or btrim(coalesce(proposed.location, '')) ~* '^PDV[[:space:]]+[0-9]+$') then
    raise exception 'Esta operação exige periférico e mudança de Local envolvendo um PDV.';
  end if;

  perform set_config('app.inventory_pdv_movement_id', p_operation_id::text, true);
  perform set_config('app.inventory_pdv_movement_reason', reason_text, true);
  perform set_config('app.inventory_pdv_movement_hash', request_hash, true);
  update public.inventory_items set
    equipment = proposed.equipment, model = proposed.model,
    brand = proposed.brand, serial = proposed.serial, tag = proposed.tag,
    sector = proposed.sector, location = proposed.location,
    status = proposed.status, situation = proposed.situation,
    cleaning_type = proposed.cleaning_type, notes = proposed.notes,
    branch_id = proposed.branch_id, position = proposed.position
  where id = p_item_id returning * into saved;
  if not exists (select 1 from public.equipment_events where id = p_operation_id
    and inventory_item_id = p_item_id and action = 'peripheral-transfer') then
    raise exception 'Movimentação não gerou evento patrimonial; alterações canceladas.';
  end if;
  perform set_config('app.inventory_pdv_movement_id', '', true);
  perform set_config('app.inventory_pdv_movement_reason', '', true);
  perform set_config('app.inventory_pdv_movement_hash', '', true);
  return saved;
end;
$$;

revoke all on function public.inventory_save_pdv_peripheral(
  uuid, jsonb, timestamptz, text, uuid) from public;
grant execute on function public.inventory_save_pdv_peripheral(
  uuid, jsonb, timestamptz, text, uuid) to authenticated;

-- Mantém a função 079 intacta. Esta envoltória registra um motivo explícito
-- e correlaciona os dois eventos de uma permuta por operationId.
create or replace function public.inventory_swap_locations_with_reason(
  p_first uuid, p_second uuid, p_operation_id uuid,
  p_first_sector text, p_first_location text,
  p_second_sector text, p_second_location text, p_reason text
) returns void language plpgsql security definer
  set search_path = public, app, pg_temp as $$
declare
  reason_text text := btrim(coalesce(p_reason, ''));
  existing_count integer;
  linked_count integer;
begin
  if auth.uid() is null or not app.can_manage_module('inventory', 'update') then
    raise exception 'Sem permissão para permutar equipamentos no Inventário.';
  end if;
  if p_first is null or p_second is null or p_first = p_second
    or p_operation_id is null or char_length(reason_text) not between 5 and 500 then
    raise exception 'Escolha dois equipamentos, uma operação e um motivo (5 a 500 caracteres).';
  end if;
  perform pg_advisory_xact_lock(89091, hashtext(p_operation_id::text));
  if exists (select 1 from public.inventory_branch_events
    where correlation_id = p_operation_id and operation <> 'swap') then
    raise exception 'Identificador de operação já utilizado por outra ação.';
  end if;
  select count(*) into existing_count from public.inventory_branch_events
  where correlation_id = p_operation_id and operation = 'swap';
  if existing_count > 0 then
    if existing_count <> 2 or exists (
      select 1 from public.inventory_branch_events e
      where e.correlation_id = p_operation_id and e.operation = 'swap'
        and not (
          (e.item_id = p_first
            and e.details ->> 'other_item_id' = p_second::text
            and e.details ->> 'previous_sector' is not distinct from p_first_sector
            and e.details ->> 'previous_location' is not distinct from p_first_location)
          or (e.item_id = p_second
            and e.details ->> 'other_item_id' = p_first::text
            and e.details ->> 'previous_sector' is not distinct from p_second_sector
            and e.details ->> 'previous_location' is not distinct from p_second_location)
        )
    ) or exists (
      select 1 from public.inventory_branch_events e
      where e.correlation_id = p_operation_id and e.operation = 'swap'
        and e.details ->> 'reason' is distinct from reason_text
    ) then
      raise exception 'Identificador de permuta já usado com dados diferentes.';
    end if;
    return;
  end if;

  perform set_config('app.inventory_pdv_operation_id', p_operation_id::text, true);
  perform set_config('app.inventory_pdv_movement_reason', reason_text, true);
  perform public.inventory_swap_locations(p_first, p_second, p_operation_id,
    p_first_sector, p_first_location, p_second_sector, p_second_location);
  perform set_config('app.inventory_pdv_operation_id', '', true);
  perform set_config('app.inventory_pdv_movement_reason', '', true);
  update public.inventory_branch_events e
  set details = e.details || jsonb_build_object(
    'reason', reason_text,
    'movementEventId', (
      select movement.id from public.equipment_events movement
      where movement.source_module = 'inventory'
        and movement.action = 'peripheral-transfer'
        and movement.inventory_item_id = e.item_id
        and movement.metadata ->> 'operationId' = p_operation_id::text
    ))
  where e.correlation_id = p_operation_id and e.operation = 'swap'
    and e.item_id in (p_first, p_second);
  get diagnostics linked_count = row_count;
  if linked_count <> 2 then
    raise exception 'A permuta não produziu os dois registros esperados; operação cancelada.';
  end if;
  update public.inventory_item_logs log_row
  set event_id = (
      select movement.id from public.equipment_events movement
      where movement.source_module = 'inventory'
        and movement.action = 'peripheral-transfer'
        and movement.inventory_item_id = log_row.inventory_item_id
        and movement.metadata ->> 'operationId' = p_operation_id::text
    ),
    message = left(log_row.message || ' Motivo: ' || reason_text || '.', 500)
  where log_row.inventory_item_id in (p_first, p_second)
    and log_row.message like 'Permuta ' || p_operation_id::text || ':%';
end;
$$;

revoke all on function public.inventory_swap_locations_with_reason(
  uuid,uuid,uuid,text,text,text,text,text) from public;
grant execute on function public.inventory_swap_locations_with_reason(
  uuid,uuid,uuid,text,text,text,text,text) to authenticated;

-- Preserva o fluxo e as validações da 061. O ID da substituição também
-- correlaciona os dois movimentos físicos, e os dois logs existentes
-- recebem o respectivo event_id sem criar registros adicionais.
create or replace function public.inventory_replace_equipment(
  p_removed_item_id uuid, p_installed_item_id uuid, p_removed_status text,
  p_removed_location text, p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  outgoing public.inventory_items%rowtype;
  incoming public.inventory_items%rowtype;
  result_id uuid := gen_random_uuid();
  outgoing_label text;
  incoming_label text;
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

  perform set_config('app.inventory_pdv_operation_id', result_id::text, true);
  perform set_config('app.inventory_pdv_movement_reason', btrim(p_reason), true);
  update public.inventory_items set status = p_removed_status, location = btrim(p_removed_location)
    where id = outgoing.id;
  update public.inventory_items set status = 'Ativo', location = outgoing.location
    where id = incoming.id;
  perform set_config('app.inventory_pdv_operation_id', '', true);
  perform set_config('app.inventory_pdv_movement_reason', '', true);
  insert into public.inventory_replacements
    (id, removed_item_id, installed_item_id, removed_identity, installed_identity,
     removed_tag, installed_tag, previous_location, removed_location,
     removed_status, reason, actor_id)
  values (result_id, outgoing.id, incoming.id, outgoing.id, incoming.id,
    outgoing_label, incoming_label, outgoing.location, btrim(p_removed_location),
    p_removed_status, btrim(p_reason), auth.uid());
  insert into public.inventory_item_logs (inventory_item_id, action, message, event_id) values
    (outgoing.id, 'update', left(format('%s saiu de %s; status: %s; destino: %s; substituída por %s. Motivo: %s',
      outgoing_label, outgoing.location, p_removed_status, btrim(p_removed_location), incoming_label, btrim(p_reason)), 500),
      (select id from public.equipment_events where source_module = 'inventory'
        and action = 'peripheral-transfer' and inventory_item_id = outgoing.id
        and metadata ->> 'operationId' = result_id::text)),
    (incoming.id, 'update', left(format('%s instalada em %s em substituição a %s. Motivo: %s',
      incoming_label, outgoing.location, outgoing_label, btrim(p_reason)), 500),
      (select id from public.equipment_events where source_module = 'inventory'
        and action = 'peripheral-transfer' and inventory_item_id = incoming.id
        and metadata ->> 'operationId' = result_id::text));
  return result_id;
end;
$$;

revoke all on function public.inventory_replace_equipment(uuid,uuid,text,text,text) from public;
grant execute on function public.inventory_replace_equipment(uuid,uuid,text,text,text) to authenticated;

create or replace function public.management_movement_history(
  p_computer_id uuid default null, p_position_id uuid default null
) returns table (
  event_id uuid, occurred_at timestamptz, action text, reason text,
  metadata jsonb, processing_result jsonb
) language sql stable security invoker set search_path = public as $$
  select e.id, e.created_at, e.action, e.reason, e.metadata, e.processing_result
  from public.equipment_events e
  where (
    e.source_module = 'management'
    and ((p_computer_id is not null
      and e.metadata -> 'computerIds' @> jsonb_build_array(p_computer_id))
      or (p_position_id is not null
        and e.metadata -> 'positionIds' @> jsonb_build_array(p_position_id)))
  ) or (
    e.source_module = 'inventory' and e.action = 'peripheral-transfer'
    and p_position_id is not null
    and e.metadata -> 'positionIds' @> jsonb_build_array(p_position_id)
  )
  order by e.created_at desc, e.id desc limit 100;
$$;

revoke all on function public.management_movement_history(uuid, uuid) from public;
grant execute on function public.management_movement_history(uuid, uuid) to authenticated;

commit;
