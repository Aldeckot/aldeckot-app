-- Auditoria SOMENTE LEITURA para o SQL Editor principal.
-- Não executa a RPC, não altera dados e não instala a migração 090.
-- Referências SQL e contador de chamadas não identificam clientes HTTP.
with legacy as (
  select to_regprocedure(
    'public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text)'
  ) as function_oid
), routine_references as (
  select n.nspname as schema_name, p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join legacy
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_toast%'
    and p.oid is distinct from legacy.function_oid
    and case when p.prokind in ('f', 'p') then
      pg_get_functiondef(p.oid) ~* 'inventory_swap_locations[[:space:]]*\('
    else false end
), grants as (
  select r.rolname,
    has_function_privilege(r.oid, legacy.function_oid, 'EXECUTE') as can_execute
  from pg_roles r cross join legacy
  where r.rolname in ('anon', 'authenticated', 'service_role')
    and legacy.function_oid is not null
), function_usage as (
  select s.calls
  from pg_stat_user_functions s cross join legacy
  where s.funcid = legacy.function_oid
)
select jsonb_build_object(
  'checked_at', now(),
  'legacy_rpc_exists', (select function_oid is not null from legacy),
  'database_routine_references', coalesce((
    select jsonb_agg(jsonb_build_object(
      'schema', schema_name, 'function', function_name, 'arguments', arguments)
      order by schema_name, function_name, arguments)
    from routine_references
  ), '[]'::jsonb),
  'execute_grants', coalesce((
    select jsonb_object_agg(rolname, can_execute) from grants
  ), '{}'::jsonb),
  'cron_job_table_present', to_regclass('cron.job') is not null,
  'track_functions', current_setting('track_functions'),
  'observed_calls_since_stats_reset', case
    when current_setting('track_functions') = 'none' then null
    else coalesce((select calls from function_usage), 0)
  end,
  'database_stats_reset_at', (
    select stats_reset from pg_stat_database where datname = current_database()
  )
) as legacy_rpc_report;
