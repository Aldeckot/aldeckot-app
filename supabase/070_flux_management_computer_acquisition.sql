-- ALDECKOT | Flux -> Gestão TI: aquisição de computador recebido.
-- Aplicar somente após 069. Não instala em PDV nem altera saldos do Inventário.
begin;

alter table public.flux_acquisition_intents
  add column if not exists management_area text,
  add column if not exists management_kind text,
  add column if not exists management_record_id uuid references public.module_records(id) on delete restrict;

alter table public.flux_acquisition_intents
  drop constraint if exists flux_acquisition_intents_destination_check,
  drop constraint if exists flux_acquisition_intents_check,
  drop constraint if exists flux_acquisition_intents_check1;
alter table public.flux_acquisition_intents
  add constraint flux_acquisition_intents_destination_check
    check (destination in ('inventory', 'management', 'none')),
  add constraint flux_acquisition_intents_shape_check check (
    (destination = 'inventory' and inventory_table_id is not null
      and management_area is null and management_kind is null
      and management_record_id is null and status <> 'skipped') or
    (destination = 'management' and inventory_table_id is null
      and inventory_item_id is null and management_area in ('Frente de Loja', 'Escritório', 'Estoque')
      and management_kind = 'computer' and status <> 'skipped') or
    (destination = 'none' and inventory_table_id is null and inventory_item_id is null
      and management_area is null and management_kind is null
      and management_record_id is null and status = 'skipped')
  ),
  add constraint flux_acquisition_intents_result_check check (
    (status = 'completed' and
      ((destination = 'inventory' and inventory_item_id is not null) or
       (destination = 'management' and management_record_id is not null))) or
    (status <> 'completed' and inventory_item_id is null and management_record_id is null)
  );

create or replace function public.flux_set_acquisition_intent_v2(
  p_flux_item_id uuid, p_destination text, p_inventory_table_id uuid default null,
  p_management_area text default null, p_management_kind text default null
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
  if p_destination = 'inventory' then
    if not app.can_manage_module('inventory', 'create') then
      raise exception 'Sem permissão para cadastrar no Inventário.';
    end if;
    if not exists (select 1 from public.module_tables
      where id = p_inventory_table_id and module = 'inventory') or
      p_management_area is not null or p_management_kind is not null then
      raise exception 'Selecione uma tabela real do Inventário.';
    end if;
    next_status := 'pending';
  elsif p_destination = 'management' then
    if not app.can_manage_module('management', 'create') then
      raise exception 'Sem permissão para cadastrar na Gestão TI.';
    end if;
    if p_inventory_table_id is not null or p_management_area is null or
       p_management_area not in ('Frente de Loja', 'Escritório', 'Estoque') or
       p_management_kind is distinct from 'computer' then
      raise exception 'Selecione área e tipo Computador válidos para a Gestão TI.';
    end if;
    next_status := 'pending';
  elsif p_destination = 'none' then
    if p_inventory_table_id is not null or p_management_area is not null or
       p_management_kind is not null then
      raise exception 'Não informe cadastro ao dispensar a integração.';
    end if;
    next_status := 'skipped';
  else
    raise exception 'Destino de aquisição indisponível nesta etapa.';
  end if;

  select * into current_intent from public.flux_acquisition_intents
    where flux_item_id = p_flux_item_id for update;
  if found and current_intent.status = 'completed' then
    if p_destination <> current_intent.destination or
       p_inventory_table_id is distinct from current_intent.inventory_table_id or
       p_management_area is distinct from current_intent.management_area or
       p_management_kind is distinct from current_intent.management_kind then
      raise exception 'A aquisição já foi integrada. Não é possível trocar o destino concluído.';
    end if;
    return jsonb_build_object('status', 'completed',
      'inventoryItemId', current_intent.inventory_item_id,
      'managementRecordId', current_intent.management_record_id);
  end if;

  insert into public.flux_acquisition_intents
    (flux_item_id, destination, inventory_table_id, management_area,
     management_kind, status, actor_id)
  values (p_flux_item_id, p_destination, p_inventory_table_id,
    p_management_area, p_management_kind, next_status, auth.uid())
  on conflict (flux_item_id) do update set
    destination = excluded.destination, inventory_table_id = excluded.inventory_table_id,
    inventory_item_id = null, management_area = excluded.management_area,
    management_kind = excluded.management_kind, management_record_id = null,
    status = excluded.status, actor_id = excluded.actor_id, updated_at = now();
  return jsonb_build_object('status', next_status);
end;
$$;

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
  norm_tag := lower(btrim(coalesce(movement.tag, '')));
  norm_serial := lower(btrim(coalesce(movement.serial, '')));
  if norm_tag in ('', '-', '***', 'n/a', 'sem tag') or
     norm_serial in ('', '-', '***', 'n/a', 'sem número', 'sem numero') then
    return jsonb_build_object('state', 'invalid-identity');
  end if;
  for candidate in select r.id, r.payload from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where lower(btrim(coalesce(r.payload->>'tag', ''))) = norm_tag or
          lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) = norm_serial
  loop
    matched := matched + 1;
    if matched > 1 or lower(btrim(coalesce(candidate.payload->>'tag', ''))) <> norm_tag or
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
  norm_tag := lower(btrim(coalesce(movement.tag, '')));
  norm_serial := lower(btrim(coalesce(movement.serial, '')));
  if norm_tag in ('', '-', '***', 'n/a', 'sem tag') or
     norm_serial in ('', '-', '***', 'n/a', 'sem número', 'sem numero') then
    raise exception 'Informe TAG e série válidos antes de cadastrar na Gestão TI.';
  end if;
  -- Serializa integrações do mesmo equipamento, inclusive quando chegam por
  -- movimentações Flux diferentes. A validação de duplicidade continua ativa.
  perform pg_advisory_xact_lock(hashtextextended('management:' || norm_tag, 0));
  perform pg_advisory_xact_lock(hashtextextended('management-serial:' || norm_serial, 0));
  for candidate in select r.id, r.payload from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where lower(btrim(coalesce(r.payload->>'tag', ''))) = norm_tag or
          lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) = norm_serial
    for update of r
  loop
    matched := matched + 1;
    if matched > 1 or lower(btrim(coalesce(candidate.payload->>'tag', ''))) <> norm_tag or
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
    select id, owner_id into management_table from public.module_tables
      where module = 'management' order by created_at, id limit 1 for update;
    if management_table.id is null then
      raise exception 'Abra a Gestão TI uma vez para inicializar sua tabela antes de integrar.';
    end if;
    insert into public.module_records (table_id, owner_id, payload, position)
    values (management_table.id, management_table.owner_id,
      jsonb_build_object('terminal', 'Reserva ' || btrim(movement.tag),
        'equipment', movement.equipment, 'tag', movement.tag,
        'brand', movement.brand, 'model', movement.model, 'serial', movement.serial,
        'area', intent.management_area, 'type', intent.management_area,
        'sector', '', 'location', '', 'status', 'Reserva', 'situation', 'Estoque',
        'cleaning', 'Não Realizada', 'priority', 'Estável', 'isFixed', false,
        'peripherals', '[]'::jsonb, 'logs', '[]'::jsonb),
      (select coalesce(max(position), 0) + 1 from public.module_records
       where table_id = management_table.id))
    returning id into target_id;
  end if;

  activity_text := left('Aquisição recebida via Flux · TAG ' || movement.tag ||
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
    ' · ' || intent.management_area || ' · TAG ' || movement.tag, 500), event_id)
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

revoke all on function public.flux_set_acquisition_intent_v2(uuid, text, uuid, text, text),
  public.flux_preview_management_acquisition(uuid),
  public.flux_complete_management_acquisition(uuid) from public, anon;
grant execute on function public.flux_set_acquisition_intent_v2(uuid, text, uuid, text, text),
  public.flux_preview_management_acquisition(uuid),
  public.flux_complete_management_acquisition(uuid) to authenticated;
commit;
