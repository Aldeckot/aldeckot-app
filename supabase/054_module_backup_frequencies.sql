-- ALDECKOT | Frequência individual dos backups automáticos por módulo
-- Execute após 053_nfe_pin_pad_reason_sync.sql.

begin;

alter table public.inventory_backup_settings
  add column if not exists frequency_days integer not null default 7;
alter table public.inventory_backup_settings
  drop constraint if exists inventory_backup_settings_frequency_days_check;
alter table public.inventory_backup_settings
  add constraint inventory_backup_settings_frequency_days_check
  check (frequency_days between 1 and 90);

alter table public.management_backup_settings
  add column if not exists frequency_days integer not null default 7;
alter table public.management_backup_settings
  drop constraint if exists management_backup_settings_frequency_days_check;
alter table public.management_backup_settings
  add constraint management_backup_settings_frequency_days_check
  check (frequency_days between 1 and 90);

alter table public.control_backup_settings
  add column if not exists frequency_days integer not null default 7;
alter table public.control_backup_settings
  drop constraint if exists control_backup_settings_frequency_days_check;
alter table public.control_backup_settings
  add constraint control_backup_settings_frequency_days_check
  check (frequency_days between 1 and 90);

alter table public.flux_backup_settings
  add column if not exists frequency_days integer not null default 7;
alter table public.flux_backup_settings
  drop constraint if exists flux_backup_settings_frequency_days_check;
alter table public.flux_backup_settings
  add constraint flux_backup_settings_frequency_days_check
  check (frequency_days between 1 and 90);

commit;
