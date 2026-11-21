-- Ensaio em homologação, na mesma transação revertida que
-- equipment-cleaning-129-transaction.sql, que prepara um PDV com prazo vencido.

do $fixtures$
declare
  profile_id uuid := gen_random_uuid();
  baseline_cases integer;
  filters jsonb := jsonb_build_object(
    'periodStart', (now() at time zone 'America/Sao_Paulo')::date - 365,
    'periodEnd', (now() at time zone 'America/Sao_Paulo')::date
  );
begin
  insert into auth.users(id,email) values(profile_id,'aldeckot-130-' || profile_id || '@example.invalid');
  update public.profiles set role='standard',status='active',module_permissions='{}' where id=profile_id;
  assert found, 'test profile must be provisioned';
  baseline_cases := (public.control_case_report(filters)->'metrics'->>'cases')::integer;
  assert baseline_cases > 0, 'report test needs visible cases';
  perform set_config('aldeckot.test_profile_130',profile_id::text,true);
  perform set_config('aldeckot.test_cases_130',baseline_cases::text,true);
  perform set_config('request.jwt.claim.sub',profile_id::text,true);
end;
$fixtures$;

set local role authenticated;
do $standard$
declare
  filters jsonb := jsonb_build_object(
    'periodStart', (now() at time zone 'America/Sao_Paulo')::date - 365,
    'periodEnd', (now() at time zone 'America/Sao_Paulo')::date
  );
  item public.inventory_items%rowtype;
  test_ticket uuid;
  test_position uuid;
  active_case uuid;
  rejected boolean := false;
begin
  select * into strict item from public.inventory_items where tag='IMPR994129';
  select id into strict test_ticket from public.control_items where inventory_item_id=item.id;
  select id into strict test_position from public.module_records where payload->>'terminal'='PDV 995';
  select id into strict active_case from public.control_cases where table_id is not null order by id limit 1;
  assert app.can_manage_module_table(item.table_id,'inventory','read')
    and not app.can_manage_module_table(item.table_id,'control','read'), 'read follows the actual module';
  assert not app.can_manage_module_table(item.table_id,'inventory','update')
    and not app.can_manage_module_table(item.table_id,'inventory','create')
    and not app.can_manage_module_table(item.table_id,'inventory','delete')
    and not app.can_manage_module_table(item.table_id,'inventory','backup'), 'no write permissions';
  assert (public.control_case_report(filters)->'metrics'->>'cases')::integer =
    current_setting('aldeckot.test_cases_130')::integer, 'standard report matches administrator read scope';
  assert public.control_case_recurrence(active_case) is not null,
    'standard role has the same recurrence query available for visible cases';
  assert jsonb_array_length(public.control_case_duration_summary(active_case))=1,
    'standard users can see case durations';
  assert (select count(*) from public.management_cleaning_peripherals(test_position) p
    where p.id=item.id and not p.editable)=1, 'peripheral remains visible without edit grant';
  assert (select count(*) from public.equipment_cleaning_alerts() a
    where a.position_id=test_position and a.source_module='management' and a.overdue)=1,
    'standard user receives visible PDV alerts';
  assert exists(select 1 from public.control_source_equipment_state(array[test_ticket]) s
    where s.cleaning_type='Preventiva'), 'Control shows current cleaning from the linked inventory item';
  begin
    perform public.record_equipment_cleaning('inventory',item.id,item.updated_at,'Completa',null,gen_random_uuid());
  exception when raise_exception then
    rejected := sqlerrm like 'Item indisponível%';
  end;
  assert rejected, 'read did not grant cleaning registration';
end;
$standard$;
reset role;

update public.profiles set status='blocked' where id=current_setting('aldeckot.test_profile_130')::uuid;
set local role authenticated;
do $blocked$
begin
  assert not app.has_active_account(), 'the blocked profile cannot use corporate reads';
  assert not exists(select 1 from public.inventory_items), 'blocked profile cannot read the inventory table';
  assert not exists(select 1 from public.equipment_cleaning_alerts()), 'blocked profile cannot read cleaning alerts';
end;
$blocked$;
reset role;

select 'operational_read_access_130_ok';
