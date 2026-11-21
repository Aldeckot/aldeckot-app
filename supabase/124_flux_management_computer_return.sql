-- Captura a identidade do computador no envio. Não infere vínculo para envios históricos.
begin;

alter table public.flux_items add column management_computer_id uuid;

create function app.capture_flux_management_computer()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.source_module is not distinct from new.source_module
    and old.source_record_id is not distinct from new.source_record_id
    and old.return_of is not distinct from new.return_of then
    new.management_computer_id := old.management_computer_id;
    if old.management_computer_id is not null then new.equipment_uid := old.management_computer_id; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.management_computer_id is not null
    and (old.delivered_at is not null or old.return_of is not null) then
    raise exception 'A identidade do computador não pode mudar depois da entrega ou do retorno.';
  end if;
  new.management_computer_id := null;
  if new.inventory_item_id is not null then return new; end if;
  if new.return_of is not null or new.source_module = 'flux' then
    select f.management_computer_id into new.management_computer_id from public.flux_items f
      where f.id = coalesce(new.return_of, new.source_record_id);
  elsif new.source_module = 'management' then
    select r.management_computer_id into new.management_computer_id
    from public.module_records r join public.module_tables t on t.id = r.table_id
    where r.id = new.source_record_id and t.module = 'management';
    if new.management_computer_id is null then
      raise exception 'A origem da Gestão TI não possui um computador identificado.';
    end if;
  end if;
  if new.management_computer_id is not null then
    new.equipment_uid := new.management_computer_id;
  end if;
  return new;
end;
$$;

create trigger a_flux_capture_management_computer
  before insert or update of source_module, source_record_id, return_of, management_computer_id, equipment_uid
  on public.flux_items for each row execute function app.capture_flux_management_computer();
revoke all on function app.capture_flux_management_computer() from public, anon, authenticated;

create or replace function app.assign_flux_equipment_uid()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_uid uuid;
  matching_count integer;
begin
  if new.management_computer_id is not null then
    new.equipment_uid := new.management_computer_id;
    return new;
  end if;
  if new.return_of is not null then
    select equipment_uid into existing_uid from public.flux_items where id = new.return_of;
    if not found then raise exception 'Envio de origem não encontrado.'; end if;
    new.equipment_uid := coalesce(existing_uid, gen_random_uuid());
    return new;
  end if;
  if new.source_module is not null then
    if new.source_module = 'flux' then
      select equipment_uid into existing_uid from public.flux_items where id = new.source_record_id;
    else
      select count(distinct equipment_uid) into matching_count from public.flux_items
        where source_module = new.source_module and source_record_id = new.source_record_id
          and equipment_uid is not null;
      if matching_count > 1 then
        raise exception 'Identidade Flux ambígua para esta origem. Regularize antes de continuar.';
      end if;
      select equipment_uid into existing_uid from public.flux_items
        where source_module = new.source_module and source_record_id = new.source_record_id
          and equipment_uid is not null limit 1;
    end if;
    new.equipment_uid := coalesce(existing_uid, new.equipment_uid, gen_random_uuid());
    return new;
  end if;
  if new.movement = 'Envio' then
    if nullif(btrim(new.serial), '') is null then
      raise exception 'Número de série real é obrigatório para um equipamento novo.';
    end if;
    if exists (select 1 from public.inventory_items i where lower(btrim(i.serial)) = lower(btrim(new.serial))) or
       exists (select 1 from public.module_records r join public.module_tables t on t.id = r.table_id
         where t.module = 'management' and
           lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) = lower(btrim(new.serial))) or
       exists (select 1 from public.flux_items f where lower(btrim(f.serial)) = lower(btrim(new.serial))) then
      raise exception 'Esta série já consta no sistema. Selecione o equipamento existente ou regularize a identidade.';
    end if;
  end if;
  new.equipment_uid := coalesce(new.equipment_uid, gen_random_uuid());
  return new;
end;
$$;

create function public.preview_flux_computer_return(p_return_id uuid, p_location text, p_sector text)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  receipt public.flux_items%rowtype;
  origin public.module_records%rowtype;
  target public.module_records%rowtype;
  ticket public.control_items%rowtype;
  target_count integer;
  matching_tickets uuid[];
  month_id uuid;
  condition text;
  issue text := '';
  technical text := '';
  keep_position boolean;
  monitoring boolean;
begin
  if not coalesce(app.is_admin(), false) or auth.uid() is null then
    raise exception 'Somente administradores podem regularizar o retorno de computadores.';
  end if;
  if p_location is null or p_location <> btrim(p_location)
    or char_length(p_location) not between 1 and 160
    or not exists (select 1 from public.organizational_sectors s where s.active and s.name = p_sector) then
    raise exception 'Informe um local válido e um setor do catálogo.';
  end if;
  select * into receipt from public.flux_items where id = p_return_id;
  if receipt.return_of is null or receipt.resolution_state is distinct from 'Pendente'
    or receipt.post_receipt_status is null or receipt.inventory_item_id is not null
    or receipt.management_computer_id is null then
    raise exception 'O retorno não está pendente ou não tem um computador da Gestão TI identificado.';
  end if;
  select r.* into origin from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where r.management_computer_id = receipt.management_computer_id;
  if origin.id is null then raise exception 'O computador do envio não está disponível na Gestão TI.'; end if;
  condition := case receipt.post_receipt_status when 'Verificação' then 'Reserva'
    else receipt.post_receipt_status end;
  monitoring := receipt.post_receipt_status in ('Manutenção', 'Defeito');

  select count(*) into target_count from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where app.inventory_installation_location_key(r.payload->>'terminal') =
      app.inventory_installation_location_key(p_location);
  if target_count = 1 then
    select r.* into target from public.module_records r where r.table_id = origin.table_id
      and app.inventory_installation_location_key(r.payload->>'terminal') =
        app.inventory_installation_location_key(p_location);
  end if;
  keep_position := case when condition = 'Ativo' then target.id is not distinct from origin.id
    else coalesce(btrim(origin.payload->>'terminal'), '') = ''
      and coalesce(origin.payload->>'isFixed', 'false') <> 'true' end;

  if origin.payload->>'status' = 'Inativo' then
    issue := 'Reative o computador na Gestão TI antes de regularizar o retorno.';
  elsif not monitoring and lower(btrim(coalesce(origin.payload->>'situation', ''))) in ('em manutenção', 'em manutencao') then
    issue := 'Confira a situação Em Manutenção no Controle TI antes de aplicar este destino.';
  elsif condition = 'Ativo' then
    if target.id is null then
      issue := 'Escolha um terminal único e válido da mesma tabela da Gestão TI.';
    elsif target.management_computer_id is not null and target.id <> origin.id then
      issue := 'Terminal ocupado. Use a substituição da Gestão TI para definir o destino do ocupante.';
    elsif (target.payload->>'sector') is distinct from p_sector then
      issue := 'O setor informado deve corresponder ao setor cadastrado no terminal.';
    elsif lower(btrim(coalesce(target.payload->>'terminal', ''))) <> lower(p_location) then
      issue := 'Informe o terminal com o nome cadastrado na Gestão TI.';
    elsif lower(btrim(coalesce(origin.payload->>'area', ''))) <>
      lower(btrim(coalesce(target.payload->>'area', ''))) and not (
        lower(btrim(coalesce(origin.payload->>'area', ''))) in ('escritório', 'estoque')
        and lower(btrim(coalesce(target.payload->>'area', ''))) in ('escritório', 'estoque')) then
      issue := 'Esta mudança de área não é permitida pela Gestão TI.';
    elsif not keep_position and exists (
      select 1 from public.control_items c where c.management_record_id = target.id) then
      issue := 'Há um vínculo técnico anterior no terminal. Confira-o na Gestão TI.';
    end if;
  elsif target_count > 0 or p_location ~* '^PDV[[:space:]]*[0-9]+$' then
    issue := 'Escolha um local de guarda ou atendimento fora dos terminais.';
  end if;

  -- A rotina de manutenção legada também procura por TAG e série. Recuse
  -- colisões antes de deixar que ela selecione um registro.
  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into matching_tickets
    from public.control_items c where c.management_record_id = origin.id
      or c.verification_computer_id = receipt.management_computer_id
      or (monitoring and (
        (nullif(lower(btrim(origin.payload->>'tag')), '') not in ('-', '***')
          and lower(btrim(c.tag)) = lower(btrim(origin.payload->>'tag')))
        or (nullif(lower(btrim(origin.payload->>'serial')), '') not in ('-', '***')
          and lower(btrim(c.serial)) = lower(btrim(origin.payload->>'serial')))));
  if cardinality(matching_tickets) = 1 then
    select * into ticket from public.control_items where id = matching_tickets[1];
  end if;
  if issue = '' then
    if cardinality(matching_tickets) > 1 or (ticket.id is not null and
      ticket.verification_computer_id is distinct from receipt.management_computer_id and
      (ticket.management_record_id is distinct from origin.id or ticket.inventory_item_id is not null
        or ticket.supply_unit_id is not null or not app.management_identity_matches(origin.payload, ticket.tag, ticket.serial))) then
      issue := 'Há vínculos técnicos ambíguos para o computador. Confira no Controle TI.';
    elsif ticket.status in ('Aguardando avaliação', 'Em manutenção', 'Em sala') then
      if receipt.post_receipt_status in ('Ativo', 'Reserva') and ticket.followup_kind = 'maintenance'
        and ticket.status = 'Em manutenção' and origin.payload->>'status' = 'Manutenção'
        and origin.payload->>'situation' is distinct from 'Verificando'
        and exists (select 1 from public.equipment_events e
          where e.source_module = 'flux' and e.source_event_key = 'management-maintenance:' || receipt.return_of::text
            and e.processing_result->>'controlItemId' = ticket.id::text)
        and exists (select 1 from public.control_cases c join public.flux_items f on f.id = receipt.return_of
          where c.control_item_id = ticket.id and c.ticket_state not in ('Concluído', 'Cancelado')
            and c.opened_at between f.created_at and receipt.received_at) then
        technical := 'complete';
      elsif monitoring and ticket.followup_kind = 'maintenance' and ticket.status = 'Em manutenção'
        and exists (select 1 from public.module_tables t where t.id = ticket.table_id
          and lower(btrim(t.name)) = lower(app.current_control_maintenance_table_name())) then
        technical := 'reuse';
      elsif receipt.post_receipt_status = 'Verificação' and ticket.followup_kind = 'verification'
        and ticket.verification_computer_id = receipt.management_computer_id and keep_position
        and origin.payload->>'situation' = 'Verificando' and origin.payload->>'status' = 'Reserva'
        and origin.payload->>'location' = p_location and origin.payload->>'sector' = p_sector then
        technical := 'reuse';
      else
        issue := 'Há um chamado ativo incompatível com o destino. Confira no Controle TI.';
      end if;
    elsif origin.payload->>'situation' = 'Verificando' then
      issue := 'A Gestão TI indica verificação sem chamado ativo. Confira no Controle TI.';
    elsif monitoring or receipt.post_receipt_status = 'Verificação' then
      if monitoring and ticket.id is not null then
        issue := 'Já há histórico técnico para o computador. Abra o novo acompanhamento pelo Controle TI.';
      else
        select t.id into month_id from public.module_tables t where t.module = 'control'
          and t.name = app.current_control_maintenance_table_name()
          order by t.created_at desc, t.id desc limit 1;
        if month_id is null then
          issue := 'Crie a tabela mensal no Controle TI para iniciar o acompanhamento.';
        else
          technical := case when monitoring then 'maintenance' else 'verify' end;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('blocked', issue <> '', 'reason', issue,
    'token', md5(jsonb_build_array(receipt.id, receipt.updated_at, receipt.post_receipt_status,
      origin.id, origin.updated_at, target.id, target.updated_at, matching_tickets, ticket.updated_at,
      month_id, p_location, p_sector, technical, issue)::text),
    'technicalAction', technical, 'controlItemId', ticket.id, 'keepPosition', keep_position,
    'item', jsonb_build_object('id', origin.id, 'computerId', receipt.management_computer_id,
      'location', origin.payload->>'location', 'sector', origin.payload->>'sector', 'status', origin.payload->>'status'),
    'target', jsonb_build_object('positionId', target.id, 'location', p_location, 'sector', p_sector,
      'status', condition, 'situation', case when receipt.post_receipt_status = 'Verificação' then 'Verificando'
        else origin.payload->>'situation' end),
    'occupants', case when target.management_computer_id is not null and target.id <> origin.id
      then jsonb_build_array(jsonb_build_object('equipment', target.payload->>'equipment', 'tag', target.payload->>'tag'))
      else '[]'::jsonb end);
end;
$$;

create function public.confirm_flux_computer_return(
  p_return_id uuid, p_location text, p_sector text, p_reason text, p_review_token text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  receipt public.flux_items%rowtype;
  origin public.module_records%rowtype;
  target public.module_records%rowtype;
  prior public.equipment_events%rowtype;
  review jsonb;
  result jsonb;
  plan jsonb;
  condition text;
  technical text;
  technical_id uuid;
  completion_id uuid;
  position_id uuid;
  hash text;
  detail_text text;
  reason_text text := btrim(coalesce(p_reason, ''));
begin
  if not coalesce(app.is_admin(), false) or auth.uid() is null or p_request_id is null
    or nullif(p_review_token, '') is null or char_length(reason_text) not between 5 and 500 then
    raise exception 'Confira o destino e informe um motivo (5 a 500 caracteres).';
  end if;
  perform pg_advisory_xact_lock(89124, hashtext(p_request_id::text));
  select * into receipt from public.flux_items where id = p_return_id for update;
  hash := md5(jsonb_build_array(p_return_id, p_location, p_sector, reason_text, p_review_token)::text);
  select * into prior from public.equipment_events e where e.id = p_request_id;
  if found then
    if prior.source_module <> 'management' or prior.actor_id is distinct from auth.uid()
      or prior.metadata->>'fluxComputerReturnHash' is distinct from hash then
      raise exception 'Identificador de operação já utilizado com outros dados.';
    end if;
    return jsonb_build_object('eventId', prior.id, 'alreadyApplied', true);
  end if;

  lock table public.module_records, public.control_items in share row exclusive mode;
  review := public.preview_flux_computer_return(p_return_id, p_location, p_sector);
  if review->>'token' is distinct from p_review_token then
    raise exception 'O retorno, computador, terminal ou chamado mudou. Confira novamente.';
  end if;
  if review->>'blocked' = 'true' then raise exception '%', review->>'reason'; end if;
  select * into strict origin from public.module_records r
    where r.management_computer_id = receipt.management_computer_id for update;
  select * into target from public.module_records r where r.id = (review->'target'->>'positionId')::uuid for update;
  condition := review->'target'->>'status';
  technical := review->>'technicalAction';
  technical_id := (review->>'controlItemId')::uuid;
  detail_text := left(format('Regularização após retorno: %s / %s → %s / %s. %s',
    origin.payload->>'location', origin.payload->>'status', p_location, condition, reason_text), 500);

  if technical = 'complete' then
    result := public.complete_control_maintenance(technical_id, condition,
      md5('flux-computer-return:' || p_request_id::text)::uuid);
    completion_id := (result->>'eventId')::uuid;
  end if;
  if (review->>'keepPosition')::boolean then
    position_id := origin.id;
    update public.module_records r set payload = app.management_movement_log(
      r.payload || jsonb_build_object('status', condition, 'location', p_location, 'sector', p_sector),
      p_request_id, detail_text) where r.id = position_id;
    insert into public.equipment_events(id, source_module, source_event_key, source_id,
      action, previous_status, new_status, previous_location, new_location, reason,
      affected_modules, processing_result, metadata, actor_id)
    values (p_request_id, 'management', p_request_id::text, origin.id, 'Regularização após retorno',
      origin.payload->>'status', condition, origin.payload->>'location', p_location, reason_text,
      jsonb_build_array('management'), '{"status":"applied"}'::jsonb,
      jsonb_build_object('computerIds', jsonb_build_array(receipt.management_computer_id),
        'positionIds', jsonb_build_array(origin.id),
        'incoming', jsonb_build_object('id', receipt.management_computer_id,
          'from', origin.id, 'to', origin.id, 'before', jsonb_build_object(
            'location', origin.payload->>'location', 'status', origin.payload->>'status'),
          'after', jsonb_build_object('location', p_location, 'status', condition))), auth.uid());
  else
    plan := jsonb_build_object('mode', 'direct', 'sourceId', origin.id, 'targetId', target.id,
      'targetUnassigned', target.id is null, 'incomingComputerId', receipt.management_computer_id,
      'sourceUpdatedAt', (select r.updated_at from public.module_records r where r.id = origin.id),
      'targetUpdatedAt', target.updated_at, 'incomingStatus', condition, 'incomingLocation', p_location,
      'reason', reason_text, 'confirmedLocations', true);
    result := public.management_move_computer(p_request_id, plan);
    position_id := (result->>'incomingDestinationId')::uuid;
    if target.id is null then
      update public.module_records r set payload = r.payload || jsonb_build_object('sector', p_sector)
        where r.id = position_id;
    end if;
  end if;

  if technical = 'verify' then
    update public.module_records r set payload = r.payload || jsonb_build_object('situation', 'Verificando')
      where r.id = position_id;
    select c.id into technical_id from public.control_items c
      where c.verification_computer_id = receipt.management_computer_id and c.status = 'Aguardando avaliação';
    if technical_id is null then raise exception 'A verificação esperada não foi registrada.'; end if;
    select e.id into completion_id from public.equipment_events e where e.source_module = 'control'
      and e.source_event_key = 'verification-start:' || technical_id::text;
  elsif technical = 'maintenance' or (technical = 'reuse' and condition in ('Defeito', 'Manutenção')) then
    select c.id into technical_id from public.control_items c
      where c.management_record_id = position_id and c.status = 'Em manutenção';
    if technical_id is null then raise exception 'A manutenção esperada não foi registrada.'; end if;
    update public.control_items c set sector = p_sector where c.id = technical_id and c.sector is distinct from p_sector;
  end if;
  if not exists (select 1 from public.module_records r where r.id = position_id
      and r.management_computer_id = receipt.management_computer_id
      and r.payload->>'status' = condition and r.payload->>'location' = p_location and r.payload->>'sector' = p_sector) then
    raise exception 'A Gestão TI não confirmou o destino. A regularização foi revertida.';
  end if;
  update public.equipment_events e set action = 'Regularização após retorno',
    previous_status = origin.payload->>'status',
    affected_modules = e.affected_modules || jsonb_build_array('flux')
      || case when technical_id is not null and not (e.affected_modules ? 'control') then jsonb_build_array('control')
        else '[]'::jsonb end,
    metadata = e.metadata || jsonb_build_object('fluxReturnId', receipt.id, 'fluxSendId', receipt.return_of,
      'fluxComputerReturnHash', hash, 'previousSector', origin.payload->>'sector', 'targetSector', p_sector,
      'controlItemId', technical_id, 'controlEventId', completion_id)
    where e.id = p_request_id;
  if not found then raise exception 'O evento da Gestão TI não foi encontrado.'; end if;
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
    values (p_request_id, 'management', 'applied', 1, now()), (p_request_id, 'flux', 'applied', 1, now())
    on conflict (event_id, module) do nothing;
  update public.flux_items f set resolution_state = 'Aplicada', location = p_location, sector = p_sector
    where f.id = receipt.id;
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
    values (receipt.id, 'update', detail_text, p_request_id);
  return jsonb_build_object('eventId', p_request_id, 'alreadyApplied', false, 'controlItemId', technical_id);
end;
$$;

revoke all on function public.preview_flux_computer_return(uuid,text,text) from public, anon;
grant execute on function public.preview_flux_computer_return(uuid,text,text) to authenticated;
revoke all on function public.confirm_flux_computer_return(uuid,text,text,text,text,uuid) from public, anon;
grant execute on function public.confirm_flux_computer_return(uuid,text,text,text,text,uuid) to authenticated;

commit;
