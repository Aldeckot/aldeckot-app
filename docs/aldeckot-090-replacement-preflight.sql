-- Consulta somente leitura para comparar a função atual da base principal
-- com a rotina preservada no rascunho da migração 090.
-- NÃO executa substituição, movimentação ou migração.
with target as (
  select to_regprocedure(
    'public.inventory_replace_equipment(uuid,uuid,text,text,text)'
  ) as function_oid
)
select jsonb_build_object(
  'checked_at', now(),
  'replacement_function_exists', target.function_oid is not null,
  'replacement_function_owner', pg_get_userbyid(function_row.proowner),
  'replacement_function_definition', case when target.function_oid is not null
    then pg_get_functiondef(target.function_oid) else null end,
  'migration_090_installed',
    to_regprocedure('public.inventory_swap_locations_with_reason(uuid,uuid,uuid,text,text,text,text,text)') is not null,
  'inventory_location_triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', trigger_row.tgname,
      'enabled', trigger_row.tgenabled <> 'D'
    ) order by trigger_row.tgname), '[]'::jsonb)
    from pg_trigger trigger_row
    where trigger_row.tgrelid = to_regclass('public.inventory_items')
      and not trigger_row.tgisinternal
  )
) as replacement_preflight_report
from target
left join pg_proc function_row on function_row.oid = target.function_oid;
