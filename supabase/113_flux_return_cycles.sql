-- ALDECKOT | Retorno físico vinculado ao envio, sem presumir status patrimonial.
-- A regularização de local/status é uma operação posterior e explícita.
begin;

alter table public.flux_items
  add column if not exists received_at timestamptz,
  add column if not exists return_reason text,
  add column if not exists post_receipt_status text,
  add column if not exists resolution_state text;
alter table public.flux_items add constraint flux_post_receipt_status_check
  check (post_receipt_status is null or post_receipt_status in
    ('Ativo', 'Reserva', 'Verificação', 'Defeito', 'Manutenção'));
alter table public.flux_items add constraint flux_resolution_state_check
  check (resolution_state is null or resolution_state in ('Pendente', 'Aplicada'));

create or replace function public.flux_register_return(
  p_send_id uuid, p_target_table_id uuid, p_expected_updated_at timestamptz,
  p_request_id uuid, p_received_at timestamptz, p_received_by text,
  p_origin_company text, p_destination_company text,
  p_return_reason text, p_post_receipt_status text, p_carrier text, p_notes text
) returns public.flux_items language plpgsql security definer set search_path = public as $$
declare
  send_row public.flux_items%rowtype;
  return_row public.flux_items%rowtype;
  prior public.flux_lifecycle_actions%rowtype;
  event_key uuid;
  payload_digest text;
  physical_uid uuid;
begin
  if auth.uid() is null or p_send_id is null or p_target_table_id is null
    or p_expected_updated_at is null or p_request_id is null or p_received_at is null
    or nullif(btrim(coalesce(p_received_by, '')), '') is null
    or nullif(btrim(coalesce(p_origin_company, '')), '') is null
    or nullif(btrim(coalesce(p_destination_company, '')), '') is null
    or char_length(btrim(coalesce(p_return_reason, ''))) not between 5 and 500
    or p_post_receipt_status not in ('Ativo','Reserva','Verificação','Defeito','Manutenção') then
    raise exception 'Informe origem, destino, recebimento, motivo e status pretendido.';
  end if;
  if char_length(p_received_by) > 160 or char_length(p_origin_company) > 160
    or char_length(p_destination_company) > 160 or char_length(coalesce(p_carrier, '')) > 160
    or char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'Os dados do retorno ultrapassam o limite permitido.';
  end if;
  payload_digest := md5(concat_ws('|', p_send_id, p_target_table_id,
    p_expected_updated_at, p_received_at, btrim(p_received_by),
    btrim(p_origin_company), btrim(p_destination_company), btrim(p_return_reason),
    p_post_receipt_status, btrim(coalesce(p_carrier, '')), btrim(coalesce(p_notes, ''))));
  select * into prior from public.flux_lifecycle_actions where request_id = p_request_id;
  if found then
    if prior.kind <> 'return' or prior.flux_item_id <> p_send_id
      or prior.payload_hash <> payload_digest or prior.actor_id <> auth.uid() then
      raise exception 'Este identificador de retorno já foi usado com outros dados.';
    end if;
    select * into return_row from public.flux_items where id = prior.linked_item_id;
    if not found then raise exception 'Retorno confirmado, mas registro vinculado indisponível.'; end if;
    return return_row;
  end if;
  select * into send_row from public.flux_items where id = p_send_id for update;
  if not found or send_row.movement <> 'Envio' then
    raise exception 'Envio de origem não encontrado.';
  end if;
  if not coalesce(app.can_manage_module_table(send_row.table_id, 'flux', 'update'), false)
    or not coalesce(app.can_manage_module_table(p_target_table_id, 'flux', 'create'), false) then
    raise exception 'Sem permissão para registrar este retorno.';
  end if;
  if send_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'O envio mudou desde a prévia. Atualize e revise novamente.';
  end if;
  if send_row.status not in ('Entregue','Recebido') then
    raise exception 'Confirme a entrega do envio antes de registrar o retorno.';
  end if;
  if send_row.reason = 'Aquisição' then
    raise exception 'Aquisição recebida é entrada definitiva, não retorno ao remetente.';
  end if;
  if exists (select 1 from public.flux_items where return_of = p_send_id) or
     exists (select 1 from public.flux_lifecycle_actions
       where flux_item_id = p_send_id and kind = 'return') then
    raise exception 'Este envio já possui retorno físico registrado.';
  end if;
  if (p_received_at at time zone 'America/Sao_Paulo')::date < send_row.send_date then
    raise exception 'O retorno não pode anteceder a data de envio.';
  end if;
  physical_uid := coalesce(send_row.equipment_uid, gen_random_uuid());
  if send_row.equipment_uid is null then
    update public.flux_items set equipment_uid = physical_uid where id = send_row.id;
  end if;
  insert into public.flux_items
    (table_id, movement, equipment, model, brand, serial, tag, sector, location,
     sender_company, destination_company, sender_responsible, receiver_responsible,
     send_date, received_date, received_at, shipping_type, reason, status, notes,
     source_module, source_record_id, inventory_item_id, equipment_uid, return_of,
     return_reason, post_receipt_status, resolution_state)
  values (p_target_table_id, 'Recebimento', send_row.equipment, send_row.model,
    send_row.brand, send_row.serial, send_row.tag, send_row.sector, send_row.location,
    btrim(p_origin_company), btrim(p_destination_company), send_row.sender_responsible,
    btrim(p_received_by), send_row.send_date,
    (p_received_at at time zone 'America/Sao_Paulo')::date, p_received_at,
    send_row.shipping_type, send_row.reason, 'Recebido', btrim(coalesce(p_notes, '')),
    'flux', send_row.id, send_row.inventory_item_id, physical_uid, send_row.id,
    btrim(p_return_reason), p_post_receipt_status, 'Pendente')
  returning * into return_row;
  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     origin_location, destination_location, reason, affected_modules,
     metadata, actor_id)
  values ('flux', 'return:' || p_request_id::text, return_row.id,
    return_row.inventory_item_id, 'Retorno físico registrado',
    return_row.sender_company, return_row.destination_company,
    p_return_reason, '["flux"]'::jsonb,
    jsonb_build_object('sendId', send_row.id, 'returnId', return_row.id,
      'equipmentUid', physical_uid, 'receivedAt', p_received_at,
      'receivedBy', btrim(p_received_by), 'carrier', btrim(coalesce(p_carrier, '')),
      'postReceiptStatusRequested', p_post_receipt_status,
      'resolutionState', 'Pendente'), auth.uid()) returning id into event_key;
  insert into public.flux_item_logs(flux_item_id, action, message, event_id) values
    (send_row.id, 'update', left('Retorno físico vinculado em ' ||
      to_char(p_received_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') ||
      '. Regularização de status/local pendente. Motivo: ' || btrim(p_return_reason), 500), event_key),
    (return_row.id, 'create', left('Recebido por ' || btrim(p_received_by) ||
      ' de ' || btrim(p_origin_company) || ' para ' || btrim(p_destination_company) ||
      '. Status pretendido: ' || p_post_receipt_status ||
      ' (regularização pendente). Motivo: ' || btrim(p_return_reason), 500), event_key);
  insert into public.flux_lifecycle_actions
    (request_id, flux_item_id, kind, payload_hash, linked_item_id, event_id, actor_id)
    values (p_request_id, send_row.id, 'return', payload_digest,
      return_row.id, event_key, auth.uid());
  return return_row;
end; $$;

revoke all on function public.flux_register_return(
  uuid,uuid,timestamptz,uuid,timestamptz,text,text,text,text,text,text,text)
  from public, anon;
grant execute on function public.flux_register_return(
  uuid,uuid,timestamptz,uuid,timestamptz,text,text,text,text,text,text,text)
  to authenticated;

commit;
