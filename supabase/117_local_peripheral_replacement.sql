-- ALDECKOT | Substituição revisada com destino explícito para o periférico retirado.
begin;
alter table public.inventory_replacements drop constraint if exists inventory_replacements_removed_status_check;
alter table public.inventory_replacements add constraint inventory_replacements_removed_status_check check (removed_status in ('Manutenção','Defeito','Troca','Inativo','Reserva'));
alter table public.inventory_replacements add column if not exists removed_new_sector text not null default '';
create or replace function public.inventory_replace_equipment(
  p_removed_item_id uuid, p_installed_item_id uuid, p_removed_status text,
  p_removed_location text, p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  outgoing public.inventory_items%rowtype;
  incoming public.inventory_items%rowtype;
  result_id uuid := gen_random_uuid();
  outgoing_label text;
  incoming_label text;
begin
  if p_removed_item_id is null or p_installed_item_id is null
    or p_removed_item_id=p_installed_item_id then
    raise exception 'Selecione dois equipamentos físicos diferentes.';
  end if;
  if p_removed_status is null or p_removed_status not in ('Reserva','Manutenção','Defeito','Inativo')
    or nullif(btrim(coalesce(p_removed_location,'')),'') is null
    or nullif(btrim(coalesce(p_reason,'')),'') is null
    or char_length(btrim(p_reason))>500 then
    raise exception 'Informe destino, condição final e motivo da substituição.';
  end if;
  -- Mesma ordem de bloqueio em toda chamada reduz deadlocks entre trocas concorrentes.
  perform 1 from public.inventory_items
    where id in (p_removed_item_id,p_installed_item_id) order by id for update;
  select * into outgoing from public.inventory_items where id=p_removed_item_id;
  select * into incoming from public.inventory_items where id=p_installed_item_id;
  if outgoing.id is null or incoming.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not coalesce(app.can_manage_module_table(outgoing.table_id,'inventory','update'),false)
    or not coalesce(app.can_manage_module_table(incoming.table_id,'inventory','update'),false) then
    raise exception 'Sem permissão para substituir equipamentos do Inventário.';
  end if;
  if outgoing.table_id<>incoming.table_id then
    raise exception 'A substituição exige equipamentos da mesma tabela do Inventário.';
  end if;
  if outgoing.status<>'Ativo' or incoming.status<>'Reserva' then
    raise exception 'O equipamento retirado deve estar Ativo e o substituto em Reserva.';
  end if;
  if nullif(btrim(outgoing.location),'') is null then
    raise exception 'O equipamento retirado precisa ter um local físico.';
  end if;
  outgoing_label:=coalesce(nullif(btrim(outgoing.tag),''),nullif(btrim(outgoing.serial),''),outgoing.equipment);
  incoming_label:=coalesce(nullif(btrim(incoming.tag),''),nullif(btrim(incoming.serial),''),incoming.equipment);

  perform set_config('app.inventory_pdv_operation_id',result_id::text,true);
  perform set_config('app.inventory_pdv_movement_reason',btrim(p_reason),true);
  update public.inventory_items
    set status=p_removed_status,location=btrim(p_removed_location)
    where id=outgoing.id;
  -- O equipamento substituto assume setor e local do ativo atendido. A ramificação
  -- continua vinculada aos IDs originais; não clonamos identidade nem vínculos.
  update public.inventory_items
    set status='Ativo',location=outgoing.location,sector=outgoing.sector
    where id=incoming.id;
  perform set_config('app.inventory_pdv_operation_id','',true);
  perform set_config('app.inventory_pdv_movement_reason','',true);

  insert into public.inventory_replacements
    (id,removed_item_id,installed_item_id,removed_identity,installed_identity,
     removed_tag,installed_tag,previous_location,removed_location,removed_status,
     reason,actor_id,removed_sector,installed_previous_sector,installed_sector)
  values(result_id,outgoing.id,incoming.id,outgoing.id,incoming.id,
    outgoing_label,incoming_label,outgoing.location,btrim(p_removed_location),p_removed_status,
    btrim(p_reason),auth.uid(),coalesce(outgoing.sector,''),coalesce(incoming.sector,''),coalesce(outgoing.sector,''));

  insert into public.inventory_item_logs(inventory_item_id,action,message,event_id) values
    (outgoing.id,'update',left(format('%s saiu do setor %s e do local %s; condição: %s; destino: %s; substituída por %s. Motivo: %s',
      outgoing_label,coalesce(nullif(outgoing.sector,''),'não informado'),outgoing.location,
      p_removed_status,btrim(p_removed_location),incoming_label,btrim(p_reason)),500),
      (select id from public.equipment_events where source_module='inventory'
        and action='peripheral-transfer' and inventory_item_id=outgoing.id
        and metadata->>'operationId'=result_id::text)),
    (incoming.id,'update',left(format('%s instalada no setor %s e local %s (antes: setor %s, local %s), em substituição a %s. Motivo: %s',
      incoming_label,coalesce(nullif(outgoing.sector,''),'não informado'),outgoing.location,
      coalesce(nullif(incoming.sector,''),'não informado'),coalesce(nullif(incoming.location,''),'não informado'),
      outgoing_label,btrim(p_reason)),500),
      (select id from public.equipment_events where source_module='inventory'
        and action='peripheral-transfer' and inventory_item_id=incoming.id
        and metadata->>'operationId'=result_id::text));
  return result_id;
end;
$$;
revoke all on function public.inventory_replace_equipment(uuid,uuid,text,text,text) from public;
grant execute on function public.inventory_replace_equipment(uuid,uuid,text,text,text) to authenticated;

create table public.local_replacement_requests (
  request_id uuid primary key,
  incoming_item_id uuid not null references public.inventory_items(id) on delete restrict,
  outgoing_item_id uuid not null references public.inventory_items(id) on delete restrict,
  replacement_id uuid not null unique references public.inventory_replacements(id) on delete restrict,
  request_hash text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.local_replacement_requests enable row level security;
revoke all on public.local_replacement_requests from public, anon, authenticated;
grant select on public.local_replacement_requests to authenticated;
create policy "Contas ativas leem substituições locais" on public.local_replacement_requests
  for select to authenticated using (app.has_active_account());

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
    'affectedModules',jsonb_build_array('inventory','management','control'));
end; $$;

create or replace function public.confirm_local_replacement(
  p_incoming_id uuid, p_outgoing_id uuid, p_removed_status text,
  p_removed_location text, p_removed_sector text, p_reason text,
  p_review_token text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public,app,pg_temp as $$
declare
  prior public.local_replacement_requests%rowtype;
  review jsonb;
  replacement_id uuid;
  request_hash text;
  affected integer;
begin
  if auth.uid() is null or p_request_id is null or
    nullif(p_review_token,'') is null or
    char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Revise a substituição e informe um motivo (5 a 500 caracteres).';
  end if;
  request_hash := md5(concat_ws('|',p_incoming_id,p_outgoing_id,p_removed_status,
    p_removed_location,p_removed_sector,btrim(p_reason),p_review_token));
  perform pg_advisory_xact_lock(89117,hashtext(p_request_id::text));
  select * into prior from public.local_replacement_requests where request_id=p_request_id;
  if found then
    if prior.incoming_item_id<>p_incoming_id or prior.outgoing_item_id<>p_outgoing_id
      or prior.request_hash<>request_hash or prior.actor_id<>auth.uid() then
      raise exception 'Identificador de substituição já usado com outros dados.';
    end if;
    return jsonb_build_object('replacementId',prior.replacement_id,
      'alreadyApplied',true);
  end if;
  lock table public.inventory_items,public.module_records in share row exclusive mode;
  review := public.preview_local_replacement(p_incoming_id,p_outgoing_id,
    p_removed_status,p_removed_location,p_removed_sector);
  if review->>'token' is distinct from p_review_token then
    raise exception 'O equipamento ou PDV mudou desde a prévia. Revise novamente.';
  end if;
  if review->>'blocked'='true' then raise exception '%',review->>'reason'; end if;
  replacement_id := public.inventory_replace_equipment(p_outgoing_id,p_incoming_id,
    p_removed_status,p_removed_location,btrim(p_reason));
  update public.inventory_items set sector=btrim(p_removed_sector)
    where id=p_outgoing_id;
  update public.inventory_replacements set removed_new_sector=btrim(p_removed_sector)
    where id=replacement_id;
  update public.equipment_events set metadata=metadata || jsonb_build_object(
    'regularizationIntent','replacement','regularizationRequestId',p_request_id,
    'removedFinalSector',btrim(p_removed_sector))
    where source_module='inventory' and inventory_item_id in (p_outgoing_id,p_incoming_id)
      and metadata->>'operationId'=replacement_id::text;
  get diagnostics affected = row_count;
  if affected<>2 then
    raise exception 'A substituição não gerou dois eventos correlacionados.';
  end if;
  insert into public.local_replacement_requests
    (request_id,incoming_item_id,outgoing_item_id,replacement_id,request_hash,actor_id)
  values (p_request_id,p_incoming_id,p_outgoing_id,replacement_id,request_hash,auth.uid());
  return jsonb_build_object('replacementId',replacement_id,'alreadyApplied',false,
    'incomingItemId',p_incoming_id,'outgoingItemId',p_outgoing_id);
end; $$;

revoke all on function public.preview_local_replacement(uuid,uuid,text,text,text)
  from public,anon;
grant execute on function public.preview_local_replacement(uuid,uuid,text,text,text)
  to authenticated;
revoke all on function public.confirm_local_replacement(uuid,uuid,text,text,text,text,text,uuid)
  from public,anon;
grant execute on function public.confirm_local_replacement(uuid,uuid,text,text,text,text,text,uuid)
  to authenticated;
commit;
