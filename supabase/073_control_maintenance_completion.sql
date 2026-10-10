-- ALDECKOT | Conclusão transacional de manutenção no Controle TI.
-- Aplicar após 072_flux_management_maintenance.sql. Não reconcilia dados antigos.
begin;

-- O status do equipamento é a autoridade para abrir manutenção. Uma situação
-- antiga "Em Manutenção" não pode reabrir um chamado concluído.
create or replace function app.management_requires_control(p_payload jsonb)
returns boolean language sql immutable set search_path = public as $$
  select lower(btrim(coalesce(p_payload ->> 'status', ''))) in
      ('manutenção', 'manutencao', 'em manutenção', 'em manutencao', 'defeito')
    or (
      lower(btrim(coalesce(p_payload ->> 'status', ''))) not in ('ativo', 'reserva')
      and lower(btrim(coalesce(p_payload ->> 'situation', ''))) in
        ('em manutenção', 'em manutencao')
    );
$$;

-- Durante a transação coordenada os dois sentidos já são aplicados pela RPC.
-- O contexto é local à transação e removido antes de retornar.
drop trigger if exists management_record_control_sync on public.module_records;
create trigger management_record_control_sync
  after insert or update of payload on public.module_records
  for each row
  when (coalesce(current_setting('app.control_completion_event', true), '') = '')
  execute function app.sync_control_from_management();

drop trigger if exists control_item_inventory_status_sync on public.control_items;
create trigger control_item_inventory_status_sync
  after insert or update of status, tag, serial on public.control_items
  for each row
  when (coalesce(current_setting('app.control_completion_event', true), '') = '')
  execute function app.sync_inventory_status_from_control();

drop trigger if exists control_item_management_status_sync on public.control_items;
create trigger control_item_management_status_sync
  after insert or update of status, tag, serial on public.control_items
  for each row
  when (coalesce(current_setting('app.control_completion_event', true), '') = '')
  execute function app.sync_management_status_from_control();

-- A conclusão coordenada escreve um log em cada origem com o mesmo event_id.
-- Não duplicar esses logs pelas rotinas legadas de espelhamento.
drop trigger if exists control_log_inventory_history_sync on public.control_item_logs;
create trigger control_log_inventory_history_sync
  after insert on public.control_item_logs
  for each row
  when (not (new.event_id is not null and
    coalesce(current_setting('app.control_completion_skip_log_copy', true), '') = 'on'))
  execute function app.copy_control_log_to_inventory();

drop trigger if exists control_log_management_history_sync on public.control_item_logs;
create trigger control_log_management_history_sync
  after insert on public.control_item_logs
  for each row
  when (not (new.event_id is not null and
    coalesce(current_setting('app.control_completion_skip_log_copy', true), '') = 'on'))
  execute function app.copy_control_log_to_management();

create or replace function app.guard_linked_control_completion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'Manutenção concluída'
    and old.status is distinct from new.status
    and (old.inventory_item_id is not null or old.management_record_id is not null)
    and old.supply_unit_id is null
    and coalesce(current_setting('app.control_completion_event', true), '') = '' then
    raise exception 'Escolha Ativo ou Reserva na conclusão de manutenção do Controle TI.';
  end if;
  return new;
end; $$;
drop trigger if exists linked_control_completion_guard on public.control_items;
create trigger linked_control_completion_guard
  before update of status on public.control_items
  for each row execute function app.guard_linked_control_completion();

create or replace function public.complete_control_maintenance(
  p_control_item_id uuid,
  p_equipment_status text,
  p_request_id uuid,
  p_control_fields jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ticket public.control_items%rowtype;
  inventory_id uuid;
  inventory_row public.inventory_items%rowtype;
  computer public.module_records%rowtype;
  management_matches integer;
  source_module text;
  source_id uuid;
  previous_status text;
  previous_location text;
  event_row public.equipment_events%rowtype;
  prior_event public.equipment_events%rowtype;
  current_source_status text;
  next_payload jsonb;
  existing_logs jsonb;
  log_message text;
begin
  if auth.uid() is null or p_control_item_id is null or p_request_id is null
    or p_equipment_status is null or p_equipment_status not in ('Ativo', 'Reserva')
    or p_control_fields is null or jsonb_typeof(p_control_fields) <> 'object' then
    raise exception 'Informe o chamado, a operação e escolha Ativo ou Reserva.';
  end if;

  select c.* into ticket from public.control_items c
  join public.module_tables t on t.id = c.table_id and t.module = 'control'
  where c.id = p_control_item_id for update of c;
  if not found then raise exception 'Chamado não encontrado no Controle TI.'; end if;
  if not coalesce(app.can_manage_module_table(ticket.table_id, 'control', 'update'), false) then
    raise exception 'Sem permissão para concluir o chamado no Controle TI.';
  end if;
  if ticket.supply_unit_id is not null then
    raise exception 'Use a conclusão própria da ordem de Suprimentos.';
  end if;
  if ticket.inventory_item_id is not null and ticket.management_record_id is not null then
    raise exception 'Chamado vinculado a duas origens. Revise a identidade antes de concluir.';
  end if;
  if (p_control_fields ? 'tag' and p_control_fields ->> 'tag' is distinct from ticket.tag)
    or (p_control_fields ? 'serial' and p_control_fields ->> 'serial' is distinct from ticket.serial) then
    raise exception 'A TAG e a série não podem mudar durante a conclusão. Edite a identidade separadamente.';
  end if;

  inventory_id := ticket.inventory_item_id;
  if inventory_id is null and ticket.management_record_id is null then
    inventory_id := app.resolve_inventory_item_id(null, ticket.tag, ticket.serial);
    select count(*) into management_matches
    from public.module_records r join public.module_tables t on t.id = r.table_id
    where t.module = 'management'
      and app.management_identity_matches(r.payload, ticket.tag, ticket.serial);
    if management_matches > 1 or (management_matches = 1 and inventory_id is not null) then
      raise exception 'Identidade ambígua entre Inventário e Gestão TI. Revise os vínculos.';
    end if;
    if management_matches = 1 then
      select r.* into computer from public.module_records r
      join public.module_tables t on t.id = r.table_id and t.module = 'management'
      where app.management_identity_matches(r.payload, ticket.tag, ticket.serial)
      for update of r;
    end if;
  end if;

  if inventory_id is not null then
    select i.* into inventory_row from public.inventory_items i
    join public.module_tables t on t.id = i.table_id and t.module = 'inventory'
    where i.id = inventory_id for update of i;
    if not found then raise exception 'Equipamento vinculado não encontrado no Inventário.'; end if;
    if (nullif(btrim(ticket.tag), '') is not null
        and lower(btrim(ticket.tag)) is distinct from lower(btrim(inventory_row.tag)))
      or (nullif(btrim(ticket.serial), '') is not null
        and lower(btrim(ticket.serial)) is distinct from lower(btrim(inventory_row.serial))) then
      raise exception 'A identidade do Inventário diverge do chamado. Revise o vínculo.';
    end if;
    if not coalesce(app.can_manage_module_table(inventory_row.table_id, 'inventory', 'update'), false) then
      raise exception 'Sem permissão para atualizar o equipamento no Inventário.';
    end if;
    source_module := 'inventory';
    source_id := inventory_row.id;
    previous_status := inventory_row.status;
    previous_location := inventory_row.location;
  elsif ticket.management_record_id is not null or computer.id is not null then
    if ticket.management_record_id is not null then
      select r.* into computer from public.module_records r
      join public.module_tables t on t.id = r.table_id and t.module = 'management'
      where r.id = ticket.management_record_id for update of r;
    end if;
    if computer.id is null or not app.management_identity_matches(computer.payload, ticket.tag, ticket.serial) then
      raise exception 'Computador da Gestão TI não encontrado ou identidade alterada.';
    end if;
    if not coalesce(app.can_manage_module_table(computer.table_id, 'management', 'update'), false) then
      raise exception 'Sem permissão para atualizar o computador na Gestão TI.';
    end if;
    source_module := 'management';
    source_id := computer.id;
    previous_status := coalesce(computer.payload ->> 'status', 'Não informado');
    previous_location := computer.payload ->> 'location';
  else
    raise exception 'Nenhum equipamento de origem localizado. Vincule o chamado antes de concluir.';
  end if;

  current_source_status := case when source_module = 'inventory'
    then inventory_row.status else computer.payload ->> 'status' end;
  select e.* into prior_event from public.equipment_events e
  where e.source_module = 'control' and e.source_id = ticket.id
    and e.action = 'Manutenção concluída'
  order by e.created_at desc limit 1;

  if ticket.status = 'Manutenção concluída' then
    if prior_event.id is not null and prior_event.new_status = p_equipment_status
      and current_source_status = p_equipment_status
      and exists (select 1 from public.equipment_event_effects x
        where x.event_id = prior_event.id and x.module = 'control' and x.status = 'applied')
      and exists (select 1 from public.equipment_event_effects x
        where x.event_id = prior_event.id and x.module = source_module and x.status = 'applied')
    then return jsonb_build_object('eventId', prior_event.id, 'status', 'already-applied'); end if;
    raise exception 'Chamado já concluído, mas o equipamento ou o evento diverge. Revise antes de repetir.';
  end if;
  if ticket.status not in ('Em manutenção', 'Aguardando avaliação') then
    raise exception 'Somente chamados em manutenção podem ser concluídos por esta operação.';
  end if;
  if exists (select 1 from public.equipment_events e
    where e.source_module = 'control'
      and e.source_event_key = 'maintenance-complete:' || p_request_id::text) then
    raise exception 'Este identificador de operação já foi utilizado em outro chamado.';
  end if;

  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     previous_status, new_status, previous_location, new_location,
     affected_modules, processing_result, metadata, actor_id)
  values ('control', 'maintenance-complete:' || p_request_id::text, ticket.id,
    inventory_id, 'Manutenção concluída', previous_status, p_equipment_status,
    previous_location, previous_location, jsonb_build_array('control', source_module),
    '{}'::jsonb, jsonb_build_object('controlItemId', ticket.id,
      'sourceModule', source_module, 'sourceId', source_id,
      'controlStatusBefore', ticket.status,
      'controlStatusAfter', 'Manutenção concluída',
      'equipmentStatus', p_equipment_status), auth.uid())
  returning * into event_row;

  perform set_config('app.control_completion_event', event_row.id::text, true);
  perform set_config('app.control_completion_skip_log_copy', 'on', true);
  log_message := left(format(
    'Manutenção concluída no Controle TI. Equipamento: %s → %s. Evento: %s.',
    previous_status, p_equipment_status, event_row.id), 500);

  if source_module = 'inventory' then
    update public.inventory_items set status = p_equipment_status where id = inventory_id;
    insert into public.inventory_item_logs
      (inventory_item_id, action, message, event_id)
    values (inventory_id, 'update', log_message, event_row.id);
  else
    existing_logs := case when jsonb_typeof(computer.payload -> 'logs') = 'array'
      then computer.payload -> 'logs' else '[]'::jsonb end;
    next_payload := jsonb_set(computer.payload, '{status}', to_jsonb(p_equipment_status), true);
    next_payload := jsonb_set(next_payload, '{logs}', existing_logs ||
      jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text,
        'at', now(), 'text', log_message, 'sourceModule', 'control',
        'sourceId', ticket.id::text, 'eventId', event_row.id::text)), true);
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(log_message), true);
    update public.module_records set payload = next_payload where id = computer.id;
  end if;

  update public.control_items set
    equipment = coalesce(p_control_fields ->> 'equipment', ticket.equipment),
    model = coalesce(p_control_fields ->> 'model', ticket.model),
    brand = coalesce(p_control_fields ->> 'brand', ticket.brand),
    sector = coalesce(p_control_fields ->> 'sector', ticket.sector),
    entry_date = case when p_control_fields ? 'entryDate'
      then nullif(p_control_fields ->> 'entryDate', '')::date else ticket.entry_date end,
    exit_date = case when p_control_fields ? 'exitDate'
      then nullif(p_control_fields ->> 'exitDate', '')::date else ticket.exit_date end,
    cleaning_type = coalesce(p_control_fields ->> 'cleaningType', ticket.cleaning_type),
    notes = coalesce(p_control_fields ->> 'notes', ticket.notes),
    status = 'Manutenção concluída'
  where id = ticket.id;

  insert into public.control_item_logs (control_item_id, action, message, event_id)
  values (ticket.id, 'update', log_message, event_row.id);
  insert into public.equipment_event_effects
    (event_id, module, status, attempts, processed_at)
  values (event_row.id, 'control', 'applied', 1, now()),
         (event_row.id, source_module, 'applied', 1, now());
  update public.equipment_events
    set processing_result = jsonb_build_object('status', 'applied',
      'controlItemId', ticket.id, 'sourceModule', source_module,
      'sourceId', source_id, 'equipmentStatus', p_equipment_status)
    where id = event_row.id;
  insert into public.sync_events (module, operation, details, event_id)
  values ('control', 'update', jsonb_build_object('itemId', ticket.id,
      'tableId', ticket.table_id, 'status', 'Manutenção concluída',
      'sourceModule', source_module, 'sourceId', source_id,
      'equipmentStatus', p_equipment_status, 'description', log_message),
    event_row.id),
    (source_module, 'update', jsonb_build_object('itemId', source_id,
      'status', p_equipment_status, 'controlItemId', ticket.id,
      'description', log_message), event_row.id);
  perform set_config('app.control_completion_skip_log_copy', '', true);
  perform set_config('app.control_completion_event', '', true);
  return jsonb_build_object('eventId', event_row.id, 'status', 'applied');
end; $$;

revoke all on function public.complete_control_maintenance(uuid, text, uuid, jsonb)
  from public, anon;
grant execute on function public.complete_control_maintenance(uuid, text, uuid, jsonb)
  to authenticated;

commit;
