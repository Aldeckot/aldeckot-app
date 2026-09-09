-- A Central de Operações deve contar somente os registros que o usuário
-- consegue visualizar nas tabelas dos módulos. Com SECURITY INVOKER, as
-- políticas de acesso da aplicação também se aplicam a estes indicadores.
create or replace function public.operational_dashboard()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with today as (select (timezone('America/Sao_Paulo', now()))::date as value),
  metrics as (
    select
      (select count(*) from public.inventory_items) as inventory_total,
      (select count(*) from public.inventory_items where lower(status) = 'ativo') as inventory_active,
      (select count(*) from public.control_items where lower(status) in ('em manutenção', 'em manutencao', 'manutenção', 'manutencao', 'defeito')) as maintenance_open,
      (
        select count(*)
        from public.flux_items item
        join public.module_tables table_ref on table_ref.id = item.table_id
        where table_ref.module = 'flux'
          and lower(trim(coalesce(item.status, ''))) in ('pendente', 'em trânsito', 'em transito')
      ) as transfers_open,
      (select count(*) from public.nfe_occurrences where occurred_at >= date_trunc('month', now())) as nfe_month,
      (select count(*) from public.agenda_entries, today where not is_completed and due_date < today.value) as agenda_overdue,
      (select count(*) from public.equipment_identity_conflicts()) as identity_conflicts
  )
  select jsonb_build_object(
    'inventoryTotal', inventory_total,
    'inventoryActive', inventory_active,
    'maintenanceOpen', maintenance_open,
    'transfersOpen', transfers_open,
    'nfeMonth', nfe_month,
    'agendaOverdue', agenda_overdue,
    'identityConflicts', identity_conflicts
  ) from metrics
$$;
