-- Run inside an isolated transaction after 129; the runner rolls fixtures back.
do $test$
declare
  actor uuid;
  management_table uuid;
  inventory_table uuid;
  pc public.module_records%rowtype;
  destination public.module_records%rowtype;
  selected uuid;
  untouched uuid;
  replacement uuid;
  batch_id uuid := gen_random_uuid();
  individual_id uuid := gen_random_uuid();
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  version timestamptz;
  review jsonb;
  control_table uuid;
  linked_ticket uuid;
  control_before integer;
  flux_before integer;
  pc_due date;
  peripheral_due date;
  failed boolean;
begin
  select id into strict actor from public.profiles where role='admin' and status='active' order by id limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  select id into strict management_table from public.module_tables where module='management' order by id limit 1;
  select id into strict inventory_table from public.module_tables where module='inventory' and name ilike 'IMPRESSORAS%' order by id limit 1;
  insert into public.module_records(table_id,position,payload) values(management_table,99994,
    '{"terminal":"PDV 994","area":"Frente de Loja","sector":"Frente de Loja","equipment":"Computador de ensaio","tag":"CLEAN994","status":"Ativo","situation":"Em Uso","cleaning":"Preventiva","peripherals":[],"logs":[]}')
    returning * into pc;
  insert into public.module_records(table_id,position,payload) values(management_table,99995,
    '{"terminal":"PDV 995","area":"Frente de Loja","sector":"Frente de Loja","equipment":"","peripherals":[],"logs":[]}')
    returning * into destination;
  insert into public.inventory_items(table_id,equipment,model,tag,serial,sector,location,status,cleaning_type)
    values(inventory_table,'Impressora de ensaio','Modelo de ensaio','IMPR994129','ENS-129-A','Frente de Loja','PDV 994','Ativo','Preventiva') returning id into selected;
  insert into public.inventory_items(table_id,equipment,model,tag,serial,sector,location,status,cleaning_type)
    values(inventory_table,'Leitor de ensaio','Modelo de ensaio','EAN994129','ENS-129-B','Frente de Loja','PDV 994','Ativo','Preventiva') returning id into untouched;
  insert into public.inventory_items(table_id,equipment,model,tag,serial,sector,location,status,cleaning_type)
    values(inventory_table,'Impressora reserva de ensaio','Modelo de ensaio','IMPR995129','ENS-129-C','Frente de Loja','Sala CPD','Reserva','Completa') returning id into replacement;
  select updated_at into version from public.module_records where id=pc.id;
  assert (select count(*) from public.management_cleaning_peripherals(pc.id))=2, 'PDV links';
  assert not exists(select 1 from app.equipment_cleaning_state where equipment_id in (replacement,untouched)), 'legacy flags do not start cycles';
  control_before:=(select count(*) from public.control_items);
  flux_before:=(select count(*) from public.flux_items);

  failed:=false;
  begin
    perform public.record_equipment_cleaning('management',pc.id,version,'Regular',array[selected,replacement],gen_random_uuid());
  exception when raise_exception then
    failed:=sqlerrm like 'Os vínculos do PDV mudaram%';
  end;
  assert failed and not exists(select 1 from app.equipment_cleaning_state where equipment_id=pc.management_computer_id),
    'a stale or unrelated selection rolls back the entire batch';
  perform public.record_equipment_cleaning('management',pc.id,version,'Regular',array[selected],batch_id);
  perform public.record_equipment_cleaning('management',pc.id,version,'Regular',array[selected,selected],batch_id);
  assert (select count(*) from public.equipment_events where metadata->>'operationId'=batch_id::text and actor_id=actor)=2,
    'individual entries share a single request and actor with deterministic retry';
  assert (select count(*) from public.sync_events where details->>'operationId'=batch_id::text and event_id is not null)=2,
    'exactly one global event per changed equipment';
  assert (select count(*) from public.inventory_item_logs where event_id=md5(batch_id::text||':'||selected)::uuid)=1,
    'individual inventory history';
  assert (select cleaning_type from public.inventory_items where id=untouched)='Preventiva', 'unselected equipment untouched';
  assert (select situation from public.inventory_items where id=selected)='Normal'
    and (select payload->>'situation' from public.module_records where id=pc.id)='Em Uso', 'physical situation is independent';
  select due_on into pc_due from app.equipment_cleaning_state where equipment_id=pc.management_computer_id;
  select due_on into peripheral_due from app.equipment_cleaning_state where equipment_id=selected;
  assert pc_due=(today+interval '2 months')::date and peripheral_due=(today+interval '1 month')::date,
    'independent calendar cycles';

  select updated_at into version from public.inventory_items where id=untouched;
  perform public.record_equipment_cleaning('inventory',untouched,version,'Completa',null,individual_id);
  assert (select equipment_id from app.equipment_cleaning_state where last_event_id=individual_id)=untouched
    and (select payload->>'cleaning' from public.module_records where id=pc.id)='Regular'
    and (select cleaning_type from public.inventory_items where id=selected)='Regular','individual isolation';

  update app.equipment_cleaning_state set due_on=today+4 where equipment_id in (pc.management_computer_id,selected);
  assert exists(select 1 from public.equipment_cleaning_alerts() where equipment_id=pc.management_computer_id and not overdue)
    and not exists(select 1 from public.equipment_cleaning_alerts() where equipment_id=selected), 'warning thresholds';
  update app.equipment_cleaning_state set due_on=today+3 where equipment_id=selected;
  assert (select count(*) from public.equipment_cleaning_alerts() where equipment_id=selected and not overdue and pdv='PDV 994')=1,
    'one advance warning with current PDV';
  update app.equipment_cleaning_state set due_on=today where equipment_id=selected;
  assert app.expire_equipment_cleaning(now())=1, 'date boundary expiration';
  assert app.expire_equipment_cleaning(now())=0, 'repeat job is idempotent';
  assert (select cleaning_type from public.inventory_items where id=selected)='Não realizada'
    and (select payload->>'cleaning' from public.module_records where id=pc.id)='Regular', 'peripheral expiration is independent';
  assert (select last_type='Regular' and last_performed_at is not null from app.equipment_cleaning_state where equipment_id=selected),
    'original type and timestamp survive expiration';
  assert (select count(*) from public.equipment_cleaning_alerts() where equipment_id=selected and overdue)=1,
    'one expired warning';

  review:=public.preview_local_replacement(replacement,selected,'Reserva','Sala CPD','Frente de Loja');
  perform public.confirm_local_replacement(replacement,selected,'Reserva','Sala CPD','Frente de Loja',
    'Substituição no ensaio de limpeza',review->>'token',gen_random_uuid());
  assert (select cleaning_type from public.inventory_items where id=replacement)='Completa'
    and (select count(*) from public.equipment_cleaning_alerts() where equipment_id=selected and position_id is null)=1,
    'replacement does not inherit the previous item cycle';
  review:=public.preview_local_regularization(selected,'PDV 995','Frente de Loja','Ativo','movement');
  perform public.confirm_local_regularization(selected,'PDV 995','Frente de Loja','Ativo','movement',
    'Transferência no ensaio de limpeza',review->>'token',gen_random_uuid());
  assert exists(select 1 from public.equipment_cleaning_alerts() where equipment_id=selected and position_id=destination.id and overdue),
    'transfer moves the alert and keeps the deadline';

  select * into pc from public.module_records where id=pc.id;
  select * into destination from public.module_records where id=destination.id;
  perform public.management_move_computer(gen_random_uuid(),jsonb_build_object(
    'mode','direct','sourceId',pc.id,'targetId',destination.id,'incomingComputerId',pc.management_computer_id,
    'sourceUpdatedAt',pc.updated_at,'targetUpdatedAt',destination.updated_at,'incomingStatus','Ativo',
    'incomingLocation','PDV 995','confirmedLocations',true,'reason','Transferência de computador no ensaio'));
  assert (select payload->>'cleaning' from public.module_records where id=destination.id)='Regular'
    and (select due_on from app.equipment_cleaning_state where equipment_id=pc.management_computer_id)=today+4,
    'computer cycle follows the stable identifier';
  assert exists(select 1 from public.management_movement_history(pc.management_computer_id,null) where event_id=batch_id),
    'computer history follows the stable identifier';

  select updated_at into version from public.inventory_items where id=selected;
  perform public.record_equipment_cleaning('inventory',selected,version,'Preventiva',null,gen_random_uuid());
  assert not exists(select 1 from public.equipment_cleaning_alerts() where equipment_id=selected),
    'a valid new cleaning resolves the expired alert';
  assert (select count(*) from public.equipment_events where metadata->>'physicalId'=selected::text and metadata ? 'cleaningKind')=3,
    'cleaning, expiration and renewal stay in history';
  assert (select count(*) from public.control_items)=control_before and (select count(*) from public.flux_items)=flux_before,
    'cleaning did not open tickets or write Flux entries';
  update app.equipment_cleaning_state set due_on=today where equipment_id=pc.management_computer_id;
  assert app.expire_equipment_cleaning(now())=1, 'computer expiration ran once';
  assert (select payload->>'cleaning' from public.module_records where id=destination.id)='Não realizada',
    'the existing chart source sees expiration at the new position';
  assert (select last_type from app.equipment_cleaning_state where equipment_id=pc.management_computer_id)='Regular',
    'computer expiration preserves last valid type';
  perform app.write_equipment_cleaning('inventory',replacement,replacement,'Completa','Regular',gen_random_uuid(),
    gen_random_uuid(),actor,'PDV 994','2028-01-31T15:00:00Z',null,false);
  assert (select due_on from app.equipment_cleaning_state where equipment_id=replacement)='2028-02-29',
    'calendar duration clamps end of month in leap year';
  select id into strict control_table from public.module_tables where module='control' order by id limit 1;
  insert into public.control_items(table_id,equipment,model,tag,serial,inventory_item_id,status,cleaning_type)
    values(control_table,'Impressora de ensaio','Modelo de ensaio','IMPR994129','ENS-129-A',selected,'Manutenção concluída','Completa')
    returning id into linked_ticket;
  assert exists(select 1 from public.control_source_equipment_state(array[linked_ticket]) where cleaning_type='Preventiva')
    and (select cleaning_type from public.control_items where id=linked_ticket)='Completa',
    'Control shows source cleaning and preserves the maintenance record';
  assert not has_function_privilege('anon','public.equipment_cleaning_alerts()','execute')
    and not has_function_privilege('authenticated','app.expire_equipment_cleaning(timestamptz)','execute'), 'privilege boundary';
end;
$test$;

set local role authenticated;
do $rest_role$
begin
  assert exists(select 1 from public.equipment_cleaning_alerts() where pdv='PDV 995' and overdue),
    'authenticated API role can query alerts through the existing table permissions';
  assert not has_table_privilege(current_user,
    (select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app' and c.relname='equipment_cleaning_state'),'update'),
    'application roles cannot change cycle dates directly';
end;
$rest_role$;
reset role;

select 'equipment_cleaning_129_ok';
