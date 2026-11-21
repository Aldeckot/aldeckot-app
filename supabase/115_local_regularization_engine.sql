-- ALDECKOT | Uma prévia e confirmação de localização para Inventário e Gestão TI.
-- Escopo inicial: periférico com slot livre. Conflitos exigem decisão posterior.
begin;

create table public.local_regularizations (
  request_id uuid primary key,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  request_hash text not null,
  event_id uuid not null references public.equipment_events(id) on delete restrict,
  intent text not null check (intent in ('correction','movement','return')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.local_regularizations enable row level security;
revoke all on public.local_regularizations from public, anon, authenticated;
grant select on public.local_regularizations to authenticated;
create policy "Contas ativas leem regularizações" on public.local_regularizations
  for select to authenticated using (app.has_active_account());

create or replace function public.preview_local_regularization(
  p_item_id uuid, p_target_location text, p_target_sector text, p_status text,
  p_intent text
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  item public.inventory_items%rowtype;
  peripheral_type text;
  target_id uuid;
  target_updated timestamptz;
  position_count integer;
  occupants jsonb := '[]'::jsonb;
  management_occupants jsonb := '[]'::jsonb;
  linked_positions jsonb := '[]'::jsonb;
  target_is_pdv boolean := btrim(coalesce(p_target_location, '')) ~* '^PDV[[:space:]]+[0-9]+$';
  blocked boolean := false;
  reason text := '';
  review_token text;
begin
  if auth.uid() is null or p_item_id is null or p_intent not in ('correction','movement','return')
    or p_status not in ('Ativo','Reserva','Manutenção','Defeito')
    or nullif(btrim(coalesce(p_target_location, '')), '') is null
    or nullif(btrim(coalesce(p_target_sector, '')), '') is null then
    raise exception 'Informe equipamento, local, status e tipo de regularização.';
  end if;
  select * into item from public.inventory_items where id = p_item_id;
  if not found then raise exception 'Equipamento não encontrado no Inventário.'; end if;
  if not coalesce(app.can_manage_module_table(item.table_id, 'inventory', 'update'), false) then
    raise exception 'Sem permissão para regularizar este equipamento.';
  end if;
  peripheral_type := app.inventory_tag_peripheral_type(item.tag);
  if peripheral_type is null then
    blocked := true; reason := 'A TAG ainda não identifica um tipo de periférico instalável.';
  end if;
  if target_is_pdv and p_status <> 'Ativo' then
    blocked := true; reason := 'Somente periféricos Ativos podem ocupar um slot de PDV.';
  end if;
  if not target_is_pdv and p_status = 'Ativo'
    and app.inventory_location_is_unassigned(p_target_location) then
    blocked := true; reason := 'Equipamento Ativo precisa de local de instalação real.';
  end if;
  select count(*), min(r.id::text)::uuid into position_count, target_id
    from public.module_records r join public.module_tables t on t.id = r.table_id
    where t.module = 'management' and
      app.inventory_installation_location_key(r.payload->>'terminal') =
        app.inventory_installation_location_key(p_target_location)
      and r.payload->>'terminal' ~* '^PDV[[:space:]]+[0-9]+$';
  if target_is_pdv and position_count <> 1 then
    blocked := true; reason := 'PDV de destino inexistente ou ambíguo.';
  end if;
  if target_id is not null then
    select updated_at into target_updated from public.module_records where id = target_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'equipment', i.equipment,
    'tag', i.tag, 'serial', i.serial, 'status', i.status, 'location', i.location,
    'updatedAt', i.updated_at) order by i.id), '[]'::jsonb)
    into occupants from public.inventory_items i
    where i.id <> item.id and i.status = 'Ativo'
      and peripheral_type is not null
      and app.inventory_tag_peripheral_type(i.tag) = peripheral_type
      and app.inventory_installation_location_key(i.location) =
        app.inventory_installation_location_key(p_target_location);
  if target_id is not null then
    select coalesce(jsonb_agg(peripheral.value), '[]'::jsonb)
      into management_occupants
      from public.module_records r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.payload->'peripherals') = 'array'
          then r.payload->'peripherals' else '[]'::jsonb end) peripheral(value)
      where r.id = target_id
        and lower(btrim(coalesce(peripheral.value->>'type', peripheral.value->>'tipo', '')))
          = lower(btrim(peripheral_type))
        and (peripheral.value->>'sourceItemId') is distinct from item.id::text;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('positionId', r.id,
    'terminal', r.payload->>'terminal', 'updatedAt', r.updated_at)), '[]'::jsonb)
    into linked_positions from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.payload->'peripherals') = 'array'
        then r.payload->'peripherals' else '[]'::jsonb end) peripheral(value)
    where peripheral.value->>'sourceItemId' = item.id::text;
  if jsonb_array_length(linked_positions) > 1 then
    blocked := true; reason := 'Este periférico aparece em mais de uma posição da Gestão TI.';
  end if;
  if target_is_pdv and (jsonb_array_length(occupants) > 0 or
      jsonb_array_length(management_occupants) > 0) then
    blocked := true; reason := 'O slot do PDV está ocupado. Revise o equipamento atual e escolha seu destino.';
  end if;
  review_token := md5(concat_ws('|', item.id, item.updated_at,
    p_target_location, p_target_sector, p_status, p_intent,
    target_id, target_updated, occupants::text,
    management_occupants::text, linked_positions::text));
  return jsonb_build_object('token', review_token, 'blocked', blocked,
    'reason', reason, 'intent', p_intent, 'peripheralType', peripheral_type,
    'item', jsonb_build_object('id', item.id, 'equipment', item.equipment,
      'tag', item.tag, 'serial', item.serial, 'status', item.status,
      'sector', item.sector, 'location', item.location, 'updatedAt', item.updated_at),
    'target', jsonb_build_object('location', p_target_location,
      'sector', p_target_sector, 'status', p_status, 'positionId', target_id),
    'occupants', occupants, 'managementOccupants', management_occupants,
    'linkedPositions', linked_positions,
    'affectedModules', jsonb_build_array('inventory', 'management'));
end; $$;

create or replace function public.confirm_local_regularization(
  p_item_id uuid, p_target_location text, p_target_sector text, p_status text,
  p_intent text, p_reason text, p_review_token text, p_request_id uuid
) returns public.inventory_items language plpgsql security definer
  set search_path = public, app, pg_temp as $$
declare
  prior public.local_regularizations%rowtype;
  current_item public.inventory_items%rowtype;
  saved public.inventory_items%rowtype;
  preview jsonb;
  request_hash text;
  event_action text;
begin
  if auth.uid() is null or p_item_id is null or p_request_id is null
    or nullif(p_review_token, '') is null
    or char_length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'Revise o local e informe um motivo (5 a 500 caracteres).';
  end if;
  request_hash := md5(concat_ws('|', p_item_id, p_target_location,
    p_target_sector, p_status, p_intent, btrim(p_reason), p_review_token));
  select * into prior from public.local_regularizations where request_id = p_request_id;
  if found then
    if prior.inventory_item_id <> p_item_id or prior.request_hash <> request_hash
      or prior.actor_id <> auth.uid() then
      raise exception 'Identificador de regularização já usado com outros dados.';
    end if;
    select * into saved from public.inventory_items where id = p_item_id;
    return saved;
  end if;
  lock table public.inventory_items, public.module_records in share row exclusive mode;
  select * into current_item from public.inventory_items where id = p_item_id for update;
  preview := public.preview_local_regularization(p_item_id, p_target_location,
    p_target_sector, p_status, p_intent);
  if preview->>'token' is distinct from p_review_token then
    raise exception 'O equipamento ou PDV mudou desde a prévia. Revise novamente.';
  end if;
  if preview->>'blocked' = 'true' then
    raise exception '%', preview->>'reason';
  end if;
  if current_item.location is not distinct from p_target_location
    and current_item.sector is not distinct from p_target_sector
    and current_item.status is not distinct from p_status then
    raise exception 'Nenhuma mudança de local, setor ou status foi identificada.';
  end if;
  if current_item.location is not distinct from p_target_location then
    raise exception 'Esta operação exige mudança de Local; use a edição normal para outros campos.';
  end if;
  select * into saved from public.inventory_save_pdv_peripheral(p_item_id,
    jsonb_build_object('location', p_target_location, 'sector', p_target_sector,
      'status', p_status), current_item.updated_at, p_reason, p_request_id);
  event_action := case p_intent when 'correction' then 'Correção cadastral de local'
    when 'return' then 'Regularização após retorno'
    else 'peripheral-transfer' end;
  update public.equipment_events set action = event_action,
    metadata = metadata || jsonb_build_object('regularizationIntent', p_intent,
      'requestId', p_request_id)
    where id = p_request_id and inventory_item_id = p_item_id;
  if not found then raise exception 'A operação não produziu evento correlacionado.'; end if;
  if p_intent = 'correction' then
    update public.inventory_item_logs set message = left(format(
      'Correção cadastral de local: %s → %s. Motivo: %s.',
      current_item.location, p_target_location, btrim(p_reason)), 500)
      where event_id = p_request_id and inventory_item_id = p_item_id;
  end if;
  insert into public.local_regularizations
    (request_id, inventory_item_id, request_hash, event_id, intent, actor_id)
    values (p_request_id, p_item_id, request_hash, p_request_id, p_intent, auth.uid());
  return saved;
end; $$;

revoke all on function public.preview_local_regularization(uuid,text,text,text,text)
  from public, anon;
grant execute on function public.preview_local_regularization(uuid,text,text,text,text)
  to authenticated;
revoke all on function public.confirm_local_regularization(uuid,text,text,text,text,text,text,uuid)
  from public, anon;
grant execute on function public.confirm_local_regularization(uuid,text,text,text,text,text,text,uuid)
  to authenticated;
commit;
