-- Executar exclusivamente sob BEGIN/ROLLBACK no projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role='admin' limit 1),true);
end; $auth$;

do $test$
declare
  outgoing public.inventory_items%rowtype;
  incoming public.inventory_items%rowtype;
  review jsonb;
  result jsonb;
  test_request_id uuid := gen_random_uuid();
  removed_location text := 'Sala CPD';
begin
  select i.* into outgoing from public.inventory_items i
    where i.status='Ativo' and i.location ~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(i.tag) is not null
      and exists (select 1 from public.module_records r
        join public.module_tables t on t.id=r.table_id and t.module='management'
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(r.payload->'peripherals')='array'
            then r.payload->'peripherals' else '[]'::jsonb end) p(value)
        where app.inventory_installation_location_key(r.payload->>'terminal')=
          app.inventory_installation_location_key(i.location)
          and p.value->>'sourceItemId'=i.id::text)
    order by i.id limit 1;
  if outgoing.id is null then raise exception 'No linked active PDV fixture.'; end if;
  select i.* into incoming from public.inventory_items i
    where i.table_id=outgoing.table_id and i.status='Reserva'
      and i.location !~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(i.tag)=
        app.inventory_tag_peripheral_type(outgoing.tag)
    order by i.id limit 1;
  if incoming.id is null then raise exception 'No reserve peripheral fixture in same category.'; end if;
  raise notice 'local_117_fixture_outgoing_tag=% incoming_tag=% pdv=%',
    outgoing.tag,incoming.tag,outgoing.location;
  review := public.preview_local_replacement(incoming.id,outgoing.id,
    'Reserva',removed_location,outgoing.sector);
  if review->>'blocked'<>'false' then
    raise exception 'Replacement preview blocked: %',review->>'reason';
  end if;
  result := public.confirm_local_replacement(incoming.id,outgoing.id,
    'Reserva',removed_location,outgoing.sector,
    'Substituição transacional de teste revertível',review->>'token',test_request_id);
  if result->>'alreadyApplied'<>'false' or not exists (
    select 1 from public.inventory_items i where i.id=outgoing.id
      and i.status='Reserva' and i.location=removed_location) or not exists (
    select 1 from public.inventory_items i where i.id=incoming.id
      and i.status='Ativo' and i.location=outgoing.location) then
    raise exception 'Replacement failed to exchange status and location.';
  end if;
  if (select count(*) from public.equipment_events e where e.metadata->>
    'regularizationRequestId'=test_request_id::text)<>2 then
    raise exception 'Replacement did not create two correlated events.';
  end if;
  result := public.confirm_local_replacement(incoming.id,outgoing.id,
    'Reserva',removed_location,outgoing.sector,
    'Substituição transacional de teste revertível',review->>'token',test_request_id);
  if result->>'alreadyApplied'<>'true' or
    (select count(*) from public.local_replacement_requests req where req.request_id=test_request_id)<>1 then
    raise exception 'Replacement idempotency failed.';
  end if;
  raise notice 'local_117_replacement_reserve_and_idempotency_ok';
  if not exists (select 1 from public.module_tables t where t.module='control'
    and lower(btrim(t.name))=lower(app.current_control_maintenance_table_name())) then
    insert into public.module_tables(module,name,icon)
      values ('control',app.current_control_maintenance_table_name(),'🔧');
  end if;
  review := public.preview_local_replacement(outgoing.id,incoming.id,
    'Manutenção',removed_location,outgoing.sector);
  if review->>'blocked'<>'false' then
    raise exception 'Maintenance replacement preview blocked: %',review->>'reason';
  end if;
  result := public.confirm_local_replacement(outgoing.id,incoming.id,
    'Manutenção',removed_location,outgoing.sector,
    'Substituição para manutenção em teste revertível',review->>'token',gen_random_uuid());
  if result->>'alreadyApplied'<>'false' or not exists (
    select 1 from public.inventory_items i where i.id=incoming.id
      and i.status='Manutenção' and i.location=removed_location) or not exists (
    select 1 from public.control_items c where c.inventory_item_id=incoming.id
      and c.status='Em manutenção') then
    raise exception 'Maintenance replacement failed to synchronize Control TI.';
  end if;
  raise notice 'local_117_maintenance_control_sync_ok';
end;
$test$;
