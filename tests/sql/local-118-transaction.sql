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
  monthly_table text := app.current_control_maintenance_table_name();
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
  if outgoing.id is null then raise exception 'No active PDV fixture.'; end if;
  select i.* into incoming from public.inventory_items i
    where i.table_id=outgoing.table_id and i.status='Reserva'
      and i.location !~* '^PDV[[:space:]]+[0-9]+$'
      and app.inventory_tag_peripheral_type(i.tag)=
        app.inventory_tag_peripheral_type(outgoing.tag)
    order by i.id limit 1;
  if incoming.id is null then raise exception 'No reserve peripheral fixture.'; end if;

  review := public.preview_local_regularization(incoming.id,
    incoming.location,incoming.sector,'Reserva','correction');
  if review->>'blocked'<>'true' then
    raise exception 'Same-location preview must be blocked.';
  end if;
  review := public.preview_local_regularization(incoming.id,
    'Sala CPD',incoming.sector,'Reserva','movement');
  if review->>'blocked'<>'true' then
    raise exception 'Non-PDV-to-non-PDV preview must be blocked.';
  end if;
  review := public.preview_local_replacement(incoming.id,outgoing.id,
    'Reserva','Sala CPD',outgoing.sector);
  if review->>'blocked'<>'false' or
    review->'affectedModules'<>'["inventory", "management"]'::jsonb then
    raise exception 'Reserve replacement preview regressed.';
  end if;

  if not exists (select 1 from public.module_tables t where t.module='control'
    and lower(btrim(t.name))=lower(monthly_table)) then
    review := public.preview_local_replacement(incoming.id,outgoing.id,
      'Manutenção','Sala CPD',outgoing.sector);
    if review->>'blocked'<>'true' or review->>'reason' not like 'Crie a tabela mensal%' then
      raise exception 'Missing Control TI month was not blocked in preview.';
    end if;
    insert into public.module_tables(module,name,icon)
      values ('control',monthly_table,'🔧');
  end if;
  review := public.preview_local_replacement(incoming.id,outgoing.id,
    'Manutenção','Sala CPD',outgoing.sector);
  if review->>'blocked'<>'false' or
    review->'affectedModules'<>'["inventory", "management", "control"]'::jsonb then
    raise exception 'Maintenance preview did not include Control TI.';
  end if;
  raise notice 'local_118_preview_guards_ok';
end;
$test$;
