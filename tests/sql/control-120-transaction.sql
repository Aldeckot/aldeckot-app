-- Executar exclusivamente sob BEGIN/ROLLBACK no projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role='admin' limit 1),true);
end; $auth$;

do $test$
declare
  item public.inventory_items%rowtype;
  ticket public.control_items%rowtype;
  review jsonb;
  result jsonb;
  request_id uuid := gen_random_uuid();
  stale_rejected boolean := false;
begin
  if not exists(select 1 from public.module_tables t where t.module='control'
    and lower(btrim(t.name))=lower(app.current_control_maintenance_table_name())) then
    insert into public.module_tables(module,name,icon)
      values('control',app.current_control_maintenance_table_name(),'🔧');
  end if;
  select i.* into item from public.inventory_items i
    where i.status='Ativo' and i.location ~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(i.tag) is not null
      and exists(select 1 from public.module_records r
        join public.module_tables t on t.id=r.table_id and t.module='management'
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(r.payload->'peripherals')='array'
            then r.payload->'peripherals' else '[]'::jsonb end) p(value)
        where app.inventory_installation_location_key(r.payload->>'terminal')=
          app.inventory_installation_location_key(i.location)
          and p.value->>'sourceItemId'=i.id::text)
    order by i.id limit 1;
  if item.id is null then raise exception 'No linked PDV peripheral fixture.'; end if;
  update public.inventory_items set status='Manutenção' where id=item.id;
  select * into ticket from public.control_items
    where inventory_item_id=item.id order by updated_at desc limit 1;
  if ticket.id is null or ticket.status<>'Em manutenção' then
    raise exception 'Control TI maintenance ticket not created.';
  end if;
  review := public.preview_control_peripheral_completion(ticket.id,'Ativo',
    'PDV 11',item.sector);
  if review->>'blocked'<>'true' then
    raise exception 'Occupied destination PDV was not blocked.';
  end if;
  review := public.preview_control_peripheral_completion(ticket.id,'Reserva',
    'Sala CPD',item.sector);
  if review->>'blocked'<>'false' then
    raise exception 'Reserve destination blocked: %',review->>'reason';
  end if;
  begin
    perform public.complete_control_peripheral_with_destination(ticket.id,
      'Reserva','Sala CPD',item.sector,'Retirado para reserva após manutenção',
      'stale-review-token',request_id,'{}'::jsonb);
  exception when others then
    stale_rejected := true;
  end;
  if not stale_rejected or exists(select 1 from public.inventory_items i
    where i.id=item.id and i.status='Reserva') then
    raise exception 'Stale review token was not rejected atomically.';
  end if;
  result := public.complete_control_peripheral_with_destination(ticket.id,
    'Reserva','Sala CPD',item.sector,'Retirado para reserva após manutenção',
    review->>'token',request_id,'{}'::jsonb);
  if result->>'alreadyApplied'<>'false' or not exists(
    select 1 from public.inventory_items i where i.id=item.id
      and i.status='Reserva' and i.location='Sala CPD') or not exists(
    select 1 from public.control_items c where c.id=ticket.id
      and c.status='Manutenção concluída') or exists(
    select 1 from public.module_records r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.payload->'peripherals')='array'
          then r.payload->'peripherals' else '[]'::jsonb end) p(value)
      where p.value->>'sourceItemId'=item.id::text) then
    raise exception 'Completion did not move the item, close ticket and detach PDV.';
  end if;
  if not exists(select 1 from public.equipment_events e
    where e.id=(result->>'eventId')::uuid and e.previous_location=item.location
      and e.new_location='Sala CPD' and e.metadata->>'movementEventId' is not null) then
    raise exception 'Control completion and physical movement were not correlated.';
  end if;
  result := public.complete_control_peripheral_with_destination(ticket.id,
    'Reserva','Sala CPD',item.sector,'Retirado para reserva após manutenção',
    review->>'token',request_id,'{}'::jsonb);
  if result->>'alreadyApplied'<>'true' then
    raise exception 'Completion retry was not idempotent.';
  end if;
  -- Um periférico reparado também pode voltar ao PDV original, sem mudança de Local.
  select i.* into item from public.inventory_items i
    where i.status='Ativo' and i.location ~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(i.tag) is not null
      and i.id <> item.id
      and exists(select 1 from public.module_records r
        join public.module_tables t on t.id=r.table_id and t.module='management'
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(r.payload->'peripherals')='array'
            then r.payload->'peripherals' else '[]'::jsonb end) p(value)
        where p.value->>'sourceItemId'=i.id::text)
    order by i.id limit 1;
  if item.id is null then raise exception 'No second linked peripheral fixture.'; end if;
  update public.inventory_items set status='Manutenção' where id=item.id;
  select * into ticket from public.control_items
    where inventory_item_id=item.id order by updated_at desc limit 1;
  if ticket.id is null or ticket.status<>'Em manutenção' then
    raise exception 'Return-to-same-PDV ticket not created.';
  end if;
  review := public.preview_control_peripheral_completion(ticket.id,'Ativo',
    item.location,item.sector);
  if review->>'blocked'<>'false' then
    raise exception 'Return to original PDV blocked: %',review->>'reason';
  end if;
  result := public.complete_control_peripheral_with_destination(ticket.id,
    'Ativo',item.location,item.sector,'Reinstalado após manutenção no PDV original',
    review->>'token',gen_random_uuid(),'{}'::jsonb);
  if result->>'alreadyApplied'<>'false' or not exists(
    select 1 from public.inventory_items i where i.id=item.id
      and i.status='Ativo' and i.location=item.location) or not exists(
    select 1 from public.module_records r
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(r.payload->'peripherals')='array'
          then r.payload->'peripherals' else '[]'::jsonb end) p(value)
      where p.value->>'sourceItemId'=item.id::text) then
    raise exception 'Return to original PDV lost inventory or management linkage.';
  end if;
  raise notice 'control_120_destination_and_idempotency_ok';
end;
$test$;
