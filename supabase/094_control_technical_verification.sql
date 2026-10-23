-- ALDECKOT | Acompanhamento de Verificando no Controle TI.
-- Extensão incremental da Home. NÃO aplicar sem autorização expressa.
-- Requer 093 e validação prévia em PostgreSQL isolado. Não faz backfill.
begin;

do $preflight$
begin
  if to_regprocedure('app.current_control_maintenance_table_name()') is null
    or to_regprocedure('app.can_manage_module_table(uuid,text,text)') is null
    or to_regprocedure('app.sync_inventory_maintenance_to_control(uuid)') is null
    or to_regprocedure('app.sync_management_record_to_control(uuid,jsonb)') is null
    or to_regclass('public.equipment_events') is null
    or to_regprocedure('app.inventory_installation_location_key(text)') is null then
    raise exception 'Dependências anteriores da Gestão TI/Controle TI ausentes. Nenhuma alteração aplicada.';
  end if;
end;
$preflight$;

alter table public.control_items
  add column followup_kind text not null default 'maintenance'
    check (followup_kind in ('maintenance','verification')),
  add column verification_inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  add column verification_computer_id uuid,
  add column verification_started_at timestamptz,
  add column verification_completed_at timestamptz;

alter table public.control_items add constraint control_verification_source_valid check (
  (followup_kind = 'maintenance' and verification_inventory_item_id is null and verification_computer_id is null)
  or (followup_kind = 'verification'
    and num_nonnulls(verification_inventory_item_id, verification_computer_id) = 1
    and inventory_item_id is null and management_record_id is null and supply_unit_id is null
    and verification_started_at is not null
    and status in ('Aguardando avaliação','Verificação concluída','Cancelado'))
);

-- Amplia apenas o estado de conclusão técnica do Controle TI.
do $status$
declare status_rule record;
begin
  for status_rule in select conname, pg_get_expr(conbin, conrelid) as expression
    from pg_constraint where conrelid = 'public.control_items'::regclass
      and contype = 'c' and conname = 'control_items_status_check'
  loop
    execute format('alter table public.control_items drop constraint %I', status_rule.conname);
    execute format('alter table public.control_items add constraint %I check ((%s) or status = %L)',
      status_rule.conname, status_rule.expression, 'Verificação concluída');
  end loop;
end;
$status$;
create unique index control_open_verification_inventory_unique
  on public.control_items (verification_inventory_item_id)
  where followup_kind = 'verification' and status = 'Aguardando avaliação';
create unique index control_open_verification_computer_unique
  on public.control_items (verification_computer_id)
  where followup_kind = 'verification' and status = 'Aguardando avaliação';

-- As funções antigas continuam responsáveis exclusivamente pela manutenção.
-- A view é privada e não concede acesso novo ao frontend.
create view app.maintenance_control_items with (security_invoker = true) as
  select * from public.control_items where followup_kind = 'maintenance';
revoke all on app.maintenance_control_items from public, anon, authenticated;

do $isolate$
declare signature text; routine_oid oid; definition text; body text; updated_body text;
begin
  foreach signature in array array[
    'app.sync_inventory_maintenance_to_control(uuid)',
    'app.sync_management_record_to_control(uuid,jsonb)'
  ] loop
    routine_oid := to_regprocedure(signature);
    select p.prosrc, pg_get_functiondef(p.oid) into body, definition
      from pg_proc p join pg_language l on l.oid = p.prolang
      where p.oid = routine_oid and l.lanname = 'plpgsql';
    if body is null or position('from public.control_items' in lower(body)) = 0 then
      raise exception 'Rotina % incompatível com a extensão de verificação.', signature;
    end if;
    updated_body := regexp_replace(body, 'from public[.]control_items', 'from app.maintenance_control_items', 'gi');
    execute replace(definition, body, updated_body);
  end loop;

  foreach signature in array array[
    'app.sync_inventory_status_from_control()',
    'app.sync_management_status_from_control()',
    'app.copy_control_log_to_inventory()',
    'app.copy_control_log_to_management()'
  ] loop
    routine_oid := to_regprocedure(signature);
    select p.prosrc, pg_get_functiondef(p.oid) into body, definition
      from pg_proc p join pg_language l on l.oid = p.prolang
      where p.oid = routine_oid and l.lanname = 'plpgsql';
    if body is null or body !~* '\mBEGIN\M' then
      raise exception 'Gatilho % incompatível com a extensão de verificação.', signature;
    end if;
    if signature like '%copy_control_log%' then
      updated_body := regexp_replace(body, '\mBEGIN\M',
        'BEGIN
  -- home_verification_094: histórico técnico copiado pela operação coordenada.
  if coalesce(current_setting(''app.verification_log_copy'',true),'''') = ''on''
    or exists (select 1 from public.control_items v where v.id = new.control_item_id
    and v.followup_kind = ''verification'') then return new; end if;', 'i');
    else
      updated_body := regexp_replace(body, '\mBEGIN\M',
        'BEGIN
  -- home_verification_094: verificação preserva o status operacional.
  if new.followup_kind = ''verification'' then return new; end if;', 'i');
    end if;
    execute replace(definition, body, updated_body);
  end loop;
end;
$isolate$;

create or replace function app.guard_control_verification()
returns trigger language plpgsql security definer set search_path = public, app, pg_temp as $$
declare source_exists boolean;
begin
  if tg_op = 'UPDATE' and (
    new.followup_kind is distinct from old.followup_kind
    or new.verification_inventory_item_id is distinct from old.verification_inventory_item_id
    or new.verification_computer_id is distinct from old.verification_computer_id
    or new.verification_started_at is distinct from old.verification_started_at) then
    raise exception 'O tipo e a identidade de um acompanhamento técnico são permanentes.';
  end if;
  if new.followup_kind <> 'verification' then
    if new.status = 'Verificação concluída' then raise exception 'Este registro não é uma verificação técnica.'; end if;
    return new;
  end if;
  if tg_op = 'INSERT' and coalesce(current_setting('app.verification_start_id',true),'')
      is distinct from coalesce(new.verification_inventory_item_id,new.verification_computer_id)::text then
    raise exception 'Inicie a verificação pelo equipamento no módulo de origem.';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
    and coalesce(current_setting('app.verification_completion_id', true),'') = '' then
    raise exception 'Use a conclusão de verificação para registrar o resultado técnico.';
  end if;
  select exists (
    select 1 from public.inventory_items i where i.id = new.verification_inventory_item_id
    union all
    select 1 from public.module_records r join public.module_tables t on t.id = r.table_id
    where t.module = 'management' and r.management_computer_id = new.verification_computer_id
  ) into source_exists;
  if not source_exists then raise exception 'A origem do acompanhamento técnico não foi encontrada.'; end if;
  return new;
end;
$$;
create trigger control_verification_identity_guard
  before insert or update on public.control_items
  for each row execute function app.guard_control_verification();


create or replace function app.record_reused_verification_start(
  p_ticket_id uuid,p_module text,p_source_id uuid,p_source jsonb,p_previous text
) returns void language plpgsql security definer set search_path = public,app,pg_temp as $$
declare root_event uuid; message text; previous_copy_context text;
begin
  if lower(btrim(coalesce(p_previous,'')))='verificando' then return; end if;
  message := 'Verificação técnica vinculada ao chamado já aberto; status e localização preservados.';
  insert into public.equipment_events(
    source_module,source_event_key,source_id,inventory_item_id,action,previous_status,new_status,
    previous_location,new_location,reason,affected_modules,metadata,actor_id
  ) values(
    'control','verification-observation:' || p_ticket_id::text || ':' || p_source_id::text || ':'
      || coalesce(p_source->>'updated_at',now()::text),
    p_ticket_id,case when p_module='inventory' then p_source_id end,
    'Verificação iniciada',p_source->>'status',p_source->>'status',p_source->>'location',p_source->>'location',
    message,jsonb_build_array('control',p_module),
    jsonb_build_object('controlItemId',p_ticket_id,'sourceModule',p_module,'sourceId',p_source_id,
      'computerId',case when p_module='management' then p_source_id end,
      'previousSituation',coalesce(nullif(p_previous,''),case when p_module='inventory' then 'Normal' else 'Em Uso' end),
      'physicalMovement',false,'reusedMaintenance',true),auth.uid()
  ) on conflict(source_module,source_event_key) do nothing returning id into root_event;
  if root_event is null then return; end if;
  previous_copy_context := coalesce(current_setting('app.verification_log_copy',true),'');
  perform set_config('app.verification_log_copy','on',true);
  insert into public.control_item_logs(control_item_id,action,message,event_id)
    values(p_ticket_id,'update',message,root_event);
  perform set_config('app.verification_log_copy',previous_copy_context,true);
  if p_module='inventory' then
    insert into public.inventory_item_logs(inventory_item_id,action,message,event_id)
      values(p_source_id,'update',message,root_event);
  end if;
  insert into public.equipment_event_effects(event_id,module,status,attempts,processed_at)
    values(root_event,'control','applied',1,now()),(root_event,p_module,'applied',1,now());
end;
$$;
revoke all on function app.record_reused_verification_start(uuid,text,uuid,jsonb,text) from public,anon,authenticated;

create or replace function app.finish_reused_verification()
returns trigger language plpgsql security definer set search_path = public,app,pg_temp as $$
declare observation public.equipment_events%rowtype; completion public.equipment_events%rowtype;
  source_row record; source_uuid uuid; origin_module text; source_data jsonb; restored_situation text;
begin
  if new.followup_kind <> 'maintenance' or new.status <> 'Manutenção concluída'
    or old.status is not distinct from new.status then return new; end if;
  select e.* into observation from public.equipment_events e
    where e.source_id=new.id and e.source_module='control' and e.action='Verificação iniciada'
      and e.metadata->>'reusedMaintenance'='true'
    order by e.created_at desc,e.id desc limit 1;
  if not found then return new; end if;
  select e.* into completion from public.equipment_events e
    where e.id::text=coalesce(current_setting('app.control_completion_event',true),'')
      and e.source_id=new.id and e.action='Manutenção concluída';
  if not found then raise exception 'Conclua o acompanhamento pelo fluxo confirmado do Controle TI.'; end if;
  source_uuid := (observation.metadata->>'sourceId')::uuid;
  origin_module := observation.metadata->>'sourceModule';
  if origin_module='inventory' then
    select * into source_row from public.inventory_items where id=source_uuid for update;
    if not found then raise exception 'Origem da verificação não encontrada.'; end if;
    source_data := to_jsonb(source_row);
  else
    select r.* into source_row from public.module_records r join public.module_tables t on t.id=r.table_id
      where t.module='management' and r.management_computer_id=source_uuid for update of r;
    if not found then raise exception 'Identidade do computador da verificação não encontrada.'; end if;
    source_data := source_row.payload;
  end if;
  if completion.metadata->>'sourceModule' is distinct from origin_module
    or completion.metadata->>'sourceId' is distinct from source_row.id::text then
    raise exception 'A identidade da verificação diverge da manutenção concluída.';
  end if;
  restored_situation := case when lower(btrim(coalesce(source_data->>'situation','')))='verificando'
    then observation.metadata->>'previousSituation' else source_data->>'situation' end;
  if restored_situation is null or lower(btrim(restored_situation))='verificando' then
    raise exception 'A situação anterior da investigação não é verificável.';
  end if;
  if source_data->>'situation' is distinct from restored_situation then
    if origin_module='inventory' then
      update public.inventory_items set situation=restored_situation where id=source_uuid;
    else
      update public.module_records set payload=jsonb_set(payload,'{situation}',to_jsonb(restored_situation),true)
        where id=source_row.id;
    end if;
  end if;
  update public.equipment_events set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
    'verificationResolved',true,'computerId',case when origin_module='management' then source_uuid end,
    'physicalMovement',false,'previousSituation',source_data->>'situation','newSituation',restored_situation)
    where id=completion.id;
  return new;
end;
$$;
create trigger control_reused_verification_completion
  after update of status on public.control_items for each row execute function app.finish_reused_verification();

create or replace function app.guard_open_verification_diagnosis()
returns trigger language plpgsql security definer set search_path = public as $$
declare source_uuid uuid; next_status text; previous_status text;
begin
  if tg_table_name='inventory_items' then
    source_uuid:=new.id;next_status:=new.status;previous_status:=old.status;
  else
    source_uuid:=new.management_computer_id;next_status:=new.payload->>'status';previous_status:=old.payload->>'status';
  end if;
  if next_status in ('Defeito','Manutenção') and next_status is distinct from previous_status
    and exists(select 1 from public.control_items c where c.followup_kind='verification'
      and c.status='Aguardando avaliação' and (c.verification_inventory_item_id=source_uuid or c.verification_computer_id=source_uuid)) then
    raise exception 'Registre o resultado e conclua a verificação aberta no Controle TI antes de confirmar Defeito ou Manutenção. Isso evita chamados duplicados.';
  end if;
  return new;
end;
$$;
create trigger inventory_open_verification_diagnosis_guard
  before update of status on public.inventory_items for each row execute function app.guard_open_verification_diagnosis();
create trigger management_open_verification_diagnosis_guard
  before update of payload on public.module_records for each row execute function app.guard_open_verification_diagnosis();

create or replace function app.sync_technical_verification(
  p_module text, p_source_id uuid, p_previous_situation text default null
) returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  source_row record; source_data jsonb; source_table uuid; source_owner uuid;
  ticket public.control_items%rowtype; control_table public.module_tables%rowtype;
  root_event uuid; root_key text; message text; previous_situation text; owner_required boolean;
begin
  if p_module = 'inventory' then
    select * into source_row from public.inventory_items where id = p_source_id for update;
    if not found then return null; end if;
    source_data := to_jsonb(source_row);
    source_table := source_row.table_id;
  elsif p_module = 'management' then
    select r.* into source_row from public.module_records r join public.module_tables t on t.id = r.table_id
      where t.module = 'management' and r.management_computer_id = p_source_id for update of r;
    if not found then return null; end if;
    source_data := source_row.payload || jsonb_build_object('updated_at',source_row.updated_at);
    source_table := source_row.table_id;
  else raise exception 'Origem técnica inválida.'; end if;
  if lower(btrim(coalesce(source_data ->> 'situation',''))) <> 'verificando' then return null; end if;
  perform pg_advisory_xact_lock(94194,hashtext(p_source_id::text));
  -- Um chamado de manutenção já aberto também pode acompanhar a investigação.
  select c.* into ticket from public.control_items c where
    (p_module = 'inventory' and (c.inventory_item_id = p_source_id
      or c.verification_inventory_item_id = p_source_id))
    or (p_module = 'management' and
      (c.verification_computer_id = p_source_id
        or c.management_record_id = source_row.id))
    order by (c.status in ('Em manutenção','Aguardando avaliação','Em sala')) desc,
      c.created_at desc, c.id limit 1;
  if found and ticket.status in ('Em manutenção','Aguardando avaliação','Em sala') then
    if ticket.followup_kind = 'verification' and
      (ticket.tag is distinct from coalesce(source_data ->> 'tag','')
        or ticket.serial is distinct from coalesce(source_data ->> 'serial','')) then
      update public.control_items set tag = coalesce(source_data ->> 'tag',''),
        serial = coalesce(source_data ->> 'serial',''),
        equipment = coalesce(nullif(source_data ->> 'equipment',''),'Equipamento')
      where id = ticket.id;
    end if;
    if ticket.followup_kind='maintenance' then
      perform app.record_reused_verification_start(ticket.id,p_module,p_source_id,source_data,p_previous_situation);
    end if;
    return ticket.id;
  end if;
  -- Uma edição cadastral não inventa o início de uma condição Verificando anterior à migração.
  if lower(btrim(coalesce(p_previous_situation,''))) = 'verificando' then return null; end if;
  -- Nenhum histórico fechado é reaberto. Uma nova investigação tem outro ID.
  select * into control_table from public.module_tables
    where module = 'control' and name = app.current_control_maintenance_table_name()
    order by created_at desc, id limit 1;
  if not found then
    raise exception 'Crie a tabela % no Controle TI antes de iniciar a verificação.',
      app.current_control_maintenance_table_name();
  end if;
  source_owner := coalesce(nullif(to_jsonb(control_table) ->> 'owner_id','')::uuid,auth.uid());
  previous_situation := coalesce(nullif(p_previous_situation,''),
    case when p_module = 'inventory' then 'Normal'
      when source_data ->> 'status' = 'Ativo' then 'Em Uso' else 'Em Sala' end);
  owner_required := exists(select 1 from pg_attribute where attrelid='public.control_items'::regclass
    and attname='owner_id' and not attisdropped);
  if owner_required and source_owner is null then
    raise exception 'Não foi possível identificar a conta da tabela de acompanhamento técnico.';
  end if;
  perform set_config('app.verification_start_id',p_source_id::text,true);
  execute 'insert into public.control_items (table_id,equipment,model,brand,tag,serial,sector,status,entry_date,'
    || 'followup_kind,verification_inventory_item_id,verification_computer_id,verification_started_at'
    || case when owner_required then ',owner_id' else '' end
    || ') values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13'
    || case when owner_required then ',$14' else '' end || ') returning *'
    into ticket using control_table.id,
    coalesce(nullif(source_data ->> 'equipment',''),'Equipamento'),
    coalesce(nullif(source_data ->> 'model',''),'Não informado'),coalesce(source_data ->> 'brand',''),
    coalesce(source_data ->> 'tag',''),coalesce(source_data ->> 'serial',''),
    coalesce(source_data ->> 'sector',''),'Aguardando avaliação',timezone('America/Sao_Paulo',now())::date,
    'verification',case when p_module = 'inventory' then p_source_id end,
    case when p_module = 'management' then p_source_id end,now(),source_owner;
  perform set_config('app.verification_start_id','',true);
  root_key := 'verification-start:' || ticket.id::text;
  message := 'Verificação técnica iniciada; status e localização do equipamento preservados.';
  insert into public.equipment_events (
    source_module,source_event_key,source_id,inventory_item_id,action,previous_status,new_status,
    previous_location,new_location,reason,affected_modules,metadata,actor_id
  ) values (
    'control',root_key,ticket.id,case when p_module = 'inventory' then p_source_id end,
    'Verificação iniciada',source_data ->> 'status',source_data ->> 'status',
    source_data ->> 'location',source_data ->> 'location',message,jsonb_build_array('control',p_module),
    jsonb_build_object('controlItemId',ticket.id,'sourceModule',p_module,'sourceId',p_source_id,
      'computerId',case when p_module = 'management' then p_source_id end,
      'previousSituation',previous_situation,'physicalMovement',false),auth.uid()
  ) returning id into root_event;
  insert into public.control_item_logs (control_item_id,action,message,event_id)
    values (ticket.id,'create',message,root_event);
  if p_module = 'inventory' then
    insert into public.inventory_item_logs (inventory_item_id,action,message,event_id)
      values (p_source_id,'update',message,root_event);
  end if;
  insert into public.equipment_event_effects (event_id,module,status,attempts,processed_at)
    values (root_event,'control','applied',1,now()),(root_event,p_module,'applied',1,now());
  return ticket.id;
end;
$$;
revoke all on function app.sync_technical_verification(text,uuid,text) from public, anon, authenticated;

create or replace function app.sync_verification_from_inventory()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if lower(btrim(coalesce(new.situation,''))) = 'verificando' then
    perform app.sync_technical_verification('inventory',new.id,
      case when tg_op = 'UPDATE' then old.situation else null end);
  end if;
  return new;
end;
$$;
create trigger inventory_technical_verification_sync
  after insert or update of situation,tag,serial on public.inventory_items
  for each row execute function app.sync_verification_from_inventory();

create or replace function app.sync_verification_from_management()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.management_computer_id is not null
    and lower(btrim(coalesce(new.payload ->> 'situation',''))) = 'verificando' then
    perform app.sync_technical_verification('management',new.management_computer_id,
      case when tg_op = 'UPDATE' and old.management_computer_id is distinct from new.management_computer_id then 'Verificando'
        when tg_op = 'UPDATE' then old.payload ->> 'situation' else null end);
  end if;
  return new;
end;
$$;
create trigger management_technical_verification_sync
  after insert or update of payload,management_computer_id on public.module_records
  for each row execute function app.sync_verification_from_management();

create or replace function app.guard_management_open_verification_activation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.management_computer_id is not null
    and new.payload ->> 'status' in ('Ativo','Reserva')
    and (old.management_computer_id is distinct from new.management_computer_id
      or old.payload ->> 'status' is distinct from new.payload ->> 'status')
    and exists (select 1 from public.control_items c
      where c.verification_computer_id = new.management_computer_id
        and c.followup_kind = 'verification' and c.status = 'Aguardando avaliação') then
    raise exception 'Conclua a verificação aberta no Controle TI antes de ativar ou reservar o computador.';
  end if;
  return new;
end;
$$;
create trigger management_open_verification_activation_guard
  before update of payload,management_computer_id on public.module_records
  for each row execute function app.guard_management_open_verification_activation();

create or replace function public.complete_control_verification(
  p_control_item_id uuid, p_request_id uuid, p_solution text, p_control_fields jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  ticket public.control_items%rowtype; source_row record; source_data jsonb;
  previous_situation text; restored_situation text; source_module text; source_uuid uuid;
  root_event uuid; prior_event public.equipment_events%rowtype; root_key text; message text;
begin
  if auth.uid() is null or p_control_item_id is null or p_request_id is null
    or char_length(btrim(coalesce(p_solution,''))) not between 3 and 2000
    or jsonb_typeof(p_control_fields) <> 'object' then
    raise exception 'Informe o chamado e o resultado da verificação (3 a 2000 caracteres).';
  end if;
  select * into ticket from public.control_items where id = p_control_item_id;
  if not found or ticket.followup_kind <> 'verification' then
    raise exception 'Acompanhamento de verificação não encontrado.';
  end if;
  if not coalesce(app.can_manage_module_table(ticket.table_id,'control','update'),false) then
    raise exception 'Sem permissão para concluir este acompanhamento técnico.';
  end if;
  root_key := 'verification-complete:' || p_request_id::text;
  select e.* into prior_event from public.equipment_events e
    where e.source_module = 'control' and e.source_event_key = root_key;
  if found then
    if prior_event.source_id is distinct from ticket.id or prior_event.reason is distinct from btrim(p_solution) then
      raise exception 'Este identificador já pertence a outra conclusão.';
    end if;
    return jsonb_build_object('eventId',prior_event.id,'alreadyApplied',true);
  end if;
  source_module := case when ticket.verification_inventory_item_id is not null then 'inventory' else 'management' end;
  source_uuid := coalesce(ticket.verification_inventory_item_id,ticket.verification_computer_id);
  -- Mesma ordem dos gatilhos: origem física, trava de identidade e chamado.
  if source_module = 'inventory' then
    select * into source_row from public.inventory_items where id = source_uuid for update;
    if not found then raise exception 'Equipamento de origem não encontrado.'; end if;
    source_data := to_jsonb(source_row);
  else
    select r.* into source_row from public.module_records r join public.module_tables t on t.id = r.table_id
      where t.module = 'management' and r.management_computer_id = source_uuid for update of r;
    if not found then raise exception 'Computador de origem não encontrado.'; end if;
    source_data := source_row.payload;
  end if;
  perform pg_advisory_xact_lock(94194,hashtext(source_uuid::text));
  select * into ticket from public.control_items where id = p_control_item_id for update;
  if ticket.status <> 'Aguardando avaliação' or ticket.verification_completed_at is not null then
    raise exception 'Esta verificação já foi encerrada. O histórico foi preservado.';
  end if;
  select e.metadata ->> 'previousSituation' into previous_situation from public.equipment_events e
    where e.source_module = 'control' and e.source_event_key = 'verification-start:' || ticket.id::text;
  if previous_situation is null or lower(btrim(previous_situation)) = 'verificando' then
    raise exception 'Situação anterior não verificável. Revise o acompanhamento antes de concluir.';
  end if;
  restored_situation := case when lower(btrim(coalesce(source_data ->> 'situation',''))) = 'verificando'
    then previous_situation else source_data ->> 'situation' end;
  message := left('Verificação técnica concluída: ' || btrim(p_solution)
    || '. Status e localização física preservados.',500);
  insert into public.equipment_events (
    source_module,source_event_key,source_id,inventory_item_id,action,previous_status,new_status,
    previous_location,new_location,reason,affected_modules,metadata,actor_id
  ) values (
    'control',root_key,ticket.id,ticket.verification_inventory_item_id,'Verificação concluída',
    source_data ->> 'status',source_data ->> 'status',source_data ->> 'location',source_data ->> 'location',
    btrim(p_solution),jsonb_build_array('control',source_module),
    jsonb_build_object('controlItemId',ticket.id,'sourceModule',source_module,'sourceId',source_uuid,
      'computerId',ticket.verification_computer_id,'previousSituation',source_data ->> 'situation',
      'newSituation',restored_situation,'physicalMovement',false),auth.uid()
  ) returning id into root_event;
  perform set_config('app.verification_completion_id',root_event::text,true);
  update public.control_items set status = 'Verificação concluída',verification_completed_at = now(),
    exit_date = timezone('America/Sao_Paulo',now())::date,
    notes = coalesce(p_control_fields ->> 'notes',notes),
    equipment = coalesce(p_control_fields ->> 'equipment',equipment),
    model = coalesce(p_control_fields ->> 'model',model),
    brand = coalesce(p_control_fields ->> 'brand',brand),
    sector = coalesce(p_control_fields ->> 'sector',sector),
    cleaning_type = coalesce(p_control_fields ->> 'cleaningType',cleaning_type)
    where id = ticket.id;
  insert into public.control_item_logs (control_item_id,action,message,event_id)
    values (ticket.id,'update',message,root_event);
  if source_module = 'inventory' then
    update public.inventory_items set situation = restored_situation where id = source_uuid;
    insert into public.inventory_item_logs (inventory_item_id,action,message,event_id)
      values (source_uuid,'update',message,root_event);
  else
    update public.module_records set payload = jsonb_set(payload,'{situation}',
      to_jsonb(restored_situation),true) where id = source_row.id;
  end if;
  insert into public.equipment_event_effects (event_id,module,status,attempts,processed_at)
    values (root_event,'control','applied',1,now()),(root_event,source_module,'applied',1,now());
  perform set_config('app.verification_completion_id','',true);
  return jsonb_build_object('eventId',root_event,'alreadyApplied',false);
end;
$$;
revoke all on function public.complete_control_verification(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.complete_control_verification(uuid,uuid,text,jsonb) to authenticated;


create or replace function app.guard_verification_history_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'control_items' then
    if old.followup_kind = 'verification' then
      raise exception 'O acompanhamento técnico possui histórico permanente. Conclua a verificação; nenhum registro foi excluído.';
    end if;
  elsif old.management_computer_id is not null and exists (
    select 1 from public.control_items c where c.verification_computer_id = old.management_computer_id
  ) then
    raise exception 'O computador possui acompanhamento técnico. Preserve sua identidade e histórico.';
  end if;
  return old;
end;
$$;
create trigger control_verification_history_delete_guard
  before delete on public.control_items for each row execute function app.guard_verification_history_delete();
create trigger management_verification_history_delete_guard
  before delete on public.module_records for each row execute function app.guard_verification_history_delete();


create index equipment_control_computer_technical_history_idx on public.equipment_events
  ((metadata->>'computerId'),created_at desc)
  where source_module='control' and metadata->>'physicalMovement'='false';

-- Histórico do PC segue o UUID do computador; não é uma movimentação do PDV.
create or replace function public.management_technical_history(p_computer_id uuid)
returns table(event_id uuid,occurred_at timestamptz,action text,reason text,metadata jsonb,processing_result jsonb)
language sql stable security invoker set search_path = public as $$
  select e.id,e.created_at,e.action,e.reason,e.metadata,e.processing_result
  from public.equipment_events e where e.source_module='control'
    and e.metadata ->> 'computerId' = p_computer_id::text
    and e.metadata ->> 'physicalMovement' = 'false'
    and (e.action in ('Verificação iniciada','Verificação concluída','Registro técnico','Registro técnico atualizado')
      or e.metadata->>'verificationResolved'='true')
  order by e.created_at desc,e.id desc limit 100;
$$;
revoke all on function public.management_technical_history(uuid) from public,anon;
grant execute on function public.management_technical_history(uuid) to authenticated;

create or replace function app.record_verification_technical_log()
returns trigger language plpgsql security definer set search_path = public,app,pg_temp as $$
declare ticket public.control_items%rowtype; root_event uuid; module_name text; source_uuid uuid; event_key text;
begin
  select * into ticket from public.control_items where id=new.control_item_id and followup_kind='verification';
  if not found then return new; end if;
  if new.event_id is not null and exists(select 1 from public.equipment_events e where e.id=new.event_id
    and e.action in ('Verificação iniciada','Verificação concluída')) then
    if tg_op='UPDATE' and old.message is distinct from new.message then
      raise exception 'Registro automático imutável. Adicione um novo registro técnico.';
    end if;
    return new;
  end if;
  module_name := case when ticket.verification_inventory_item_id is not null then 'inventory' else 'management' end;
  source_uuid := coalesce(ticket.verification_inventory_item_id,ticket.verification_computer_id);
  event_key := 'verification-log:' || new.id::text ||
    case when tg_op='UPDATE' then ':' || extract(epoch from clock_timestamp())::text else '' end;
  insert into public.equipment_events (
    source_module,source_event_key,source_id,inventory_item_id,action,reason,affected_modules,metadata,actor_id
  ) values (
    'control',event_key,ticket.id,ticket.verification_inventory_item_id,
    case when tg_op='UPDATE' then 'Registro técnico atualizado' else 'Registro técnico' end,
    new.message,jsonb_build_array('control',module_name),
    jsonb_build_object('controlItemId',ticket.id,'sourceModule',module_name,'sourceId',source_uuid,
      'computerId',ticket.verification_computer_id,'controlLogId',new.id,'physicalMovement',false),auth.uid()
  ) returning id into root_event;
  update public.control_item_logs set event_id=root_event where id=new.id;
  if ticket.verification_inventory_item_id is not null then
    insert into public.inventory_item_logs(inventory_item_id,action,message,event_id,source_module,source_log_id)
      values(ticket.verification_inventory_item_id,'update',new.message,root_event,'control',new.id)
    on conflict(inventory_item_id,source_module,source_log_id)
      where source_module is not null and source_log_id is not null
      do update set message=excluded.message,event_id=excluded.event_id;
  end if;
  insert into public.equipment_event_effects(event_id,module,status,attempts,processed_at)
    values(root_event,module_name,'applied',1,now());
  return new;
end;
$$;
create trigger verification_technical_log_history
  after insert or update of message on public.control_item_logs
  for each row execute function app.record_verification_technical_log();

comment on column public.control_items.followup_kind is
  'Distingue manutenção de investigação técnica. Verificação nunca muda status/local físico por si só.';
comment on column public.control_items.verification_computer_id is
  'Identidade estável da Gestão TI (management_computer_id), independente do terminal atual.';

commit;
