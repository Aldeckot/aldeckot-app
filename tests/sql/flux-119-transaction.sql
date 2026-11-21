-- Executar exclusivamente sob BEGIN/ROLLBACK no projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role='admin' limit 1),true);
end; $auth$;

do $test$
declare
  flux_table public.module_tables%rowtype;
  movement public.flux_items%rowtype;
  second_movement public.flux_items%rowtype;
  third_movement public.flux_items%rowtype;
  review jsonb;
  result jsonb;
  record_id uuid;
  serial_number text := 'TEST-119-' || gen_random_uuid()::text;
  inventory_serial text;
  tag_value text := 'T119' || left(replace(gen_random_uuid()::text,'-',''),12);
begin
  select * into flux_table from public.module_tables
    where module='flux' order by id limit 1;
  if flux_table.id is null then raise exception 'No Flux table.'; end if;
  insert into public.flux_items (table_id,movement,equipment,model,brand,
    serial,tag,sender_company,destination_company,sender_responsible,
    receiver_responsible,send_date,received_date,shipping_type,reason,status)
  values (flux_table.id,'Recebimento','Computador de teste','Modelo de teste',
    'Marca de teste',serial_number,'','Fornecedor de teste','Matriz',
    'Remetente de teste','Recebedor de teste',current_date,current_date,
    'Outro','Aquisição','Recebido') returning * into movement;
  perform public.flux_set_acquisition_intent_v2(movement.id,'management',null,
    'Escritório','computer');
  review := public.flux_preview_management_acquisition(movement.id);
  if review->>'state'<>'new' then
    raise exception 'Tagless computer preview was not new: %',review;
  end if;
  result := public.flux_complete_management_acquisition(movement.id);
  record_id := (result->>'managementRecordId')::uuid;
  if result->>'status'<>'completed' or result->>'linkedExisting'<>'false' or
    not exists (select 1 from public.module_records r where r.id=record_id
      and r.payload->>'serial'=serial_number and r.payload->>'tag'=''
      and r.payload->>'status'='Reserva'
      and r.payload->>'terminal'='Reserva ' || serial_number) then
    raise exception 'Tagless computer not registered in Management TI: %',result;
  end if;
  result := public.flux_complete_management_acquisition(movement.id);
  if result->>'alreadyApplied'<>'true' then
    raise exception 'Idempotent retry was not recognized.';
  end if;

  insert into public.flux_items (table_id,movement,equipment,model,brand,
    serial,tag,sender_company,destination_company,sender_responsible,
    receiver_responsible,send_date,received_date,shipping_type,reason,status)
  values (flux_table.id,'Recebimento','Computador de teste','Modelo de teste',
    'Marca de teste',serial_number,'','Fornecedor de teste','Matriz',
    'Remetente de teste','Recebedor de teste',current_date,current_date,
    'Outro','Aquisição','Recebido') returning * into second_movement;
  perform public.flux_set_acquisition_intent_v2(second_movement.id,'management',null,
    'Escritório','computer');
  review := public.flux_preview_management_acquisition(second_movement.id);
  if review->>'state'<>'existing' then
    raise exception 'Same serial did not resolve existing computer: %',review;
  end if;
  result := public.flux_complete_management_acquisition(second_movement.id);
  if result->>'linkedExisting'<>'true' or
    (result->>'managementRecordId')::uuid<>record_id or
    (select count(*) from public.module_records r
      join public.module_tables t on t.id=r.table_id and t.module='management'
      where r.payload->>'serial'=serial_number)<>1 then
    raise exception 'Second Flux acquisition duplicated the computer: %',result;
  end if;
  select i.serial into inventory_serial from public.inventory_items i
    where nullif(btrim(i.serial),'') is not null and i.serial not in ('-','***')
    order by i.id limit 1;
  if inventory_serial is null then raise exception 'No Inventory serial fixture.'; end if;
  insert into public.flux_items (table_id,movement,equipment,model,brand,
    serial,tag,sender_company,destination_company,sender_responsible,
    receiver_responsible,send_date,received_date,shipping_type,reason,status)
  values (flux_table.id,'Recebimento','Computador de teste','Modelo de teste',
    'Marca de teste',inventory_serial,'','Fornecedor de teste','Matriz',
    'Remetente de teste','Recebedor de teste',current_date,current_date,
    'Outro','Aquisição','Recebido') returning * into third_movement;
  perform public.flux_set_acquisition_intent_v2(third_movement.id,'management',null,
    'Escritório','computer');
  review := public.flux_preview_management_acquisition(third_movement.id);
  if review->>'state'<>'conflict' then
    raise exception 'Inventory serial was not blocked in Management: %',review;
  end if;

  insert into public.flux_items (table_id,movement,equipment,model,brand,
    serial,tag,sender_company,destination_company,sender_responsible,
    receiver_responsible,send_date,received_date,shipping_type,reason,status)
  values (flux_table.id,'Recebimento','Computador de teste','Modelo de teste',
    'Marca de teste','TEST-119-' || gen_random_uuid()::text,tag_value,
    'Fornecedor de teste','Matriz','Remetente de teste','Recebedor de teste',
    current_date,current_date,'Outro','Aquisição','Recebido')
    returning * into third_movement;
  perform public.flux_set_acquisition_intent_v2(third_movement.id,'management',null,
    'Escritório','computer');
  review := public.flux_preview_management_acquisition(third_movement.id);
  if review->>'state'<>'new' then
    raise exception 'Tagged acquisition preview regressed: %',review;
  end if;
  result := public.flux_complete_management_acquisition(third_movement.id);
  if result->>'status'<>'completed' or not exists (
    select 1 from public.module_records r
      where r.id=(result->>'managementRecordId')::uuid
        and r.payload->>'tag'=tag_value) then
    raise exception 'Tagged acquisition was not registered: %',result;
  end if;
  raise notice 'flux_119_management_tagless_and_dedup_ok';
end;
$test$;
