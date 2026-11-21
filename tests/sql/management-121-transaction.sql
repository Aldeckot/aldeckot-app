-- Executar apenas entre BEGIN e ROLLBACK no projeto de testes.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' limit 1), true);
end; $auth$;

do $test$
declare
  source_item public.inventory_items%rowtype;
  target record;
  preview jsonb;
  event_row public.equipment_events%rowtype;
  operation_id uuid := gen_random_uuid();
  original_flux_count integer;
begin
  select count(*) into original_flux_count from public.flux_items;
  for source_item in
    select i.* from public.inventory_items i
    where i.status = 'Ativo' and i.location ~* '^PDV[[:space:]]+[0-9]+$'
      and nullif(btrim(coalesce(i.sector, '')), '') is not null
      and app.inventory_tag_peripheral_type(i.tag) is not null
    order by i.id
  loop
    for target in
      select r.id, r.payload->>'terminal' as location
      from public.module_records r
      join public.module_tables t on t.id = r.table_id and t.module = 'management'
      where r.payload->>'terminal' ~* '^PDV[[:space:]]+[0-9]+$'
        and app.inventory_installation_location_key(r.payload->>'terminal') <>
          app.inventory_installation_location_key(source_item.location)
      order by r.id
    loop
      preview := public.preview_local_regularization(source_item.id,
        target.location, source_item.sector, 'Ativo', 'correction');
      exit when preview->>'blocked' = 'false';
    end loop;
    exit when preview->>'blocked' = 'false';
  end loop;
  if preview is null or preview->>'blocked' <> 'false' then
    raise exception 'Nenhum slot livre disponível para o ensaio revertível.';
  end if;

  perform public.confirm_local_regularization(source_item.id, target.location,
    source_item.sector, 'Ativo', 'correction',
    'Conferência cadastral de teste revertível', preview->>'token', operation_id);
  select * into event_row from public.equipment_events where id = operation_id;
  if event_row.id is null or event_row.action <> 'Correção cadastral de local'
    or coalesce(jsonb_array_length(event_row.metadata->'positionIds'), 0) <> 2 then
    raise exception 'A correção não gerou evento correlacionado aos dois PDVs.';
  end if;
  if not exists (select 1 from public.management_movement_history(
      null, (event_row.metadata->'positionIds'->>0)::uuid)
      where event_id = operation_id and action = 'Correção cadastral de local')
    or not exists (select 1 from public.management_movement_history(
      null, (event_row.metadata->'positionIds'->>1)::uuid)
      where event_id = operation_id and action = 'Correção cadastral de local') then
    raise exception 'Histórico do PDV não retornou o mesmo evento na origem e no destino.';
  end if;
  if (select count(*) from public.flux_items) <> original_flux_count then
    raise exception 'Correção cadastral criou uma remessa física indevida.';
  end if;
  raise notice 'management_121_same_event_both_pdvs_no_flux_shipment_ok';
end;
$test$;
