-- ALDECKOT | Movimentacoes transacionais de PCs, sem trocar perifericos.
-- RASCUNHO EM TESTE: NAO APLICAR NA BASE PRINCIPAL.
-- A RPC abaixo precisa passar por testes de integracao com os gatilhos reais.
-- A RPC legada management_transfer_terminal(uuid, uuid) permanece bloqueada.
begin;

do $$
begin
  if not exists (select 1 from pg_attribute
    where attrelid = 'public.module_records'::regclass
      and attname = 'management_computer_id' and not attisdropped)
    or not exists (select 1 from pg_trigger
      where tgrelid = 'public.module_records'::regclass
        and tgname = 'management_computer_identity_guard' and tgenabled <> 'D')
    or not exists (select 1 from pg_trigger
      where tgrelid = 'public.module_records'::regclass
        and tgname = 'management_pdv_peripheral_location_guard' and tgenabled <> 'D')
    or to_regclass('public.equipment_events') is null then
    raise exception 'As protecoes das migracoes 063, 086 e 087 devem estar ativas.';
  end if;
end;
$$;

create index if not exists equipment_events_management_metadata_idx
  on public.equipment_events using gin (metadata jsonb_path_ops)
  where source_module = 'management';

-- A edicao comum na Gestao TI nao pode liberar um PC com chamado aberto.
-- A conclusao transacional da 073 e a unica excecao: seu evento deve ser
-- deste chamado, deste PC e da transacao atual, antes de fechar o chamado.
create or replace function app.guard_management_open_control_activation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.module_tables t
    where t.id = new.table_id and t.module = 'management')
    or lower(btrim(coalesce(new.payload ->> 'status', ''))) not in ('ativo', 'reserva')
    or lower(btrim(coalesce(old.payload ->> 'status', '')))
      = lower(btrim(coalesce(new.payload ->> 'status', ''))) then
    return new;
  end if;

  if exists (select 1 from public.control_items c
    where c.management_record_id = new.id
      and c.status in ('Em manutenção', 'Aguardando avaliação', 'Em sala')
      and not exists (select 1 from public.equipment_events e
        where e.id::text = coalesce(current_setting('app.control_completion_event', true), '')
          and e.source_module = 'control'
          and e.source_id = c.id
          and e.action = 'Manutenção concluída'
          and e.new_status = new.payload ->> 'status'
          and e.metadata ->> 'controlItemId' = c.id::text
          and e.metadata ->> 'sourceModule' = 'management'
          and e.metadata ->> 'sourceId' = new.id::text
          and e.created_at = timezone('utc', transaction_timestamp())::timestamptz)) then
    raise exception 'Conclua o chamado aberto no Controle TI antes de ativar ou reservar este computador.';
  end if;
  return new;
end;
$$;

drop trigger if exists management_open_control_activation_guard on public.module_records;
create trigger management_open_control_activation_guard
  before update of table_id, payload on public.module_records
  for each row execute function app.guard_management_open_control_activation();

-- A 073 usa source_module/source_id como variaveis e nomes de colunas.
-- Recriar a mesma funcao com diretiva local resolve a ambiguidade sem exigir
-- permissao de superusuario nem alterar a logica de conclusao.
create or replace function public.complete_control_maintenance(
  p_control_item_id uuid,
  p_equipment_status text,
  p_request_id uuid,
  p_control_fields jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
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

-- Durante a transacao de movimentacao, a rotina coordenadora registra o
-- evento e cria o chamado uma unica vez apos todos os vinculos serem movidos.
create or replace function app.sync_control_from_management()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.management_movement_in_progress', true) = 'on' then
    return new;
  end if;
  if exists (select 1 from public.module_tables t
    where t.id = new.table_id and t.module = 'management') then
    perform app.sync_management_record_to_control(new.id, new.payload);
  end if;
  return new;
end;
$$;

create or replace function app.record_module_record_activity()
returns trigger language plpgsql security invoker set search_path = public as $$
declare source_module text; source_table_name text; source_action text; source_payload jsonb;
begin
  if current_setting('app.management_movement_in_progress', true) = 'on' then
    return new;
  end if;
  select module, name into source_module, source_table_name
  from public.module_tables where id = new.table_id;
  if source_module <> 'management' then return new; end if;
  source_payload := coalesce(new.payload, '{}'::jsonb);
  source_action := case when tg_op = 'INSERT' then 'create' else 'update' end;
  insert into public.sync_events (module, operation, details)
  values ('management', source_action, jsonb_build_object(
    'itemId', new.id, 'tableId', new.table_id,
    'tableName', coalesce(source_table_name, 'Infraestrutura ALDECKOT'),
    'equipment', coalesce(source_payload ->> 'equipment', source_payload ->> 'name', 'Equipamento'),
    'brand', coalesce(source_payload ->> 'brand', ''),
    'serial', coalesce(source_payload ->> 'serial', source_payload ->> 'numeroSerie', ''),
    'tag', coalesce(source_payload ->> 'tag', ''),
    'status', coalesce(source_payload ->> 'status', 'Ativo'),
    'description', coalesce(nullif(source_payload ->> 'lastActivity', ''),
      case when tg_op = 'INSERT' then 'Equipamento cadastrado na Gestão TI.'
        else 'Equipamento atualizado na Gestão TI.' end),
    'targetUrl', format('management.html?item=%s', new.id)
  ));
  return new;
end;
$$;

-- Os campos do terminal e os perifericos ficam na posicao; os demais campos
-- acompanham a identidade estavel do computador.
create or replace function app.management_movement_position_payload(p_payload jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'terminal', coalesce(p_payload ->> 'terminal', ''),
    'area', coalesce(p_payload ->> 'area', ''),
    'sector', coalesce(p_payload ->> 'sector', ''),
    'isFixed', coalesce(p_payload -> 'isFixed', 'false'::jsonb),
    'peripherals', coalesce(p_payload -> 'peripherals', '[]'::jsonb),
    'logs', coalesce(p_payload -> 'logs', '[]'::jsonb),
    'lastActivity', coalesce(p_payload ->> 'lastActivity', '')
  );
$$;

create or replace function app.management_movement_computer_payload(p_payload jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select p_payload - array[
    'terminal', 'area', 'sector', 'isFixed', 'peripherals', 'logs', 'lastActivity'
  ];
$$;

create or replace function app.management_movement_log(
  p_position jsonb, p_event_id uuid, p_message text
) returns jsonb language sql volatile set search_path = public as $$
  select jsonb_set(
    p_position || jsonb_build_object('lastActivity', p_message),
    '{logs}', coalesce(p_position -> 'logs', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid()::text,
        'at', timezone('utc', now()), 'text', p_message,
        'eventId', p_event_id::text, 'sourceModule', 'management')
    ), true
  );
$$;

create or replace function public.management_move_computer(
  p_operation_id uuid, p_plan jsonb
) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  mode_name text := p_plan ->> 'mode';
  source_id uuid := nullif(p_plan ->> 'sourceId', '')::uuid;
  target_id uuid := nullif(p_plan ->> 'targetId', '')::uuid;
  outgoing_id uuid := nullif(p_plan ->> 'outgoingDestinationId', '')::uuid;
  incoming_id uuid := nullif(p_plan ->> 'incomingComputerId', '')::uuid;
  outgoing_computer_id uuid := nullif(p_plan ->> 'outgoingComputerId', '')::uuid;
  source_version timestamptz := nullif(p_plan ->> 'sourceUpdatedAt', '')::timestamptz;
  target_version timestamptz := nullif(p_plan ->> 'targetUpdatedAt', '')::timestamptz;
  outgoing_version timestamptz := nullif(p_plan ->> 'outgoingDestinationUpdatedAt', '')::timestamptz;
  target_unassigned boolean := coalesce((p_plan ->> 'targetUnassigned')::boolean, false);
  outgoing_unassigned boolean := coalesce((p_plan ->> 'outgoingUnassigned')::boolean, false);
  incoming_status text := btrim(coalesce(p_plan ->> 'incomingStatus', ''));
  incoming_location text := btrim(coalesce(p_plan ->> 'incomingLocation', ''));
  outgoing_status text := btrim(coalesce(p_plan ->> 'outgoingStatus', ''));
  outgoing_location text := btrim(coalesce(p_plan ->> 'outgoingLocation', ''));
  reason_text text := btrim(coalesce(p_plan ->> 'reason', ''));
  source_row public.module_records%rowtype;
  target_row public.module_records%rowtype;
  outgoing_row public.module_records%rowtype;
  locked_row record;
  previous_event public.equipment_events%rowtype;
  incoming_before jsonb;
  outgoing_before jsonb;
  incoming_after jsonb;
  outgoing_after jsonb;
  source_next jsonb;
  target_next jsonb;
  outgoing_next jsonb;
  incoming_tickets uuid[] := array[]::uuid[];
  outgoing_tickets uuid[] := array[]::uuid[];
  legacy_source_tickets uuid[] := array[]::uuid[];
  control_id uuid;
  result_data jsonb;
  event_metadata jsonb;
  source_terminal text;
  target_terminal text;
  outgoing_terminal text;
  needs_outgoing boolean;
begin
  if not app.is_admin() then
    raise exception 'Somente administradores podem movimentar computadores.';
  end if;
  if p_operation_id is null or jsonb_typeof(p_plan) <> 'object' then
    raise exception 'Informe uma operacao identificada e um plano valido.';
  end if;
  perform pg_advisory_xact_lock(89188, hashtext(p_operation_id::text));
  select * into previous_event from public.equipment_events
  where source_module = 'management' and source_event_key = p_operation_id::text;
  if found then
    if previous_event.metadata -> 'request' is distinct from p_plan then
      raise exception 'ID de operacao reutilizado com um plano diferente.';
    end if;
    return previous_event.processing_result;
  end if;
  if mode_name is null or mode_name not in ('replace-other', 'be-replaced', 'direct')
    or source_id is null or incoming_id is null
    or coalesce((p_plan ->> 'confirmedLocations')::boolean, false) is not true
    or reason_text = '' then
    raise exception 'Modalidade, computador, motivo e confirmacao de locais sao obrigatorios.';
  end if;
  if (target_id is null) is not distinct from (not target_unassigned)
    or (target_id is not null and target_id = source_id) then
    raise exception 'Selecione exatamente um destino, diferente da origem.';
  end if;
  if incoming_status not in ('Ativo', 'Reserva', 'Defeito', 'Manutenção', 'Inativo')
    or incoming_location = '' then
    raise exception 'Status e local final do computador de entrada sao obrigatorios.';
  end if;

  -- Ordem fixa para impedir impasse em operacoes simultaneas.
  for locked_row in
    select r.id from public.module_records r
    where r.id = any(array[source_id, target_id, outgoing_id])
    order by r.id for update
  loop null; end loop;
  select r.* into source_row from public.module_records r
  join public.module_tables t on t.id = r.table_id
  where r.id = source_id and t.module = 'management';
  if not found then raise exception 'Origem nao encontrada na Gestao TI.'; end if;
  if source_version is null or source_row.updated_at is distinct from source_version
    or source_row.management_computer_id is distinct from incoming_id then
    raise exception 'Conflito: o computador de origem mudou. Reabra a movimentacao.';
  end if;
  if target_id is not null then
    select r.* into target_row from public.module_records r
    where r.id = target_id and r.table_id = source_row.table_id;
    if not found or target_version is null or target_row.updated_at is distinct from target_version then
      raise exception 'Conflito: o destino mudou. Reabra a movimentacao.';
    end if;
    if lower(btrim(coalesce(source_row.payload ->> 'area', ''))) is distinct from
        lower(btrim(coalesce(target_row.payload ->> 'area', '')))
      and not (lower(btrim(coalesce(source_row.payload ->> 'area', ''))) in ('escritório', 'estoque')
        and lower(btrim(coalesce(target_row.payload ->> 'area', ''))) in ('escritório', 'estoque')) then
      raise exception 'Movimentacao entre estes setores nao e permitida pela Gestao TI.';
    end if;
  end if;
  needs_outgoing := target_id is not null and target_row.management_computer_id is not null;
  if mode_name = 'direct' and needs_outgoing then
    raise exception 'Destino ocupado. Use o fluxo de substituicao.';
  end if;
  if mode_name <> 'direct' and not needs_outgoing then
    raise exception 'Substituicao exige um computador no destino.';
  end if;
  if needs_outgoing then
    if outgoing_computer_id is null
      or outgoing_computer_id is distinct from target_row.management_computer_id
      or outgoing_status not in ('Ativo', 'Reserva', 'Defeito', 'Manutenção', 'Inativo')
      or outgoing_location = ''
      or (outgoing_id is null and not outgoing_unassigned)
      or (outgoing_id is not null and outgoing_unassigned)
      or outgoing_id = target_id then
      raise exception 'Computador retirado exige identidade, status e destino fisico confirmados.';
    end if;
    if outgoing_id is not null and outgoing_id <> source_id then
      select r.* into outgoing_row from public.module_records r
      where r.id = outgoing_id and r.table_id = source_row.table_id;
      if not found or outgoing_version is null
        or outgoing_row.updated_at is distinct from outgoing_version
        or outgoing_row.management_computer_id is not null then
        raise exception 'Conflito: destino do computador retirado mudou ou esta ocupado.';
      end if;
      if lower(btrim(coalesce(target_row.payload ->> 'area', ''))) is distinct from
          lower(btrim(coalesce(outgoing_row.payload ->> 'area', '')))
        and not (lower(btrim(coalesce(target_row.payload ->> 'area', ''))) in ('escritório', 'estoque')
          and lower(btrim(coalesce(outgoing_row.payload ->> 'area', ''))) in ('escritório', 'estoque')) then
        raise exception 'Destino do computador retirado pertence a outro setor nao permitido.';
      end if;
    elsif outgoing_id = source_id then
      outgoing_row := source_row;
    end if;
  elsif outgoing_id is not null or outgoing_unassigned or outgoing_computer_id is not null then
    raise exception 'Transferencia direta nao pode retirar um segundo computador.';
  end if;
  if jsonb_typeof(source_row.payload -> 'logs') is distinct from 'array'
    or (target_id is not null and jsonb_typeof(target_row.payload -> 'logs') is distinct from 'array')
    or (outgoing_id is not null and outgoing_id <> source_id
      and jsonb_typeof(outgoing_row.payload -> 'logs') is distinct from 'array') then
    raise exception 'Historico da posicao invalido; nenhuma movimentacao efetuada.';
  end if;
  source_terminal := btrim(coalesce(source_row.payload ->> 'terminal', ''));
  target_terminal := btrim(coalesce(target_row.payload ->> 'terminal', ''));
  outgoing_terminal := btrim(coalesce(outgoing_row.payload ->> 'terminal', ''));
  if target_terminal ~* '^PDV[[:space:]]+[0-9]+$'
    and lower(incoming_location) <> lower(target_terminal) then
    raise exception 'O local confirmado deve corresponder ao PDV de destino.';
  end if;
  if needs_outgoing and outgoing_terminal ~* '^PDV[[:space:]]+[0-9]+$'
    and lower(outgoing_location) <> lower(outgoing_terminal) then
    raise exception 'O local do computador retirado deve corresponder ao PDV escolhido.';
  end if;

  -- Um chamado sem TAG/serie nao prova a identidade historica. Nunca o
  -- atribua automaticamente ao proximo ocupante dessa posicao.
  if target_id is not null and exists (select 1 from public.control_items c
    where c.management_record_id = target_id
      and not app.management_identity_matches(target_row.payload, c.tag, c.serial)) then
    raise exception 'O destino possui chamado historico sem identidade comprovada.';
  end if;
  if needs_outgoing and outgoing_id is not null and exists (
    select 1 from public.control_items c where c.management_record_id = outgoing_id
      and (outgoing_id <> source_id
        or not app.management_identity_matches(source_row.payload, c.tag, c.serial))
  ) then
    raise exception 'O destino do computador retirado possui chamado historico ou outro vinculo.';
  end if;
  if exists (select 1 from public.control_items c
    where c.management_record_id = source_id
      and (nullif(btrim(c.tag), '') is not null or nullif(btrim(c.serial), '') is not null)
      and not app.management_identity_matches(source_row.payload, c.tag, c.serial))
    or (needs_outgoing and exists (select 1 from public.control_items c
      where c.management_record_id = target_id
        and not app.management_identity_matches(target_row.payload, c.tag, c.serial))) then
    raise exception 'Chamado vinculado nao corresponde ao computador atual.';
  end if;
  select coalesce(array_agg(c.id order by c.id), array[]::uuid[])
  into incoming_tickets from public.control_items c
  where c.management_record_id = source_id
    and app.management_identity_matches(source_row.payload, c.tag, c.serial);
  if needs_outgoing then
    select coalesce(array_agg(c.id order by c.id), array[]::uuid[])
    into outgoing_tickets from public.control_items c
    where c.management_record_id = target_id
      and app.management_identity_matches(target_row.payload, c.tag, c.serial);
  end if;
  if cardinality(incoming_tickets) > 1 or cardinality(outgoing_tickets) > 1 then
    raise exception 'Mais de um chamado identificado para uma mesma posicao; revise os vinculos.';
  end if;
  -- Um PC nao pode voltar a Ativo/Reserva enquanto o Controle TI ainda
  -- acompanha o defeito. A conclusao do chamado pertence ao Controle TI.
  if incoming_status not in ('Defeito', 'Manutenção') and exists (
    select 1 from public.control_items c
    where c.id = any(incoming_tickets)
      and c.status in ('Em manutenção', 'Aguardando avaliação', 'Em sala')
  ) then
    raise exception 'Conclua o chamado aberto no Controle TI antes de ativar ou reservar este computador.';
  end if;
  if needs_outgoing and outgoing_status not in ('Defeito', 'Manutenção') and exists (
    select 1 from public.control_items c
    where c.id = any(outgoing_tickets)
      and c.status in ('Em manutenção', 'Aguardando avaliação', 'Em sala')
  ) then
    raise exception 'Conclua o chamado aberto no Controle TI antes de ativar ou reservar o computador retirado.';
  end if;
  -- O sincronizador legado procura chamados por TAG OU serie. Recusar uma
  -- colisao com item de Inventario/Suprimentos antes que ele possa ser ligado
  -- a um PC, mesmo que a base esteja livre dessa colisao no preflight atual.
  if incoming_status in ('Defeito', 'Manutenção') and exists (
    select 1 from public.control_items c
    where (c.inventory_item_id is not null or c.supply_unit_id is not null)
      and ((nullif(lower(btrim(coalesce(source_row.payload ->> 'tag', ''))), '') is not null
          and lower(btrim(coalesce(c.tag, ''))) = lower(btrim(source_row.payload ->> 'tag')))
        or (nullif(lower(btrim(coalesce(source_row.payload ->> 'serial',
            source_row.payload ->> 'numeroSerie', ''))), '') is not null
          and lower(btrim(coalesce(c.serial, ''))) = lower(btrim(coalesce(
            source_row.payload ->> 'serial', source_row.payload ->> 'numeroSerie', '')))))
  ) then
    raise exception 'TAG ou serie do computador coincide com chamado de outro modulo; revise a identidade.';
  end if;
  if needs_outgoing and outgoing_status in ('Defeito', 'Manutenção') and exists (
    select 1 from public.control_items c
    where (c.inventory_item_id is not null or c.supply_unit_id is not null)
      and ((nullif(lower(btrim(coalesce(target_row.payload ->> 'tag', ''))), '') is not null
          and lower(btrim(coalesce(c.tag, ''))) = lower(btrim(target_row.payload ->> 'tag')))
        or (nullif(lower(btrim(coalesce(target_row.payload ->> 'serial',
            target_row.payload ->> 'numeroSerie', ''))), '') is not null
          and lower(btrim(coalesce(c.serial, ''))) = lower(btrim(coalesce(
            target_row.payload ->> 'serial', target_row.payload ->> 'numeroSerie', '')))))
  ) then
    raise exception 'TAG ou serie do computador retirado coincide com chamado de outro modulo.';
  end if;
  select coalesce(array_agg(c.id order by c.id), array[]::uuid[])
  into legacy_source_tickets from public.control_items c
  where c.management_record_id = source_id
    and not app.management_identity_matches(source_row.payload, c.tag, c.serial);
  perform 1 from public.control_items c
  where c.id = any(incoming_tickets || outgoing_tickets)
  order by c.id for update;

  incoming_before := app.management_movement_computer_payload(source_row.payload);
  incoming_after := incoming_before || jsonb_build_object(
    'status', incoming_status, 'location', incoming_location);
  if needs_outgoing then
    outgoing_before := app.management_movement_computer_payload(target_row.payload);
    outgoing_after := outgoing_before || jsonb_build_object(
      'status', outgoing_status, 'location', outgoing_location);
  end if;
  perform set_config('app.management_movement_in_progress', 'on', true);
  if target_unassigned or outgoing_unassigned then
    perform pg_advisory_xact_lock(89189, hashtext(source_row.table_id::text));
  end if;
  if target_unassigned then
    insert into public.module_records(table_id, position, payload)
    select source_row.table_id, coalesce(max(position), 0) + 1,
      jsonb_build_object('terminal', '', 'area', coalesce(source_row.payload ->> 'area', ''),
        'sector', '', 'isFixed', false, 'peripherals', '[]'::jsonb, 'logs', '[]'::jsonb)
    from public.module_records where table_id = source_row.table_id
    returning * into target_row;
    target_id := target_row.id;
  end if;
  if needs_outgoing and outgoing_unassigned then
    insert into public.module_records(table_id, position, payload)
    select source_row.table_id, coalesce(max(position), 0) + 1,
      jsonb_build_object('terminal', '', 'area', coalesce(target_row.payload ->> 'area', ''),
        'sector', '', 'isFixed', false, 'peripherals', '[]'::jsonb, 'logs', '[]'::jsonb)
    from public.module_records where table_id = source_row.table_id
    returning * into outgoing_row;
    outgoing_id := outgoing_row.id;
  end if;
  -- A unicidade de management_computer_id da 087 e diferida ate o commit.
  update public.control_items set management_record_id = null
  where id = any(incoming_tickets || outgoing_tickets);
  source_next := app.management_movement_log(
    app.management_movement_position_payload(source_row.payload), p_operation_id,
    format('Movimentacao %s: %s saiu de %s. %s', p_operation_id,
      coalesce(source_row.payload ->> 'equipment', 'PC'), source_terminal, reason_text));
  if needs_outgoing and outgoing_id = source_id then
    source_next := source_next || outgoing_after;
  end if;
  update public.module_records set payload = source_next,
    management_computer_id = case when needs_outgoing and outgoing_id = source_id
      then outgoing_computer_id else null end
  where id = source_id;
  target_next := app.management_movement_log(
    app.management_movement_position_payload(target_row.payload), p_operation_id,
    format('Movimentacao %s: %s chegou a %s. %s', p_operation_id,
      coalesce(source_row.payload ->> 'equipment', 'PC'),
      coalesce(nullif(target_terminal, ''), incoming_location), reason_text)) || incoming_after;
  update public.module_records set payload = target_next,
    management_computer_id = incoming_id where id = target_id;
  if needs_outgoing and outgoing_id <> source_id then
    outgoing_next := app.management_movement_log(
      app.management_movement_position_payload(outgoing_row.payload), p_operation_id,
      format('Movimentacao %s: %s foi retirado para %s. %s', p_operation_id,
        coalesce(target_row.payload ->> 'equipment', 'PC'), outgoing_location, reason_text)) || outgoing_after;
    update public.module_records set payload = outgoing_next,
      management_computer_id = outgoing_computer_id where id = outgoing_id;
  end if;
  update public.control_items set management_record_id = target_id
  where id = any(incoming_tickets);
  if needs_outgoing then
    update public.control_items set management_record_id = outgoing_id
    where id = any(outgoing_tickets);
  end if;

  result_data := jsonb_build_object(
    'eventId', p_operation_id, 'mode', mode_name,
    'incomingComputerId', incoming_id, 'incomingSourceId', source_id,
    'incomingDestinationId', target_id, 'incomingStatus', incoming_status,
    'incomingLocation', incoming_location,
    'outgoingComputerId', outgoing_computer_id,
    'outgoingDestinationId', outgoing_id,
    'outgoingStatus', case when needs_outgoing then outgoing_status else null end,
    'outgoingLocation', case when needs_outgoing then outgoing_location else null end);
  event_metadata := jsonb_build_object(
    'request', p_plan, 'computerIds', case when needs_outgoing
      then jsonb_build_array(incoming_id, outgoing_computer_id)
      else jsonb_build_array(incoming_id) end,
    'positionIds', case when needs_outgoing
      then jsonb_build_array(source_id, target_id, outgoing_id)
      else jsonb_build_array(source_id, target_id) end,
    'incoming', jsonb_build_object('id', incoming_id, 'from', source_id,
      'to', target_id, 'before', jsonb_build_object('status', incoming_before ->> 'status',
        'location', incoming_before ->> 'location'),
      'after', jsonb_build_object('status', incoming_status, 'location', incoming_location)),
    'outgoing', case when needs_outgoing then jsonb_build_object(
      'id', outgoing_computer_id, 'from', target_id, 'to', outgoing_id,
      'before', jsonb_build_object('status', outgoing_before ->> 'status',
        'location', outgoing_before ->> 'location'),
      'after', jsonb_build_object('status', outgoing_status,
        'location', outgoing_location)) else 'null'::jsonb end,
    'unverifiableHistoricalTicketIds', to_jsonb(legacy_source_tickets));
  insert into public.equipment_events (
    id, source_module, source_event_key, source_id, action,
    previous_status, new_status, previous_location, new_location,
    previous_assignment, new_assignment, origin_location,
    destination_location, reason, affected_modules,
    processing_result, metadata, actor_id
  ) values (
    p_operation_id, 'management', p_operation_id::text, source_id,
    case when needs_outgoing then 'computer_replacement' else 'computer_transfer' end,
    incoming_before ->> 'status', incoming_status,
    incoming_before ->> 'location', incoming_location,
    source_terminal, coalesce(nullif(target_terminal, ''), incoming_location),
    incoming_before ->> 'location', incoming_location, reason_text,
    '["management","control"]'::jsonb, result_data, event_metadata, auth.uid()
  );
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at, metadata)
  values (p_operation_id, 'management', 'applied', 1, now(),
    jsonb_build_object('computerIds', event_metadata -> 'computerIds'));
  if incoming_status in ('Defeito', 'Manutenção') then
    perform app.sync_management_record_to_control(target_id, target_next);
    select c.id into control_id from public.control_items c
    where c.management_record_id = target_id and c.status = 'Em manutenção'
      and app.management_identity_matches(target_next, c.tag, c.serial)
    limit 1;
    if control_id is null then
      raise exception 'Chamado do computador de entrada nao foi confirmado; movimentacao cancelada.';
    end if;
    insert into public.control_item_logs(control_item_id, action, message, event_id)
    values (control_id, 'update', left(format(
      'Movimentacao %s: %s. Status %s; local %s.',
      p_operation_id, reason_text, incoming_status, incoming_location), 500), p_operation_id);
  end if;
  if needs_outgoing and outgoing_status in ('Defeito', 'Manutenção') then
    perform app.sync_management_record_to_control(outgoing_id,
      case when outgoing_id = source_id then source_next else outgoing_next end);
    select c.id into control_id from public.control_items c
    where c.management_record_id = outgoing_id and c.status = 'Em manutenção'
      and app.management_identity_matches(outgoing_after, c.tag, c.serial)
    limit 1;
    if control_id is null then
      raise exception 'Chamado do computador retirado nao foi confirmado; movimentacao cancelada.';
    end if;
    insert into public.control_item_logs(control_item_id, action, message, event_id)
    values (control_id, 'update', left(format(
      'Movimentacao %s: %s. Status %s; local %s.',
      p_operation_id, reason_text, outgoing_status, outgoing_location), 500), p_operation_id);
  end if;
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at, metadata)
  values (p_operation_id, 'control',
    case when incoming_status in ('Defeito', 'Manutenção')
      or (needs_outgoing and outgoing_status in ('Defeito', 'Manutenção'))
      or cardinality(incoming_tickets) > 0 or cardinality(outgoing_tickets) > 0
      then 'applied' else 'skipped' end,
    case when incoming_status in ('Defeito', 'Manutenção')
      or (needs_outgoing and outgoing_status in ('Defeito', 'Manutenção'))
      or cardinality(incoming_tickets) > 0 or cardinality(outgoing_tickets) > 0
      then 1 else 0 end,
    now(), jsonb_build_object('reason', 'Ticket identity and status checked in transaction'));
  insert into public.sync_events(module, operation, details, event_id)
  values ('management', 'update', jsonb_build_object(
    'itemId', target_id, 'tableId', source_row.table_id,
    'equipment', incoming_after ->> 'equipment', 'tag', incoming_after ->> 'tag',
    'status', incoming_status,
    'description', format('Movimentacao %s: %s', p_operation_id, reason_text),
    'computerIds', event_metadata -> 'computerIds',
    'positionIds', event_metadata -> 'positionIds',
    'targetUrl', format('management.html?item=%s', target_id)), p_operation_id);
  perform set_config('app.management_movement_in_progress', 'off', true);
  return result_data;
end;
$$;

revoke all on function public.management_move_computer(uuid, jsonb) from public;
grant execute on function public.management_move_computer(uuid, jsonb) to authenticated;

create or replace function public.management_movement_history(
  p_computer_id uuid default null, p_position_id uuid default null
) returns table (
  event_id uuid, occurred_at timestamptz, action text, reason text,
  metadata jsonb, processing_result jsonb
) language sql stable security invoker set search_path = public as $$
  select e.id, e.created_at, e.action, e.reason, e.metadata, e.processing_result
  from public.equipment_events e
  where e.source_module = 'management'
    and ((p_computer_id is not null
      and e.metadata -> 'computerIds' @> jsonb_build_array(p_computer_id))
      or (p_position_id is not null
      and e.metadata -> 'positionIds' @> jsonb_build_array(p_position_id)))
  order by e.created_at desc, e.id desc limit 100;
$$;

revoke all on function public.management_movement_history(uuid, uuid) from public;
grant execute on function public.management_movement_history(uuid, uuid) to authenticated;

commit;
