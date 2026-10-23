-- SOMENTE LEITURA. Executar depois da aplicação autorizada da 094.
select jsonb_build_object(
 'checked_at',now(),
 'completion_rpc',to_regprocedure('public.complete_control_verification(uuid,uuid,text,jsonb)') is not null,
 'completion_authenticated',has_function_privilege('authenticated',
   'public.complete_control_verification(uuid,uuid,text,jsonb)','EXECUTE'),
 'completion_anon_blocked',not has_function_privilege('anon',
   'public.complete_control_verification(uuid,uuid,text,jsonb)','EXECUTE'),
 'required_triggers',(
   select jsonb_object_agg(name,exists(select 1 from pg_trigger where tgname=name and not tgisinternal and tgenabled<>'D'))
   from unnest(array['control_verification_identity_guard','inventory_technical_verification_sync',
     'management_technical_verification_sync','management_open_verification_activation_guard',
     'control_verification_history_delete_guard','management_verification_history_delete_guard',
     'verification_technical_log_history','control_reused_verification_completion',
     'inventory_open_verification_diagnosis_guard','management_open_verification_diagnosis_guard']) as x(name)
 ),
 'technical_history_rpc',to_regprocedure('public.management_technical_history(uuid)') is not null,
 'technical_history_index',to_regclass('public.equipment_control_computer_technical_history_idx') is not null,
 'verification_tickets',(select count(*) from public.control_items where followup_kind='verification'),
 'open_verifications',(select count(*) from public.control_items where followup_kind='verification' and status='Aguardando avaliação'),
 'duplicate_open_inventory_verifications',(select count(*) from (
   select verification_inventory_item_id from public.control_items where followup_kind='verification'
     and status='Aguardando avaliação' and verification_inventory_item_id is not null
   group by verification_inventory_item_id having count(*)>1) d),
 'duplicate_open_computer_verifications',(select count(*) from (
   select verification_computer_id from public.control_items where followup_kind='verification'
     and status='Aguardando avaliação' and verification_computer_id is not null
   group by verification_computer_id having count(*)>1) d),
 'verification_events_with_physical_change',(select count(*) from public.equipment_events
   where action in ('Verificação iniciada','Verificação concluída')
     and (previous_status is distinct from new_status or previous_location is distinct from new_location)),
 'verification_event_count',(select count(*) from public.equipment_events
   where action in ('Verificação iniciada','Verificação concluída'))
) as home_094_postflight;
