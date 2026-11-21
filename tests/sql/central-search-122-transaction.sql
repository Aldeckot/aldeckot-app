-- Execute in a transaction that ends in rollback on the test project.
do $auth$ begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
end; $auth$;
set local role authenticated;

do $test$
declare
  movement record;
  asset record;
begin
  select f.id, f.tag, f.inventory_item_id, f.equipment_uid into movement
  from public.flux_items f
  where f.inventory_item_id is not null and f.equipment_uid is not null
    and nullif(btrim(f.tag), '') is not null
    and exists (select 1 from public.central_equipment_search(f.tag) s where s.id = f.id)
  order by f.id limit 1;
  if movement.id is null or not exists (
    select 1 from public.central_equipment_search(movement.tag) s
    where s.id = movement.id and s.module = 'flux'
      and s.metadata->>'inventoryItemId' = movement.inventory_item_id::text
      and s.metadata->>'equipmentUid' = movement.equipment_uid::text
  ) then
    raise exception 'The authenticated search did not return an explicit Flux identity.';
  end if;

  select r.id, r.management_computer_id, r.payload->>'tag' as tag into asset
  from public.module_records r
  where r.management_computer_id is not null
    and nullif(btrim(r.payload->>'tag'), '') is not null
    and exists (select 1 from public.central_equipment_search(r.payload->>'tag') s where s.id = r.id)
  order by r.id limit 1;
  if asset.id is null or not exists (
    select 1 from public.central_equipment_search(asset.tag) s
    where s.id = asset.id and s.module = 'management'
      and s.metadata->>'computerId' = asset.management_computer_id::text
  ) then
    raise exception 'The authenticated search did not return a stable computer identity.';
  end if;
  if has_function_privilege('anon', 'public.central_equipment_search(text)', 'execute') then
    raise exception 'Anonymous access must remain disabled.';
  end if;
  raise notice 'central_search_122_authenticated_identities_ok';
end;
$test$;
