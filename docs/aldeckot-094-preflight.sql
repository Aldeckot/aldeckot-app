-- SOMENTE LEITURA. Executar antes de autorizar/aplicar a migração 094.
with dependencies(signature) as (values
 ('app.current_control_maintenance_table_name()'),
 ('app.can_manage_module_table(uuid,text,text)'),
 ('app.inventory_installation_location_key(text)'),
 ('app.sync_inventory_maintenance_to_control(uuid)'),
 ('app.sync_management_record_to_control(uuid,jsonb)'),
 ('app.sync_inventory_status_from_control()'),
 ('app.sync_management_status_from_control()'),
 ('app.copy_control_log_to_inventory()'),
 ('app.copy_control_log_to_management()')
), routines as (
 select d.signature,p.oid,p.proowner,p.prosrc,l.lanname,
   pg_get_userbyid(p.proowner) as owner
 from dependencies d left join pg_proc p on p.oid=to_regprocedure(d.signature)
 left join pg_language l on l.oid=p.prolang
), installed as (
 select count(*) as columns from information_schema.columns
 where table_schema='public' and table_name='control_items'
 and column_name in ('followup_kind','verification_inventory_item_id','verification_computer_id',
   'verification_started_at','verification_completed_at')
)
select jsonb_build_object(
 'checked_at',now(),'sql_editor_role',current_user,
 'migration_094_installed',to_regprocedure('public.complete_control_verification(uuid,uuid,text,jsonb)') is not null,
 'verification_columns_present',(select columns from installed),
 'missing_functions',coalesce((select jsonb_agg(signature) from routines where oid is null),'[]'::jsonb),
 'function_owners',(select jsonb_object_agg(signature,owner) from routines),
 'status_constraint_found',exists(select 1 from pg_constraint where conrelid='public.control_items'::regclass and conname='control_items_status_check'),
 'legacy_sync_routines_compatible',not exists(select 1 from routines
   where signature in ('app.sync_inventory_maintenance_to_control(uuid)','app.sync_management_record_to_control(uuid,jsonb)')
     and (oid is null or lanname<>'plpgsql' or position('from public.control_items' in lower(prosrc))=0)),
 'inventory_already_verifying',(select count(*) from public.inventory_items where lower(btrim(situation))='verificando'),
 'computers_already_verifying',(select count(*) from public.module_records r join public.module_tables t on t.id=r.table_id
   where t.module='management' and lower(btrim(r.payload->>'situation'))='verificando'),
 'computer_identity_mismatches',(select count(*) from public.module_records r join public.module_tables t on t.id=r.table_id
   where t.module='management' and (nullif(btrim(r.payload->>'equipment'),'') is null) is distinct from (r.management_computer_id is null)),
 'creates_retroactive_tickets',false,
 'note','A 094 cria acompanhamentos em novas entradas em Verificando; não reconcilia registros anteriores.'
) as home_094_preflight;
