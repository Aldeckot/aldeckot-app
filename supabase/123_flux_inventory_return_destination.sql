-- Regulariza retornos vinculados ao Inventário sem refazer a entrada física.
begin;

create or replace function public.preview_flux_return_destination(
  p_return_id uuid, p_location text, p_sector text
) returns jsonb language plpgsql stable security definer
  set search_path = public, app, pg_temp as $$
declare
  receipt public.flux_items%rowtype;
  shipment public.flux_items%rowtype;
  item public.inventory_items%rowtype;
  ticket public.control_items%rowtype;
  open_ids uuid[];
  monthly_table uuid;
  slot jsonb;
  completion jsonb;
  destination_status text;
  technical_action text := '';
  issue text := '';
  is_pdv boolean := coalesce(p_location, '') ~* '^PDV[[:space:]]+[0-9]+$';
  peripheral_type text;
begin
  if auth.uid() is null or p_location is null or p_location <> btrim(p_location)
    or char_length(p_location) not between 1 and 160
    or not exists (select 1 from public.organizational_sectors s
      where s.active and s.name = p_sector) then
    raise exception 'Informe um local válido e um setor do catálogo.';
  end if;
  select * into receipt from public.flux_items where id = p_return_id;
  if receipt.id is null or receipt.return_of is null or receipt.resolution_state is distinct from 'Pendente'
    or receipt.post_receipt_status is null then
    raise exception 'Este retorno não está pendente de regularização.';
  end if;
  if not coalesce(app.can_manage_module_table(receipt.table_id, 'flux', 'update'), false) then
    raise exception 'Sem permissão para regularizar este retorno.';
  end if;
  select * into shipment from public.flux_items where id = receipt.return_of;
  if receipt.inventory_item_id is null then
    raise exception 'Não há vínculo patrimonial confirmado. Confira a identidade no módulo de origem.';
  end if;
  select * into item from public.inventory_items where id = receipt.inventory_item_id;
  if item.id is null or not coalesce(app.can_manage_module_table(item.table_id, 'inventory', 'update'), false) then
    raise exception 'Equipamento indisponível no Inventário ou sem permissão de edição.';
  end if;

  peripheral_type := app.inventory_tag_peripheral_type(item.tag);
  destination_status := case when receipt.post_receipt_status = 'Verificação' then 'Reserva'
    else receipt.post_receipt_status end;
  slot := public.preview_local_regularization(item.id, p_location, p_sector, destination_status, 'return');
  if item.status = 'Inativo' then
    issue := 'Reative o equipamento no Inventário antes de regularizar o retorno.';
  elsif jsonb_array_length(slot->'linkedPositions') > 1
    or (peripheral_type is null and jsonb_array_length(slot->'linkedPositions') > 0) then
    issue := 'O equipamento tem vínculos divergentes na Gestão TI.';
  elsif is_pdv and (destination_status <> 'Ativo' or peripheral_type is null) then
    issue := 'Um PDV exige periférico identificado e condição Ativo.';
  elsif is_pdv and slot->>'blocked' = 'true'
    and slot->>'reason' <> 'Nenhuma mudança de Local foi identificada.' then
    issue := slot->>'reason';
  elsif is_pdv and jsonb_array_length(slot->'linkedPositions') = 1
    and app.inventory_installation_location_key(item.location) = app.inventory_installation_location_key(p_location)
    and slot->'linkedPositions'->0->>'positionId' is distinct from slot->'target'->>'positionId' then
    issue := 'O vínculo do periférico não corresponde ao PDV registrado no Inventário.';
  elsif not is_pdv and destination_status = 'Ativo' and peripheral_type is not null then
    issue := 'Escolha o PDV de instalação para ativar o periférico.';
  elsif destination_status = 'Ativo' and app.inventory_location_is_unassigned(p_location) then
    issue := 'Escolha um local de instalação real para a condição Ativo.';
  elsif destination_status <> 'Ativo' and exists (
    select 1 from public.module_records r join public.module_tables t on t.id = r.table_id
    where t.module = 'management' and (
      app.inventory_installation_location_key(r.payload->>'terminal') = app.inventory_installation_location_key(p_location)
      or app.inventory_installation_location_key(r.payload->>'equipment') = app.inventory_installation_location_key(p_location))
  ) then
    issue := 'Escolha um local de guarda ou atendimento fora das posições de instalação.';
  end if;

  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into open_ids
  from public.control_items c
  where (c.inventory_item_id = item.id or c.verification_inventory_item_id = item.id)
    and c.status in ('Aguardando avaliação', 'Em manutenção', 'Em sala');
  if cardinality(open_ids) = 1 then
    select * into ticket from public.control_items where id = open_ids[1];
  end if;
  if issue = '' then
    if cardinality(open_ids) > 1 then
      issue := 'Há mais de um acompanhamento aberto. Confira os chamados no Controle TI.';
    elsif ticket.id is not null then
      if receipt.post_receipt_status = 'Manutenção' and ticket.followup_kind = 'maintenance'
        and ticket.status = 'Em manutenção' and item.status = 'Manutenção' then
        technical_action := 'reuse';
      elsif receipt.post_receipt_status = 'Verificação' and item.situation = 'Verificando'
        and item.status = 'Reserva' and item.location = p_location and item.sector = p_sector
        and exists (select 1 from public.control_verification_requests v
          where v.inventory_item_id = item.id and v.control_item_id = ticket.id and v.completed_at is null) then
        technical_action := 'reuse';
      elsif receipt.post_receipt_status in ('Ativo', 'Reserva') and peripheral_type is not null
        and ticket.followup_kind = 'maintenance' and item.status = 'Manutenção'
        and ticket.status in ('Aguardando avaliação', 'Em manutenção') and item.situation <> 'Verificando'
        and shipment.reason = 'Manutenção'
        and exists (select 1 from public.equipment_sync_events e where e.source_module = 'flux'
          and e.source_id = shipment.id and e.event_type = 'maintenance' and e.equipment_id = item.id)
        and exists (select 1 from public.control_cases c where c.control_item_id = ticket.id
          and c.ticket_state not in ('Concluído', 'Cancelado') and c.opened_at >= shipment.created_at
          and c.opened_at <= receipt.received_at) then
        technical_action := 'complete';
      else
        issue := 'Há um chamado em aberto. Resolva o acompanhamento no Controle TI antes de aplicar este destino.';
      end if;
      if technical_action <> '' and
        not coalesce(app.can_manage_module_table(ticket.table_id, 'control', 'update'), false) then
        issue := 'Sem permissão para usar o chamado existente no Controle TI.';
      end if;
    elsif item.situation = 'Verificando' then
      issue := 'O Inventário indica uma verificação sem chamado aberto. Confira no Controle TI.';
    elsif receipt.post_receipt_status in ('Manutenção', 'Verificação') then
      select t.id into monthly_table from public.module_tables t
      where t.module = 'control' and t.name = app.current_control_maintenance_table_name()
      order by t.created_at desc, t.id desc limit 1;
      if monthly_table is null then
        issue := 'A tabela mensal do Controle TI precisa existir para iniciar este acompanhamento.';
      elsif not coalesce(app.can_manage_module_table(monthly_table, 'control', 'create'), false) then
        issue := 'Sem permissão para criar acompanhamento na tabela mensal do Controle TI.';
      elsif receipt.post_receipt_status = 'Manutenção' and exists (
        select 1 from public.control_items c
        where (c.inventory_item_id = item.id or
          (nullif(lower(btrim(item.tag)), '') not in ('-', '***')
            and lower(btrim(c.tag)) = lower(btrim(item.tag))) or
          (nullif(lower(btrim(item.serial)), '') not in ('-', '***')
            and lower(btrim(c.serial)) = lower(btrim(item.serial))))
      ) then
        issue := 'Já há histórico técnico para esta identidade. Abra a nova manutenção pelo Controle TI para preservar o chamado anterior.';
      else
        technical_action := case receipt.post_receipt_status when 'Verificação' then 'verify' else 'maintenance' end;
      end if;
    end if;
  end if;
  if technical_action = 'complete' and issue = '' then
    completion := public.preview_control_peripheral_completion(ticket.id,
      destination_status, p_location, p_sector);
    if completion->>'blocked' = 'true' then issue := completion->>'reason'; end if;
  end if;
  return jsonb_build_object(
    'token', md5(jsonb_build_array(receipt.id, receipt.updated_at, receipt.post_receipt_status,
      item.id, item.updated_at, p_location, p_sector, slot->>'token', open_ids,
      ticket.updated_at, monthly_table, technical_action, completion->>'token', issue)::text),
    'blocked', issue <> '', 'reason', issue, 'technicalAction', technical_action,
    'controlItemId', ticket.id, 'completionToken', completion->>'token', 'item', slot->'item',
    'occupants', slot->'occupants', 'managementOccupants', slot->'managementOccupants',
    'target', jsonb_build_object('location', p_location, 'sector', p_sector,
      'positionId', slot->'target'->>'positionId', 'status',
      destination_status, 'situation', case when receipt.post_receipt_status = 'Verificação'
        then 'Verificando' else item.situation end));
end;
$$;

create or replace function public.confirm_flux_return_destination(
  p_return_id uuid, p_location text, p_sector text, p_reason text,
  p_review_token text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  receipt public.flux_items%rowtype;
  item public.inventory_items%rowtype;
  prior public.equipment_events%rowtype;
  review jsonb;
  technical jsonb;
  control_event_id uuid;
  linked_event_id uuid;
  control_item_id uuid;
  destination_status text;
  technical_action text;
  request_hash text;
  reason_text text := btrim(coalesce(p_reason, ''));
  event_message text;
begin
  if auth.uid() is null or p_request_id is null or nullif(p_review_token, '') is null
    or char_length(reason_text) not between 5 and 500 then
    raise exception 'Confira o destino e informe um motivo (5 a 500 caracteres).';
  end if;
  perform pg_advisory_xact_lock(89123, hashtext(p_request_id::text));
  select * into receipt from public.flux_items where id = p_return_id for update;
  if receipt.id is null or not coalesce(app.can_manage_module_table(receipt.table_id, 'flux', 'update'), false) then
    raise exception 'Retorno indisponível ou sem permissão de edição.';
  end if;
  request_hash := md5(jsonb_build_array(p_return_id, p_location, p_sector, reason_text, p_review_token)::text);
  select * into prior from public.equipment_events e
    where e.source_module = 'inventory' and e.metadata->>'returnDestinationRequestId' = p_request_id::text;
  if found then
    if prior.actor_id is distinct from auth.uid()
      or prior.metadata->>'returnDestinationHash' is distinct from request_hash then
      raise exception 'Identificador de regularização já utilizado com outros dados.';
    end if;
    return jsonb_build_object('eventId', prior.id, 'alreadyApplied', true);
  end if;

  lock table public.inventory_items, public.module_records, public.control_items in share row exclusive mode;
  review := public.preview_flux_return_destination(p_return_id, p_location, p_sector);
  if review->>'token' is distinct from p_review_token then
    raise exception 'O retorno, equipamento, PDV ou chamado mudou. Confira novamente.';
  end if;
  if review->>'blocked' = 'true' then raise exception '%', review->>'reason'; end if;
  select * into item from public.inventory_items where id = receipt.inventory_item_id for update;
  destination_status := review->'target'->>'status';
  technical_action := review->>'technicalAction';
  control_item_id := (review->>'controlItemId')::uuid;

  if technical_action = 'complete' then
    technical := public.complete_control_peripheral_with_destination(control_item_id,
      destination_status, p_location, p_sector, reason_text, review->>'completionToken', p_request_id);
    control_event_id := (technical->>'eventId')::uuid;
    linked_event_id := (technical->>'movementEventId')::uuid;
  elsif item.status is distinct from destination_status or item.location is distinct from p_location
    or item.sector is distinct from p_sector or review->'target'->>'positionId' is not null then
    perform set_config('app.inventory_pdv_movement_id', p_request_id::text, true);
    perform set_config('app.inventory_pdv_movement_reason', reason_text, true);
    update public.inventory_items set location = p_location, sector = p_sector, status = destination_status
      where id = item.id;
    perform set_config('app.inventory_pdv_movement_id', '', true);
    perform set_config('app.inventory_pdv_movement_reason', '', true);
    if exists (select 1 from public.equipment_events where id = p_request_id) then
      linked_event_id := p_request_id;
    end if;
  end if;
  if technical_action = 'verify' then
    technical := public.start_inventory_verification(item.id, reason_text, p_request_id,
      (select updated_at from public.inventory_items where id = item.id));
    control_event_id := (technical->>'eventId')::uuid;
    select v.control_item_id into control_item_id from public.control_verification_requests v
      where v.request_id = p_request_id;
  elsif technical_action = 'maintenance' then
    if item.status = 'Manutenção' then perform app.sync_inventory_maintenance_to_control(item.id); end if;
    select c.id into control_item_id from public.control_items c
      where c.inventory_item_id = item.id and c.status = 'Em manutenção';
    if control_item_id is null then raise exception 'O acompanhamento técnico não foi criado.'; end if;
  end if;
  if not exists (select 1 from public.inventory_items i where i.id = item.id
      and i.status = destination_status and i.location = p_location and i.sector = p_sector) then
    raise exception 'O Inventário não confirmou o destino. A regularização foi revertida.';
  end if;
  if review->'target'->>'positionId' is not null and not exists (
    select 1 from public.module_records r
    cross join lateral jsonb_array_elements(coalesce(r.payload->'peripherals', '[]'::jsonb)) p(value)
    where r.id = (review->'target'->>'positionId')::uuid and p.value->>'sourceItemId' = item.id::text
  ) then
    raise exception 'A Gestão TI não confirmou o vínculo do PDV. A regularização foi revertida.';
  end if;

  if linked_event_id is null then
    insert into public.equipment_events (source_module, source_event_key, source_id,
      inventory_item_id, action, previous_status, new_status, previous_location, new_location,
      reason, affected_modules, processing_result, metadata, actor_id)
    values ('inventory', 'flux-return-destination:' || p_request_id::text, item.id, item.id,
      'Regularização após retorno', item.status, destination_status, item.location, p_location,
      reason_text, jsonb_build_array('inventory', 'flux'), '{"status":"applied"}'::jsonb, '{}'::jsonb, auth.uid())
    returning id into linked_event_id;
    insert into public.inventory_item_logs(inventory_item_id, action, message, event_id)
      values (item.id, 'update', left(format('Destino após retorno: %s / %s → %s / %s. %s',
        item.location, item.status, p_location, destination_status, reason_text), 500), linked_event_id);
  end if;
  update public.equipment_events set action = 'Regularização após retorno',
    previous_status = item.status, new_status = destination_status,
    affected_modules = (case when affected_modules ? 'flux' then affected_modules
      else affected_modules || jsonb_build_array('flux') end)
      || case when control_item_id is not null and not (affected_modules ? 'control')
        then jsonb_build_array('control') else '[]'::jsonb end,
    metadata = metadata || jsonb_build_object('fluxReturnId', receipt.id, 'fluxSendId', receipt.return_of,
      'returnDestinationRequestId', p_request_id, 'returnDestinationHash', request_hash,
      'previousSector', item.sector, 'targetSector', p_sector,
      'controlItemId', control_item_id, 'controlEventId', control_event_id)
    where id = linked_event_id;

  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
    values (linked_event_id, 'inventory', 'applied', 1, now()), (linked_event_id, 'flux', 'applied', 1, now())
    on conflict (event_id, module) do nothing;
  update public.flux_items set resolution_state = 'Aplicada', location = p_location, sector = p_sector
    where id = receipt.id;
  event_message := left(format('Regularização após retorno: %s / %s → %s / %s. %s',
    item.location, item.status, p_location, destination_status, reason_text), 500);
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
    values (receipt.id, 'update', event_message, linked_event_id);
  return jsonb_build_object('eventId', linked_event_id, 'alreadyApplied', false, 'controlItemId', control_item_id);
end;
$$;

revoke all on function public.preview_flux_return_destination(uuid,text,text) from public, anon;
grant execute on function public.preview_flux_return_destination(uuid,text,text) to authenticated;
revoke all on function public.confirm_flux_return_destination(uuid,text,text,text,text,uuid) from public, anon;
grant execute on function public.confirm_flux_return_destination(uuid,text,text,text,text,uuid) to authenticated;

commit;
