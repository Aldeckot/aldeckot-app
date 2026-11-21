-- ALDECKOT | Prévia coerente com a confirmação e dependência mensal de Manutenção.
begin;
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
  if item.location is not distinct from p_target_location then
    blocked := true; reason := 'Nenhuma mudança de Local foi identificada.';
  elsif not target_is_pdv and
    btrim(coalesce(item.location, '')) !~* '^PDV[[:space:]]+[0-9]+$' then
    blocked := true; reason := 'Esta conferência exige mudança de Local envolvendo um PDV.';
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

create or replace function public.preview_local_replacement(
  p_incoming_id uuid, p_outgoing_id uuid, p_removed_status text,
  p_removed_location text, p_removed_sector text
) returns jsonb language plpgsql stable security definer set search_path=public,app,pg_temp as $$
declare
  incoming public.inventory_items%rowtype;
  outgoing public.inventory_items%rowtype;
  slot jsonb;
  reason text := '';
  token text;
begin
  if auth.uid() is null or p_incoming_id is null or p_outgoing_id is null
    or p_incoming_id = p_outgoing_id or p_removed_status not in
      ('Reserva','Manutenção','Defeito','Inativo')
    or nullif(btrim(coalesce(p_removed_location,'')),'') is null
    or nullif(btrim(coalesce(p_removed_sector,'')),'') is null then
    raise exception 'Escolha dois equipamentos, status, local e setor do retirado.';
  end if;
  select * into incoming from public.inventory_items where id=p_incoming_id;
  select * into outgoing from public.inventory_items where id=p_outgoing_id;
  if incoming.id is null or outgoing.id is null then
    raise exception 'Equipamento não encontrado no Inventário.';
  end if;
  if not app.can_manage_module_table(incoming.table_id,'inventory','update')
    or not app.can_manage_module_table(outgoing.table_id,'inventory','update') then
    raise exception 'Sem permissão para substituir estes equipamentos.';
  end if;
  if incoming.table_id <> outgoing.table_id then
    reason := 'Os equipamentos precisam estar na mesma categoria do Inventário.';
  elsif outgoing.status <> 'Ativo' or incoming.status <> 'Reserva' then
    reason := 'O retirado deve estar Ativo e o substituto em Reserva.';
  elsif app.inventory_tag_peripheral_type(outgoing.tag) is null or
    app.inventory_tag_peripheral_type(outgoing.tag) is distinct from
      app.inventory_tag_peripheral_type(incoming.tag) then
    reason := 'Os dois equipamentos precisam ser periféricos do mesmo tipo.';
  elsif btrim(outgoing.location) !~* '^PDV[[:space:]]+[0-9]+$' or
    btrim(incoming.location) ~* '^PDV[[:space:]]+[0-9]+$' then
    reason := 'O retirado precisa ocupar um PDV e o substituto deve estar fora de um PDV.';
  elsif btrim(p_removed_location) ~* '^PDV[[:space:]]+[0-9]+$' then
    reason := 'Escolha um local físico fora dos PDVs para o equipamento retirado.';
  end if;
  if reason = '' and p_removed_status = 'Manutenção' and not exists (
    select 1 from public.module_tables t where t.module='control'
      and lower(btrim(t.name))=lower(app.current_control_maintenance_table_name())
  ) then
    reason := 'Crie a tabela mensal atual no Controle TI antes de enviar o retirado para Manutenção.';
  end if;
  slot := public.preview_local_regularization(incoming.id,
    outgoing.location, outgoing.sector, 'Ativo', 'movement');
  if reason = '' and (
    (slot->'target'->>'positionId') is null or
    jsonb_array_length(slot->'occupants') <> 1 or
    slot->'occupants'->0->>'id' <> outgoing.id::text or
    jsonb_array_length(slot->'managementOccupants') <> 1 or
    slot->'managementOccupants'->0->>'sourceItemId' is distinct from outgoing.id::text
  ) then
    reason := 'O slot apresenta vínculos divergentes; confira o PDV antes de substituir.';
  end if;
  if reason = '' and jsonb_array_length(slot->'linkedPositions') > 0 then
    reason := 'O substituto já aparece vinculado a uma posição da Gestão TI.';
  end if;
  token := md5(concat_ws('|', slot->>'token', incoming.id, incoming.updated_at,
    outgoing.id, outgoing.updated_at, p_removed_status, p_removed_location,
    p_removed_sector));
  return jsonb_build_object('token',token,'blocked',reason<>'','reason',reason,
    'incoming',jsonb_build_object('id',incoming.id,'equipment',incoming.equipment,
      'tag',incoming.tag,'serial',incoming.serial,'status',incoming.status,
      'location',incoming.location,'sector',incoming.sector),
    'outgoing',jsonb_build_object('id',outgoing.id,'equipment',outgoing.equipment,
      'tag',outgoing.tag,'serial',outgoing.serial,'status',outgoing.status,
      'location',outgoing.location,'sector',outgoing.sector),
    'target',slot->'target','removedFinal',jsonb_build_object(
      'status',p_removed_status,'location',p_removed_location,'sector',p_removed_sector),
    'affectedModules',case when p_removed_status='Manutenção'
      then jsonb_build_array('inventory','management','control')
      else jsonb_build_array('inventory','management') end);
end; $$;

commit;
