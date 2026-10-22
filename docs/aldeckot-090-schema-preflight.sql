-- Auditoria SOMENTE LEITURA das dependências estruturais da migração 090.
-- Não aplica migração, não consulta equipamentos e não altera dados.
with required_columns(relation_name, column_name, type_name) as (
  values
    ('public.inventory_items', 'id', 'uuid'),
    ('public.inventory_items', 'table_id', 'uuid'),
    ('public.inventory_items', 'equipment', 'text'),
    ('public.inventory_items', 'model', 'text'),
    ('public.inventory_items', 'brand', 'text'),
    ('public.inventory_items', 'serial', 'text'),
    ('public.inventory_items', 'tag', 'text'),
    ('public.inventory_items', 'sector', 'text'),
    ('public.inventory_items', 'location', 'text'),
    ('public.inventory_items', 'status', 'text'),
    ('public.inventory_items', 'situation', 'text'),
    ('public.inventory_items', 'cleaning_type', 'text'),
    ('public.inventory_items', 'notes', 'text'),
    ('public.inventory_items', 'branch_id', 'uuid'),
    ('public.inventory_items', 'position', 'integer'),
    ('public.inventory_items', 'updated_at', 'timestamptz'),
    ('public.module_tables', 'id', 'uuid'),
    ('public.module_tables', 'module', 'text'),
    ('public.module_records', 'id', 'uuid'),
    ('public.module_records', 'table_id', 'uuid'),
    ('public.module_records', 'payload', 'jsonb'),
    ('public.equipment_events', 'id', 'uuid'),
    ('public.equipment_events', 'source_module', 'text'),
    ('public.equipment_events', 'source_event_key', 'text'),
    ('public.equipment_events', 'source_id', 'uuid'),
    ('public.equipment_events', 'inventory_item_id', 'uuid'),
    ('public.equipment_events', 'action', 'text'),
    ('public.equipment_events', 'previous_status', 'text'),
    ('public.equipment_events', 'new_status', 'text'),
    ('public.equipment_events', 'previous_location', 'text'),
    ('public.equipment_events', 'new_location', 'text'),
    ('public.equipment_events', 'origin_location', 'text'),
    ('public.equipment_events', 'destination_location', 'text'),
    ('public.equipment_events', 'reason', 'text'),
    ('public.equipment_events', 'affected_modules', 'jsonb'),
    ('public.equipment_events', 'processing_result', 'jsonb'),
    ('public.equipment_events', 'metadata', 'jsonb'),
    ('public.equipment_events', 'actor_id', 'uuid'),
    ('public.equipment_events', 'created_at', 'timestamptz'),
    ('public.equipment_event_effects', 'event_id', 'uuid'),
    ('public.equipment_event_effects', 'module', 'text'),
    ('public.equipment_event_effects', 'status', 'text'),
    ('public.equipment_event_effects', 'attempts', 'integer'),
    ('public.equipment_event_effects', 'processed_at', 'timestamptz'),
    ('public.inventory_item_logs', 'inventory_item_id', 'uuid'),
    ('public.inventory_item_logs', 'action', 'text'),
    ('public.inventory_item_logs', 'message', 'text'),
    ('public.inventory_item_logs', 'event_id', 'uuid'),
    ('public.inventory_branch_events', 'correlation_id', 'uuid'),
    ('public.inventory_branch_events', 'operation', 'text'),
    ('public.inventory_branch_events', 'item_id', 'uuid'),
    ('public.inventory_branch_events', 'details', 'jsonb'),
    ('public.inventory_replacements', 'id', 'uuid'),
    ('public.inventory_replacements', 'removed_item_id', 'uuid'),
    ('public.inventory_replacements', 'installed_item_id', 'uuid'),
    ('public.inventory_replacements', 'removed_identity', 'uuid'),
    ('public.inventory_replacements', 'installed_identity', 'uuid'),
    ('public.inventory_replacements', 'removed_tag', 'text'),
    ('public.inventory_replacements', 'installed_tag', 'text'),
    ('public.inventory_replacements', 'previous_location', 'text'),
    ('public.inventory_replacements', 'removed_location', 'text'),
    ('public.inventory_replacements', 'removed_status', 'text'),
    ('public.inventory_replacements', 'reason', 'text'),
    ('public.inventory_replacements', 'actor_id', 'uuid')
), missing_columns as (
  select required.relation_name, required.column_name,
    required.type_name as expected_type,
    case when attribute.attname is null then null
      else format_type(attribute.atttypid, attribute.atttypmod) end as actual_type
  from required_columns required
  left join pg_attribute attribute
    on attribute.attrelid = to_regclass(required.relation_name)
    and attribute.attname = required.column_name and not attribute.attisdropped
  where attribute.attname is null
    or attribute.atttypid <> to_regtype(required.type_name)
), required_functions(signature) as (
  values
    ('auth.uid()'),
    ('app.inventory_tag_peripheral_type(text)'),
    ('app.can_manage_module_table(uuid,text,text)'),
    ('app.can_manage_module(text,text)'),
    ('public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text)'),
    ('public.inventory_replace_equipment(uuid,uuid,text,text,text)'),
    ('public.management_movement_history(uuid,uuid)')
), required_triggers(relation_name, trigger_name) as (
  values
    ('public.inventory_items', 'inventory_items_set_updated_at'),
    ('public.inventory_items', 'inventory_peripheral_management_sync'),
    ('public.module_records', 'management_pdv_peripheral_location_guard')
)
select jsonb_build_object(
  'checked_at', now(),
  'migration_090_installed',
    to_regprocedure('public.inventory_save_pdv_peripheral(uuid,jsonb,timestamptz,text,uuid)') is not null,
  'missing_or_changed_columns',
    (select coalesce(jsonb_agg(to_jsonb(missing_columns)
      order by relation_name, column_name), '[]'::jsonb) from missing_columns),
  'missing_functions',
    (select coalesce(jsonb_agg(signature order by signature), '[]'::jsonb)
      from required_functions where to_regprocedure(signature) is null),
  'missing_or_disabled_triggers',
    (select coalesce(jsonb_agg(jsonb_build_object(
      'table', required.relation_name, 'trigger', required.trigger_name)
      order by required.relation_name, required.trigger_name), '[]'::jsonb)
      from required_triggers required
      left join pg_trigger trigger_row
        on trigger_row.tgrelid = to_regclass(required.relation_name)
        and trigger_row.tgname = required.trigger_name
        and not trigger_row.tgisinternal and trigger_row.tgenabled <> 'D'
      where trigger_row.oid is null)
) as schema_report;
