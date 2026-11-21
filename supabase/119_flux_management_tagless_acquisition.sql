-- ALDECKOT | Aquisição de computador na Gestão TI com série obrigatória e TAG opcional.
begin;
create or replace function public.flux_preview_management_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  candidate record;
  matched integer := 0;
  record_id uuid;
  record_area text;
  norm_tag text;
  norm_serial text;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('management', 'create') then
    raise exception 'Sem permissão para consultar esta aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id;
  select * into intent from public.flux_acquisition_intents where flux_item_id = p_flux_item_id;
  if movement.id is null or movement.reason <> 'Aquisição' or
     intent.destination is distinct from 'management' or intent.management_kind <> 'computer' then
    raise exception 'Defina primeiro a Gestão TI e o tipo Computador.';
  end if;
  norm_tag := nullif(lower(btrim(movement.tag)), '');
  norm_serial := nullif(lower(btrim(movement.serial)), '');
  if norm_serial is null or norm_serial in ('-', '***', 'n/a', 'sem número', 'sem numero') then
    return jsonb_build_object('state', 'invalid-identity');
  end if;
  if norm_tag in ('-', '***', 'n/a', 'sem tag') then norm_tag := null; end if;
  if exists (select 1 from public.inventory_items i
    where lower(btrim(i.serial))=norm_serial or
      (norm_tag is not null and lower(btrim(i.tag))=norm_tag)) then
    return jsonb_build_object('state', 'conflict');
  end if;
  for candidate in select r.id, r.payload from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where (norm_tag is not null and lower(btrim(coalesce(r.payload->>'tag', ''))) = norm_tag) or
          lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) = norm_serial
  loop
    matched := matched + 1;
    if matched > 1 or (norm_tag is not null and
       lower(btrim(coalesce(candidate.payload->>'tag', ''))) <> norm_tag) or
       lower(btrim(coalesce(candidate.payload->>'serial', candidate.payload->>'numeroSerie', ''))) <> norm_serial then
      return jsonb_build_object('state', 'conflict');
    end if;
    record_id := candidate.id;
    record_area := candidate.payload->>'area';
  end loop;
  if record_id is not null and record_area is distinct from intent.management_area then
    return jsonb_build_object('state', 'area-conflict', 'existingArea', record_area);
  end if;
  if record_id is not null then
    if not app.can_manage_module('management', 'update') then
      raise exception 'Sem permissão para vincular e registrar histórico no computador existente da Gestão TI.';
    end if;
    return jsonb_build_object('state', 'existing', 'managementRecordId', record_id,
      'area', record_area);
  end if;
  return jsonb_build_object('state', 'new', 'area', intent.management_area);
end;
$$;

create or replace function public.flux_complete_management_acquisition(p_flux_item_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  intent public.flux_acquisition_intents%rowtype;
  candidate record;
  management_table record;
  matched integer := 0;
  target_id uuid;
  event_id uuid;
  flux_log_id uuid;
  linked_existing boolean := false;
  norm_tag text;
  norm_serial text;
  activity_text text;
  new_payload jsonb;
  next_position integer;
begin
  if auth.uid() is null or not app.can_manage_module('flux', 'update') or
     not app.can_manage_module('management', 'create') then
    raise exception 'Sem permissão para concluir esta aquisição.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  select * into intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if movement.id is null or movement.reason <> 'Aquisição' or
     intent.destination is distinct from 'management' or intent.management_kind <> 'computer' then
    raise exception 'Defina primeiro a Gestão TI e o tipo Computador.';
  end if;
  if intent.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'managementRecordId',
      intent.management_record_id, 'alreadyApplied', true);
  end if;
  if intent.status <> 'pending' or movement.status <> 'Recebido' then
    raise exception 'O cadastro na Gestão TI exige recebimento confirmado no Flux.';
  end if;
  norm_tag := nullif(lower(btrim(movement.tag)), '');
  norm_serial := nullif(lower(btrim(movement.serial)), '');
  if norm_serial is null or norm_serial in ('-', '***', 'n/a', 'sem número', 'sem numero') then
    raise exception 'Informe uma série válida antes de cadastrar na Gestão TI.';
  end if;
  if norm_tag in ('-', '***', 'n/a', 'sem tag') then norm_tag := null; end if;
  -- Serializa integrações do mesmo equipamento, inclusive quando chegam por
  -- movimentações Flux diferentes. A validação de duplicidade continua ativa.
  perform pg_advisory_xact_lock(89116, hashtext(norm_serial));
  perform pg_advisory_xact_lock(hashtextextended('management-serial:' || norm_serial, 0));
  if norm_tag is not null then
    perform pg_advisory_xact_lock(hashtextextended('management:' || norm_tag, 0));
  end if;
  if exists (select 1 from public.inventory_items i
    where lower(btrim(i.serial))=norm_serial or
      (norm_tag is not null and lower(btrim(i.tag))=norm_tag)) then
    raise exception 'A série ou TAG já aparece no Inventário. Revise a identidade antes de cadastrar na Gestão TI.';
  end if;
  for candidate in select r.id, r.payload from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where (norm_tag is not null and lower(btrim(coalesce(r.payload->>'tag', ''))) = norm_tag) or
          lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) = norm_serial
    for update of r
  loop
    matched := matched + 1;
    if matched > 1 or (norm_tag is not null and
       lower(btrim(coalesce(candidate.payload->>'tag', ''))) <> norm_tag) or
       lower(btrim(coalesce(candidate.payload->>'serial', candidate.payload->>'numeroSerie', ''))) <> norm_serial then
      raise exception 'Há conflito de TAG ou série na Gestão TI. Revise a identidade antes de integrar.';
    end if;
    if candidate.payload->>'area' is distinct from intent.management_area then
      raise exception 'O computador já existe em outra área da Gestão TI. Corrija a área antes de vincular.';
    end if;
    target_id := candidate.id;
    linked_existing := true;
  end loop;
  if linked_existing and not app.can_manage_module('management', 'update') then
    raise exception 'Sem permissão para vincular e registrar histórico no computador existente da Gestão TI.';
  end if;
  if target_id is null then
    select * into management_table from public.module_tables
      where module = 'management' order by created_at, id limit 1 for update;
    if management_table.id is null then
      raise exception 'Abra a Gestão TI uma vez para inicializar sua tabela antes de integrar.';
    end if;
    new_payload := jsonb_build_object(
        'terminal', 'Reserva ' || coalesce(nullif(btrim(movement.tag),''),btrim(movement.serial)),
        'equipment', movement.equipment, 'tag', movement.tag,
        'brand', movement.brand, 'model', movement.model, 'serial', movement.serial,
        'area', intent.management_area, 'type', intent.management_area,
        'sector', '', 'location', '', 'status', 'Reserva', 'situation', 'Estoque',
        'cleaning', 'Não Realizada', 'priority', 'Estável', 'isFixed', false,
        'peripherals', '[]'::jsonb, 'logs', '[]'::jsonb);
    select coalesce(max(position),0)+1 into next_position
      from public.module_records where table_id=management_table.id;
    if exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='module_records'
        and column_name='owner_id') then
      execute 'insert into public.module_records(table_id,owner_id,payload,position)
        values ($1,$2,$3,$4) returning id'
        into target_id using management_table.id,
          (to_jsonb(management_table)->>'owner_id')::uuid,new_payload,next_position;
    else
      insert into public.module_records(table_id,payload,position)
        values (management_table.id,new_payload,next_position)
        returning id into target_id;
    end if;
  end if;

  activity_text := left('Aquisição recebida via Flux · TAG ' || coalesce(nullif(btrim(movement.tag),''),'não informada') ||
    ' · série ' || movement.serial || ' · área ' || intent.management_area ||
    ' · movimentação ' || p_flux_item_id::text, 500);
  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     new_status, origin_location, destination_location, reason,
     affected_modules, processing_result, metadata, actor_id)
  values ('flux', 'management-acquisition:' || p_flux_item_id::text,
    p_flux_item_id, movement.inventory_item_id, 'Aquisição recebida',
    case when linked_existing then candidate.payload->>'status' else 'Reserva' end,
    movement.sender_company, movement.destination_company, 'Aquisição',
    '["flux","management"]'::jsonb,
    jsonb_build_object('management', case when linked_existing then 'linked' else 'created' end),
    jsonb_build_object('fluxItemId', p_flux_item_id, 'managementRecordId', target_id,
      'area', intent.management_area, 'kind', 'computer', 'equipment', movement.equipment,
      'model', movement.model, 'brand', movement.brand, 'tag', movement.tag,
      'serial', movement.serial, 'senderCompany', movement.sender_company,
      'destinationCompany', movement.destination_company,
      'senderResponsible', movement.sender_responsible,
      'receiverResponsible', movement.receiver_responsible,
      'sendDate', movement.send_date, 'receivedDate', movement.received_date,
      'shippingType', movement.shipping_type, 'notes', movement.notes,
      'linkedExisting', linked_existing), auth.uid())
  returning id into event_id;
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
  values (p_flux_item_id, 'update', left(case when linked_existing then
    'Computador existente vinculado à Gestão TI' else
    'Computador cadastrado em Reserva na Gestão TI' end ||
    ' · ' || intent.management_area || ' · TAG ' || coalesce(nullif(btrim(movement.tag),''),'não informada'), 500), event_id)
  returning id into flux_log_id;
  update public.module_records set payload = jsonb_set(payload, '{logs}',
    coalesce(case when jsonb_typeof(payload->'logs') = 'array'
      then payload->'logs' else '[]'::jsonb end, '[]'::jsonb) ||
    jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text,
      'at', now(), 'text', activity_text, 'sourceModule', 'flux',
      'sourceLogId', flux_log_id::text, 'eventId', event_id::text)))
    where id = target_id;
  insert into public.equipment_event_effects(event_id, module, status, attempts, processed_at)
  values (event_id, 'management', 'applied', 1, now()),
         (event_id, 'flux', 'applied', 1, now());
  update public.flux_acquisition_intents set status = 'completed',
    management_record_id = target_id, actor_id = auth.uid(), updated_at = now()
    where flux_item_id = p_flux_item_id;
  return jsonb_build_object('status', 'completed', 'managementRecordId', target_id,
    'linkedExisting', linked_existing, 'alreadyApplied', false);
end;
$$;

commit;
