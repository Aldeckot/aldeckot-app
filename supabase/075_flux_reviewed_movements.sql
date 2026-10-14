-- ALDECKOT | Revisão antes da movimentação e gravação atômica do Flux.
-- Aplicar após 074. Movimentações antigas não recebem vínculos presumidos.
begin;

create table if not exists public.flux_reviewed_movements (
  request_id uuid primary key,
  flux_item_id uuid not null references public.flux_items(id) on delete restrict,
  payload_hash text not null,
  is_creation boolean not null,
  source_module text,
  source_record_id uuid,
  source_status_before text,
  source_status_after text,
  source_updated_at_after timestamptz,
  flux_updated_at_after timestamptz not null,
  control_item_id uuid references public.control_items(id) on delete restrict,
  control_updated_at_after timestamptz,
  control_preexisting boolean not null default false,
  event_id uuid references public.equipment_events(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  reversed_event_id uuid references public.equipment_events(id) on delete restrict
);
create index if not exists flux_reviewed_movements_item_idx
  on public.flux_reviewed_movements (flux_item_id, created_at desc);
create index if not exists flux_reviewed_movements_source_idx
  on public.flux_reviewed_movements (source_module, source_record_id, created_at desc)
  where source_record_id is not null;
alter table public.flux_reviewed_movements enable row level security;
revoke all on public.flux_reviewed_movements from public, anon, authenticated;
grant select on public.flux_reviewed_movements to authenticated;
drop policy if exists "Contas ativas consultam revisões de movimentações" on public.flux_reviewed_movements;
create policy "Contas ativas consultam revisões de movimentações"
  on public.flux_reviewed_movements for select to authenticated
  using (app.has_active_account());

create or replace function public.flux_preview_movement(
  p_table_id uuid, p_existing_id uuid, p_payload jsonb
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  previous public.flux_items%rowtype;
  origin_module text := nullif(p_payload->>'source_module', '');
  origin_id uuid := nullif(p_payload->>'source_record_id', '')::uuid;
  origin_table uuid;
  origin_status text;
  origin_location text;
  origin_equipment text;
  origin_tag text;
  origin_serial text;
  origin_updated timestamptz;
  control_id uuid;
  control_updated timestamptz;
  control_count integer;
  linked_maintenance boolean;
  review_token text;
begin
  if auth.uid() is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     p_payload->>'table_id' is distinct from p_table_id::text or
     not coalesce(app.can_manage_module_table(p_table_id, 'flux',
       case when p_existing_id is null then 'create' else 'update' end), false) then
    raise exception 'Sem permissão ou dados inválidos para revisar a movimentação.';
  end if;
  if p_existing_id is not null then
    select * into previous from public.flux_items where id = p_existing_id and table_id = p_table_id;
    if not found then raise exception 'Movimentação alterada ou não encontrada. Reabra o formulário.'; end if;
    if exists (select 1 from public.flux_reviewed_movements
      where flux_item_id = p_existing_id and reversed_event_id is not null) then
      raise exception 'Movimentação estornada é histórica e não pode ser editada.';
    end if;
  end if;
  if (origin_module is null) is distinct from (origin_id is null) then
    raise exception 'Selecione novamente o equipamento de origem.';
  end if;
  if origin_module = 'inventory' then
    select i.table_id, i.status, i.location, i.equipment, i.tag, i.serial, i.updated_at
      into origin_table, origin_status, origin_location, origin_equipment,
        origin_tag, origin_serial, origin_updated
      from public.inventory_items i where i.id = origin_id;
  elsif origin_module = 'management' then
    select r.table_id, r.payload->>'status',
      coalesce(r.payload->>'location', r.payload->>'area', ''),
      coalesce(r.payload->>'equipment', r.payload->>'name', ''),
      r.payload->>'tag', coalesce(r.payload->>'serial', r.payload->>'numeroSerie'), r.updated_at
      into origin_table, origin_status, origin_location, origin_equipment,
        origin_tag, origin_serial, origin_updated
      from public.module_records r join public.module_tables t on t.id = r.table_id
      where r.id = origin_id and t.module = 'management';
  elsif origin_module = 'control' then
    select c.table_id, c.status, c.sector, c.equipment, c.tag, c.serial, c.updated_at
      into origin_table, origin_status, origin_location, origin_equipment,
        origin_tag, origin_serial, origin_updated
      from public.control_items c where c.id = origin_id;
  elsif origin_module = 'flux' then
    select f.table_id, f.status, f.destination_company, f.equipment, f.tag, f.serial, f.updated_at
      into origin_table, origin_status, origin_location, origin_equipment,
        origin_tag, origin_serial, origin_updated
      from public.flux_items f where f.id = origin_id and f.id is distinct from p_existing_id;
  elsif origin_module is not null then
    raise exception 'Módulo de origem inválido.';
  end if;
  if origin_module is not null and origin_table is null then
    raise exception 'Equipamento de origem não encontrado. Pesquise novamente.';
  end if;
  if origin_module is not null and (
      lower(btrim(coalesce(origin_tag, ''))) is distinct from lower(btrim(coalesce(p_payload->>'tag', ''))) or
      lower(btrim(coalesce(origin_serial, ''))) is distinct from lower(btrim(coalesce(p_payload->>'serial', '')))) then
    raise exception 'A TAG ou série mudou na origem. Pesquise novamente e revise a movimentação.';
  end if;
  linked_maintenance := p_payload->>'movement' = 'Envio' and p_payload->>'reason' = 'Manutenção';
  if linked_maintenance and (origin_module is null or origin_module not in ('inventory', 'management'))
     and p_existing_id is null then
    raise exception 'Envio para manutenção exige selecionar um item do Inventário ou da Gestão TI.';
  end if;
  if linked_maintenance and origin_module in ('inventory', 'management') then
    if nullif(btrim(coalesce(p_payload->>'tag', '')), '') is null or
       nullif(btrim(coalesce(p_payload->>'serial', '')), '') is null or
       btrim(p_payload->>'tag') in ('-', '***') or
       btrim(p_payload->>'serial') in ('-', '***') then
      raise exception 'Informe TAG e número de série reais antes do envio para manutenção.';
    end if;
    if not coalesce(app.can_manage_module_table(origin_table, origin_module, 'update'), false) then
      raise exception 'Sem permissão para alterar o equipamento no módulo de origem.';
    end if;
    if lower(btrim(coalesce(origin_status, ''))) = 'inativo' then
      raise exception 'Equipamento inativo na origem. Revise antes de enviar para manutenção.';
    end if;
    select count(*) into control_count
      from public.control_items c where
        (origin_module = 'inventory' and c.inventory_item_id = origin_id) or
        (origin_module = 'management' and c.management_record_id = origin_id) or
        lower(btrim(coalesce(c.tag, ''))) = lower(btrim(p_payload->>'tag')) or
        lower(btrim(coalesce(c.serial, ''))) = lower(btrim(p_payload->>'serial'));
    if control_count > 1 then
      raise exception 'Identidade ambígua no Controle TI. Revise os vínculos antes de continuar.';
    end if;
    select c.id, c.updated_at into control_id, control_updated from public.control_items c where
        (origin_module = 'inventory' and c.inventory_item_id = origin_id) or
        (origin_module = 'management' and c.management_record_id = origin_id) or
        lower(btrim(coalesce(c.tag, ''))) = lower(btrim(p_payload->>'tag')) or
        lower(btrim(coalesce(c.serial, ''))) = lower(btrim(p_payload->>'serial'))
      limit 1;
    if not coalesce(app.can_manage_module('control',
      case when control_id is null then 'create' else 'update' end), false) then
      raise exception 'Sem permissão para registrar o chamado no Controle TI.';
    end if;
  end if;
  review_token := md5(p_table_id::text || ':' || coalesce(p_existing_id::text, '') || ':' ||
    p_payload::text || ':' || coalesce(origin_updated::text, '') || ':' ||
    coalesce(previous.updated_at::text, '') || ':' ||
    coalesce(control_id::text, '') || ':' || coalesce(control_updated::text, ''));
  return jsonb_build_object(
    'token', review_token, 'sourceModule', origin_module, 'sourceRecordId', origin_id,
    'sourceEquipment', origin_equipment, 'sourceStatus', origin_status,
    'sourceLocation', origin_location, 'sourceUpdatedAt', origin_updated,
    'controlItemId', control_id, 'controlAction', case when control_id is null then 'Criar' else 'Atualizar' end,
    'newSourceStatus', case when linked_maintenance and origin_module in ('inventory', 'management')
      then 'Manutenção' else origin_status end,
    'linkedMaintenance', linked_maintenance and origin_module in ('inventory', 'management'),
    'existingUpdatedAt', previous.updated_at
  );
end; $$;

create or replace function public.flux_confirm_movement(
  p_table_id uuid, p_existing_id uuid, p_payload jsonb,
  p_review_token text, p_request_id uuid, p_log_message text
) returns public.flux_items language plpgsql security definer set search_path = public as $$
declare
  prior public.flux_reviewed_movements%rowtype;
  saved public.flux_items%rowtype;
  reviewed jsonb;
  origin_module text := nullif(p_payload->>'source_module', '');
  origin_id uuid := nullif(p_payload->>'source_record_id', '')::uuid;
  movement_event_id uuid;
  source_updated timestamptz;
  source_status text;
  ticket_id uuid;
  ticket_updated timestamptz;
  log_text text;
  table_name text;
begin
  if p_request_id is null or nullif(p_review_token, '') is null then
    raise exception 'Reabra a revisão da movimentação antes de confirmar.';
  end if;
  select * into prior from public.flux_reviewed_movements
    where request_id = p_request_id for update;
  if found then
    if prior.payload_hash <> md5(p_payload::text) or prior.actor_id <> auth.uid() then
      raise exception 'Identificador de confirmação já utilizado para outros dados.';
    end if;
    select * into saved from public.flux_items where id = prior.flux_item_id;
    if not found then raise exception 'Movimentação confirmada, mas registro original indisponível.'; end if;
    return saved;
  end if;
  if p_existing_id is not null then
    perform 1 from public.flux_items where id = p_existing_id and table_id = p_table_id for update;
    if not found then raise exception 'Movimentação alterada. Revise novamente.'; end if;
  end if;
  if origin_module = 'inventory' then
    perform 1 from public.inventory_items where id = origin_id for update;
  elsif origin_module = 'management' then
    perform 1 from public.module_records where id = origin_id for update;
  elsif origin_module = 'control' then
    perform 1 from public.control_items where id = origin_id for update;
  elsif origin_module = 'flux' then
    perform 1 from public.flux_items where id = origin_id for update;
  end if;
  reviewed := public.flux_preview_movement(p_table_id, p_existing_id, p_payload);
  if reviewed->>'token' is distinct from p_review_token then
    raise exception 'Os dados mudaram desde a prévia. Revise a movimentação novamente.';
  end if;
  if p_existing_id is null then
    insert into public.flux_items
      (table_id, movement, equipment, model, brand, serial, tag,
       sender_company, destination_company, sender_responsible, receiver_responsible,
       send_date, received_date, shipping_type, reason, status, notes, position,
       source_module, source_record_id, inventory_item_id)
    values (p_table_id, p_payload->>'movement', p_payload->>'equipment',
      p_payload->>'model', p_payload->>'brand', p_payload->>'serial', p_payload->>'tag',
      p_payload->>'sender_company', p_payload->>'destination_company',
      p_payload->>'sender_responsible', p_payload->>'receiver_responsible',
      (p_payload->>'send_date')::date, (p_payload->>'received_date')::date,
      p_payload->>'shipping_type', p_payload->>'reason', p_payload->>'status',
      p_payload->>'notes', 0, origin_module, origin_id,
      nullif(p_payload->>'inventory_item_id', '')::uuid)
    returning * into saved;
  else
    update public.flux_items set
      table_id = p_table_id, movement = p_payload->>'movement',
      equipment = p_payload->>'equipment', model = p_payload->>'model',
      brand = p_payload->>'brand', serial = p_payload->>'serial', tag = p_payload->>'tag',
      sender_company = p_payload->>'sender_company',
      destination_company = p_payload->>'destination_company',
      sender_responsible = p_payload->>'sender_responsible',
      receiver_responsible = p_payload->>'receiver_responsible',
      send_date = (p_payload->>'send_date')::date,
      received_date = (p_payload->>'received_date')::date,
      shipping_type = p_payload->>'shipping_type', reason = p_payload->>'reason',
      status = p_payload->>'status', notes = p_payload->>'notes', position = 0,
      source_module = origin_module, source_record_id = origin_id,
      inventory_item_id = nullif(p_payload->>'inventory_item_id', '')::uuid
    where id = p_existing_id returning * into saved;
  end if;
  select name into table_name from public.module_tables where id = p_table_id;
  if reviewed->>'linkedMaintenance' = 'true' and origin_module = 'management' then
    select id into movement_event_id from public.equipment_events
      where source_module = 'flux' and source_event_key = 'management-maintenance:' || saved.id::text;
  else
    insert into public.equipment_events
      (source_module, source_event_key, source_id, inventory_item_id, action,
       previous_status, new_status, origin_location, destination_location,
       affected_modules, metadata, actor_id)
    values ('flux', 'reviewed:' || p_request_id::text, saved.id, saved.inventory_item_id,
      case when reviewed->>'linkedMaintenance' = 'true' then 'Envio para manutenção'
        else saved.movement || ' — ' || saved.reason end,
      reviewed->>'sourceStatus', reviewed->>'newSourceStatus',
      saved.sender_company, saved.destination_company,
      case when reviewed->>'linkedMaintenance' = 'true'
        then jsonb_build_array('flux', origin_module, 'control')
        else jsonb_build_array('flux') end,
      jsonb_build_object('fluxItemId', saved.id, 'requestId', p_request_id,
        'sourceModule', origin_module, 'sourceRecordId', origin_id), auth.uid())
      returning id into movement_event_id;
    log_text := left(coalesce(nullif(btrim(p_log_message), ''),
      case when p_existing_id is null then 'Movimentação confirmada no Flux.'
        else 'Movimentação atualizada no Flux.' end), 500);
    insert into public.flux_item_logs (flux_item_id, action, message, event_id)
      values (saved.id, case when p_existing_id is null then 'create' else 'update' end,
        log_text, movement_event_id);
    if reviewed->>'linkedMaintenance' = 'true' and origin_module = 'inventory' then
      update public.equipment_sync_events set event_id = movement_event_id
        where source_module = 'flux' and source_id = saved.id and event_type = 'maintenance';
      update public.inventory_item_logs set event_id = movement_event_id
        where source_module = 'flux' and source_log_id = saved.id and event_id is null;
    end if;
    insert into public.equipment_event_effects
      (event_id, module, status, attempts, processed_at)
      values (movement_event_id, 'flux', 'applied', 1, now());
    if reviewed->>'linkedMaintenance' = 'true' then
      insert into public.equipment_event_effects
        (event_id, module, status, attempts, processed_at)
        values (movement_event_id, origin_module, 'applied', 1, now()),
               (movement_event_id, 'control', 'applied', 1, now());
    end if;
    update public.equipment_events
      set processing_result = jsonb_build_object('status', 'applied', 'fluxItemId', saved.id)
      where id = movement_event_id;
  end if;
  if movement_event_id is null then
    raise exception 'A movimentação não confirmou o evento de integração. Nenhuma alteração será mantida.';
  end if;
  insert into public.sync_events (module, operation, details, event_id)
    values ('flux', case when p_existing_id is null then 'create' else 'update' end,
      jsonb_build_object('itemId', saved.id, 'tableId', saved.table_id,
        'tableName', table_name, 'equipment', saved.equipment,
        'tag', saved.tag, 'serial', saved.serial, 'status', saved.status,
        'description', coalesce(nullif(btrim(p_log_message), ''), 'Movimentação confirmada.'),
        'targetUrl', format('flux.html?table=%s&item=%s', saved.table_id, saved.id)), movement_event_id);
  update public.module_tables set position = position + 1 where module = 'flux';
  update public.module_tables set position = 0 where id = p_table_id;
  if origin_module = 'inventory' then
    select status, updated_at into source_status, source_updated
      from public.inventory_items where id = origin_id;
    select id into ticket_id from public.control_items where inventory_item_id = origin_id
      order by updated_at desc limit 1;
  elsif origin_module = 'management' then
    select payload->>'status', updated_at into source_status, source_updated
      from public.module_records where id = origin_id;
    select id into ticket_id from public.control_items where management_record_id = origin_id
      order by updated_at desc limit 1;
  end if;
  if reviewed->>'linkedMaintenance' = 'true' and
    (source_status is distinct from 'Manutenção' or ticket_id is null or
     not exists (select 1 from public.control_items
       where id = ticket_id and status = 'Em manutenção')) then
    raise exception 'O equipamento ou chamado não confirmou a manutenção. Nenhuma alteração será mantida.';
  end if;
  if reviewed->>'linkedMaintenance' = 'true' and origin_module = 'inventory' and
    not exists (select 1 from public.equipment_sync_events where source_module = 'flux'
      and source_id = saved.id and event_type = 'maintenance'
      and event_id = movement_event_id) then
    raise exception 'O vínculo patrimonial não foi confirmado. Nenhuma alteração será mantida.';
  end if;
  if ticket_id is not null then
    select updated_at into ticket_updated from public.control_items where id = ticket_id;
  end if;
  insert into public.flux_reviewed_movements
    (request_id, flux_item_id, payload_hash, is_creation, source_module, source_record_id,
     source_status_before, source_status_after, source_updated_at_after,
     flux_updated_at_after, control_item_id, control_updated_at_after,
     control_preexisting, event_id, actor_id)
    values (p_request_id, saved.id, md5(p_payload::text), p_existing_id is null, origin_module, origin_id,
      reviewed->>'sourceStatus', source_status, source_updated,
      saved.updated_at, ticket_id, ticket_updated,
      (reviewed->>'controlItemId') is not null, movement_event_id, auth.uid());
  return saved;
end; $$;

revoke all on function public.flux_preview_movement(uuid, uuid, jsonb) from public, anon;
grant execute on function public.flux_preview_movement(uuid, uuid, jsonb) to authenticated;
revoke all on function public.flux_confirm_movement(uuid, uuid, jsonb, text, uuid, text) from public, anon;
grant execute on function public.flux_confirm_movement(uuid, uuid, jsonb, text, uuid, text) to authenticated;
commit;
