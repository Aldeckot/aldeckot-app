-- ALDECKOT | Conclusão de periférico com destino físico conferido.
begin;

create or replace function public.preview_control_peripheral_completion(
  p_control_item_id uuid, p_equipment_status text,
  p_target_location text, p_target_sector text
) returns jsonb language plpgsql stable security definer
  set search_path=public,app,pg_temp as $$
declare
  ticket public.control_items%rowtype;
  item public.inventory_items%rowtype;
  slot jsonb;
  links jsonb;
  blocked boolean := false;
  reason text := '';
  target_is_pdv boolean := btrim(coalesce(p_target_location,'')) ~* '^PDV[[:space:]]+[0-9]+$';
  review_token text;
begin
  if auth.uid() is null or p_control_item_id is null
    or p_equipment_status not in ('Ativo','Reserva')
    or nullif(btrim(coalesce(p_target_location,'')),'') is null
    or nullif(btrim(coalesce(p_target_sector,'')),'') is null
    or p_target_location is distinct from btrim(p_target_location)
    or p_target_sector is distinct from btrim(p_target_sector) then
    raise exception 'Informe chamado, condição final, Local e Setor.';
  end if;
  select c.* into ticket from public.control_items c
    join public.module_tables t on t.id=c.table_id and t.module='control'
    where c.id=p_control_item_id;
  if ticket.id is null or ticket.inventory_item_id is null then
    raise exception 'Este chamado não está vinculado a um periférico do Inventário.';
  end if;
  select * into item from public.inventory_items where id=ticket.inventory_item_id;
  if item.id is null or app.inventory_tag_peripheral_type(item.tag) is null then
    raise exception 'Periférico de origem não encontrado ou sem tipo instalável.';
  end if;
  if not coalesce(app.can_manage_module_table(ticket.table_id,'control','update'),false)
    or not coalesce(app.can_manage_module_table(item.table_id,'inventory','update'),false) then
    raise exception 'Sem permissão para concluir este chamado e atualizar o Inventário.';
  end if;
  if ticket.status not in ('Em manutenção','Aguardando avaliação')
    or item.status <> 'Manutenção' then
    blocked := true; reason := 'O chamado ou o equipamento não está em Manutenção.';
  elsif p_equipment_status='Ativo' and not target_is_pdv then
    blocked := true; reason := 'Escolha um PDV de instalação para ativar este periférico.';
  elsif p_equipment_status='Reserva' and target_is_pdv then
    blocked := true; reason := 'Um periférico em Reserva deve ficar fora dos PDVs.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('positionId',r.id,
    'terminal',r.payload->>'terminal','updatedAt',r.updated_at) order by r.id),
    '[]'::jsonb) into links
    from public.module_records r
    join public.module_tables t on t.id=r.table_id and t.module='management'
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.payload->'peripherals')='array'
        then r.payload->'peripherals' else '[]'::jsonb end) p(value)
    where p.value->>'sourceItemId'=item.id::text;
  if jsonb_array_length(links)>1 then
    blocked := true; reason := 'O periférico está vinculado a mais de uma posição.';
  end if;
  if target_is_pdv then
    slot := public.preview_local_regularization(item.id,p_target_location,
      p_target_sector,'Ativo','return');
    if (slot->'target'->>'positionId') is null or
      jsonb_array_length(slot->'occupants')>0 or
      jsonb_array_length(slot->'managementOccupants')>0 or
      (slot->>'blocked')='true' and (slot->>'reason')<>'Nenhuma mudança de Local foi identificada.' then
      blocked := true;
      reason := coalesce(nullif(slot->>'reason',''),
        'O slot do PDV não está livre para este periférico.');
    end if;
  end if;
  review_token := md5(concat_ws('|',ticket.id,ticket.updated_at,item.id,
    item.updated_at,p_equipment_status,p_target_location,p_target_sector,
    links::text,slot->>'token'));
  return jsonb_build_object('token',review_token,'blocked',blocked,'reason',reason,
    'controlItemId',ticket.id,
    'item',jsonb_build_object('id',item.id,'equipment',item.equipment,
      'tag',item.tag,'serial',item.serial,'status',item.status,
      'location',item.location,'sector',item.sector),
    'target',jsonb_build_object('status',p_equipment_status,
      'location',p_target_location,'sector',p_target_sector),
    'linkedPositions',links,'occupants',coalesce(slot->'occupants','[]'::jsonb),
    'managementOccupants',coalesce(slot->'managementOccupants','[]'::jsonb),
    'affectedModules',jsonb_build_array('control','inventory','management'));
end; $$;

create or replace function public.complete_control_peripheral_with_destination(
  p_control_item_id uuid, p_equipment_status text,
  p_target_location text, p_target_sector text, p_reason text,
  p_review_token text, p_request_id uuid,
  p_control_fields jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
  set search_path=public,app,pg_temp as $$
declare
  ticket public.control_items%rowtype;
  item public.inventory_items%rowtype;
  review jsonb;
  prior public.equipment_events%rowtype;
  result jsonb;
  movement_id uuid;
  request_hash text;
begin
  if auth.uid() is null or p_request_id is null or
    nullif(p_review_token,'') is null or
    char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 or
    p_control_fields is null or jsonb_typeof(p_control_fields)<>'object' then
    raise exception 'Confira o destino e informe um motivo (5 a 500 caracteres).';
  end if;
  request_hash := md5(concat_ws('|',p_control_item_id,p_equipment_status,
    p_target_location,p_target_sector,btrim(p_reason),p_review_token,p_control_fields::text));
  perform pg_advisory_xact_lock(89120,hashtext(p_request_id::text));
  select * into prior from public.equipment_events
    where source_module='control' and
      source_event_key='maintenance-complete:'||p_request_id::text;
  if found then
    select * into item from public.inventory_items where id=prior.inventory_item_id;
    if prior.actor_id<>auth.uid() or
      prior.metadata->>'destinationRequestHash' is distinct from request_hash or
      item.status is distinct from p_equipment_status or
      item.location is distinct from p_target_location or
      item.sector is distinct from p_target_sector then
      raise exception 'A conclusão já foi registrada com outros dados ou o equipamento mudou.';
    end if;
    return jsonb_build_object('eventId',prior.id,'alreadyApplied',true,
      'inventoryItemId',item.id);
  end if;
  lock table public.inventory_items,public.module_records,public.control_items
    in share row exclusive mode;
  review := public.preview_control_peripheral_completion(p_control_item_id,
    p_equipment_status,p_target_location,p_target_sector);
  if review->>'token' is distinct from p_review_token then
    raise exception 'O chamado, equipamento ou PDV mudou. Confira o destino novamente.';
  end if;
  if review->>'blocked'='true' then raise exception '%',review->>'reason'; end if;
  select * into ticket from public.control_items where id=p_control_item_id for update;
  select * into item from public.inventory_items
    where id=ticket.inventory_item_id for update;
  movement_id := md5(p_request_id::text||':'||item.id::text)::uuid;
  if item.location is distinct from p_target_location then
    perform set_config('app.inventory_pdv_movement_id',movement_id::text,true);
    perform set_config('app.inventory_pdv_movement_reason',btrim(p_reason),true);
  end if;
  update public.inventory_items set location=btrim(p_target_location),
    sector=btrim(p_target_sector) where id=item.id and
    (location is distinct from btrim(p_target_location)
      or sector is distinct from btrim(p_target_sector));
  perform set_config('app.inventory_pdv_movement_id','',true);
  perform set_config('app.inventory_pdv_movement_reason','',true);
  result := public.complete_control_maintenance(p_control_item_id,
    p_equipment_status,p_request_id,
    p_control_fields||jsonb_build_object('sector',btrim(p_target_sector)));
  update public.equipment_events set
    previous_location=item.location,new_location=btrim(p_target_location),
    metadata=metadata||jsonb_build_object('destinationRequestHash',request_hash,
      'destinationReason',btrim(p_reason),'targetSector',btrim(p_target_sector),
      'movementEventId',case when exists(select 1 from public.equipment_events
        where id=movement_id) then movement_id::text else null end)
    where id=(result->>'eventId')::uuid and source_module='control';
  if not found then raise exception 'A conclusão não produziu evento correlacionado.'; end if;
  if exists(select 1 from public.equipment_events where id=movement_id) then
    update public.equipment_events set metadata=metadata||
      jsonb_build_object('controlRequestId',p_request_id,
        'controlEventId',result->>'eventId') where id=movement_id;
  elsif item.location is distinct from p_target_location then
    insert into public.inventory_item_logs(inventory_item_id,action,message,event_id)
      values(item.id,'update',left(format('Destino após manutenção: %s → %s. Motivo: %s.',
        item.location,btrim(p_target_location),btrim(p_reason)),500),
        (result->>'eventId')::uuid);
  end if;
  return result||jsonb_build_object('alreadyApplied',false,
    'inventoryItemId',item.id,'movementEventId',case when exists(
      select 1 from public.equipment_events where id=movement_id)
      then movement_id else null end);
end; $$;

revoke all on function public.preview_control_peripheral_completion(uuid,text,text,text)
  from public,anon;
grant execute on function public.preview_control_peripheral_completion(uuid,text,text,text)
  to authenticated;
revoke all on function public.complete_control_peripheral_with_destination(
  uuid,text,text,text,text,text,uuid,jsonb) from public,anon;
grant execute on function public.complete_control_peripheral_with_destination(
  uuid,text,text,text,text,text,uuid,jsonb) to authenticated;
commit;
