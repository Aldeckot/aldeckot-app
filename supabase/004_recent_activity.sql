-- Histórico global de itens atualizados na Home.
-- Execute após 001_aldeckot_schema.sql e 003_control_ti.sql.

-- Reserva a estrutura genérica também para o futuro módulo Gestão TI.
alter table public.module_tables
  drop constraint if exists module_tables_module_check;

alter table public.module_tables
  add constraint module_tables_module_check
  check (module in ('inventory', 'management', 'control', 'flux', 'nfe'));

-- Preserva eventos existentes de sincronização/backup e aceita as ações de itens.
alter table public.sync_events
  drop constraint if exists sync_events_module_check;

alter table public.sync_events
  add constraint sync_events_module_check
  check (module in ('inventory', 'agenda', 'management', 'control', 'flux', 'nfe'));

alter table public.sync_events
  drop constraint if exists sync_events_operation_check;

alter table public.sync_events
  add constraint sync_events_operation_check
  check (operation in ('pull', 'push', 'backup', 'restore', 'create', 'update', 'delete', 'log'));

-- A consulta da Home é sempre limitada aos eventos recentes da própria identidade.
create index if not exists sync_events_owner_created_idx
  on public.sync_events (owner_id, created_at desc);
