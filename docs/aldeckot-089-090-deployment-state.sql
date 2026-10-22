-- Auditoria SOMENTE LEITURA antes e depois das migracoes 089 e 090.
-- Execute no SQL Editor principal. Nao consulta equipamentos nem altera dados.
with state as (
  select
    to_regprocedure('public.management_move_computer(uuid,jsonb)') as movement_rpc,
    to_regprocedure('public.management_move_computer_core(uuid,jsonb)') as movement_core,
    to_regprocedure('public.management_movement_history(uuid,uuid)') as movement_history,
    to_regprocedure('public.inventory_save_pdv_peripheral(uuid,jsonb,timestamptz,text,uuid)') as peripheral_save_rpc,
    to_regprocedure('public.inventory_swap_locations_with_reason(uuid,uuid,uuid,text,text,text,text,text)') as swap_with_reason_rpc,
    to_regprocedure('app.record_inventory_pdv_peripheral_movement()') as peripheral_event_function
), checks as (
  select
    movement_rpc is not null as movement_rpc_exists,
    movement_core is not null as movement_core_exists,
    movement_history is not null as movement_history_exists,
    movement_core is not null and not coalesce(
      has_function_privilege('authenticated', movement_core, 'EXECUTE'), true)
      as movement_core_private,
    movement_rpc is not null and coalesce(
      has_function_privilege('authenticated', movement_rpc, 'EXECUTE'), false)
      as movement_rpc_authenticated,
    movement_rpc is not null and position('management_move_computer_core' in
      coalesce(pg_get_functiondef(movement_rpc), '')) > 0
      as movement_wrapper_uses_core,
    peripheral_save_rpc is not null as peripheral_save_rpc_exists,
    peripheral_save_rpc is not null and coalesce(
      has_function_privilege('authenticated', peripheral_save_rpc, 'EXECUTE'), false)
      as peripheral_save_authenticated,
    swap_with_reason_rpc is not null as swap_with_reason_rpc_exists,
    swap_with_reason_rpc is not null and coalesce(
      has_function_privilege('authenticated', swap_with_reason_rpc, 'EXECUTE'), false)
      as swap_with_reason_authenticated,
    peripheral_event_function is not null as peripheral_event_function_exists,
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.inventory_items')
        and trigger_row.tgname = 'z_inventory_pdv_peripheral_movement'
        and trigger_row.tgenabled in ('O', 'A')
        and not trigger_row.tgisinternal
    ) as peripheral_event_trigger_enabled
  from state
)
select jsonb_build_object(
  'checked_at', now(),
  'migration_088_rpc_present', movement_rpc_exists and movement_history_exists,
  'migration_089_ready_to_apply', movement_rpc_exists and not movement_core_exists,
  'migration_089_verified', movement_rpc_exists and movement_core_exists
    and movement_core_private and movement_rpc_authenticated
    and movement_wrapper_uses_core,
  'migration_090_present', peripheral_save_rpc_exists
    or swap_with_reason_rpc_exists or peripheral_event_trigger_enabled,
  'migration_090_verified', peripheral_save_rpc_exists
    and peripheral_save_authenticated and swap_with_reason_rpc_exists
    and swap_with_reason_authenticated and peripheral_event_function_exists
    and peripheral_event_trigger_enabled,
  'details', to_jsonb(checks)
) as deployment_report
from checks;
