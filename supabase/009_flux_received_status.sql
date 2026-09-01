-- ALDECKOT | Status Recebido no módulo Flux
-- Execute após 008_flux.sql.

alter table public.flux_items
  drop constraint if exists flux_items_status_check;

alter table public.flux_items
  add constraint flux_items_status_check
  check (status in ('Pendente', 'Recebido', 'Entregue', 'Em Trânsito'));
