-- ALDECKOT | Central Fiscal NF-e
-- Execute após 017_notification_acknowledgements.sql no SQL Editor do Supabase.
-- Os registros são corporativos e os PDFs permanecem privados no Storage.

begin;

create table if not exists public.nfe_occurrences (
  id uuid primary key default gen_random_uuid(),
  operator text not null check (char_length(btrim(operator)) between 2 and 140),
  operator_code text not null check (char_length(btrim(operator_code)) between 1 and 80),
  fiscal text not null check (char_length(btrim(fiscal)) between 2 and 140),
  occurred_at timestamptz not null,
  pdv text not null check (char_length(btrim(pdv)) between 1 and 120),
  nfe_number text not null check (char_length(btrim(nfe_number)) between 1 and 120),
  reason text not null check (reason in ('Erro no SASII', 'Erro no Pin Pad', 'Travamento do PC', 'Erro no cartão')),
  notes text not null default '',
  pdf_path text not null check (char_length(btrim(pdf_path)) > 0),
  pdf_name text not null check (char_length(btrim(pdf_name)) > 0),
  pdf_size bigint not null check (pdf_size > 0 and pdf_size <= 10485760),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists nfe_occurrences_occurred_at_idx on public.nfe_occurrences (occurred_at desc);
create index if not exists nfe_occurrences_reason_occurred_at_idx on public.nfe_occurrences (reason, occurred_at desc);
create index if not exists nfe_occurrences_pdv_week_idx on public.nfe_occurrences (lower(btrim(pdv)), occurred_at desc);
create index if not exists nfe_occurrences_created_at_idx on public.nfe_occurrences (created_at desc);

create table if not exists public.nfe_occurrence_logs (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid references public.nfe_occurrences(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists nfe_occurrence_logs_occurrence_created_idx on public.nfe_occurrence_logs (occurrence_id, created_at desc);

create table if not exists public.nfe_backups (
  id uuid primary key default gen_random_uuid(),
  label text not null default 'Backup Fiscal NF-e',
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists nfe_backups_created_at_idx on public.nfe_backups (created_at desc);

create or replace function app.touch_nfe_occurrence()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function app.audit_nfe_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  target_action text;
  target_details jsonb;
begin
  if tg_op = 'DELETE' then
    -- O registro pai já está sendo removido. Mantemos a referência no JSON
    -- para auditoria sem criar uma chave estrangeira inválida no histórico.
    target_id := null;
    target_action := 'deleted';
    target_details := jsonb_build_object('occurrenceId', old.id, 'pdv', old.pdv, 'nfeNumber', old.nfe_number, 'reason', old.reason);
  elsif tg_op = 'INSERT' then
    target_id := new.id;
    target_action := 'created';
    target_details := jsonb_build_object('pdv', new.pdv, 'nfeNumber', new.nfe_number, 'reason', new.reason);
  else
    target_id := new.id;
    target_action := 'updated';
    target_details := jsonb_build_object('pdv', new.pdv, 'nfeNumber', new.nfe_number, 'reason', new.reason);
  end if;
  insert into public.nfe_occurrence_logs (occurrence_id, actor_id, action, details)
  values (target_id, auth.uid(), target_action, target_details);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists nfe_occurrences_touch on public.nfe_occurrences;
create trigger nfe_occurrences_touch
  before update on public.nfe_occurrences
  for each row execute procedure app.touch_nfe_occurrence();
drop trigger if exists nfe_occurrences_audit on public.nfe_occurrences;
create trigger nfe_occurrences_audit
  after insert or update or delete on public.nfe_occurrences
  for each row execute procedure app.audit_nfe_occurrence();

-- Métricas enxutas, calculadas na fonte de dados e respeitando a RLS do usuário ativo.
create or replace function public.nfe_dashboard_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with boundaries as (
    select
      date_trunc('day', timezone('America/Sao_Paulo', now())) at time zone 'America/Sao_Paulo' as day_start,
      date_trunc('month', timezone('America/Sao_Paulo', now())) at time zone 'America/Sao_Paulo' as month_start
  ), reason_counts as (
    select reason, count(*)::integer as total from public.nfe_occurrences group by reason
  )
  select jsonb_build_object(
    'total', (select count(*)::integer from public.nfe_occurrences),
    'today', (select count(*)::integer from public.nfe_occurrences, boundaries where occurred_at >= day_start),
    'month', (select count(*)::integer from public.nfe_occurrences, boundaries where occurred_at >= month_start),
    'reasons', coalesce((select jsonb_object_agg(reason, total) from reason_counts), '{}'::jsonb)
  );
$$;

-- Quarto registro (ou mais) do mesmo PDV na semana gera alerta para investigação.
create or replace function public.nfe_recurring_pdv_alerts()
returns table (occurrence_id uuid, pdv text, occurrences integer, latest_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with week_start as (
    select date_trunc('week', timezone('America/Sao_Paulo', now())) at time zone 'America/Sao_Paulo' as value
  )
  select (array_agg(source.id order by source.occurred_at desc))[1], min(source.pdv)::text, count(*)::integer, max(source.occurred_at)
  from public.nfe_occurrences source, week_start
  where source.occurred_at >= week_start.value
  group by lower(btrim(source.pdv))
  having count(*) > 3
  order by max(source.occurred_at) desc;
$$;

alter table public.nfe_occurrences enable row level security;
alter table public.nfe_occurrence_logs enable row level security;
alter table public.nfe_backups enable row level security;
revoke all on public.nfe_occurrences, public.nfe_occurrence_logs, public.nfe_backups from anon;
revoke all on public.nfe_occurrence_logs from authenticated;
grant select, insert, update, delete on public.nfe_occurrences, public.nfe_backups to authenticated;
grant select on public.nfe_occurrence_logs to authenticated;

drop policy if exists "Contas ativas consultam NF-e" on public.nfe_occurrences;
drop policy if exists "Administradores gerenciam NF-e" on public.nfe_occurrences;
create policy "Contas ativas consultam NF-e" on public.nfe_occurrences for select to authenticated using (app.has_active_account());
create policy "Administradores gerenciam NF-e" on public.nfe_occurrences for all to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists "Contas ativas consultam auditoria NF-e" on public.nfe_occurrence_logs;
drop policy if exists "Administradores gerenciam auditoria NF-e" on public.nfe_occurrence_logs;
create policy "Contas ativas consultam auditoria NF-e" on public.nfe_occurrence_logs for select to authenticated using (app.has_active_account());

drop policy if exists "Contas ativas consultam backups NF-e" on public.nfe_backups;
drop policy if exists "Administradores gerenciam backups NF-e" on public.nfe_backups;
create policy "Contas ativas consultam backups NF-e" on public.nfe_backups for select to authenticated using (app.has_active_account());
create policy "Administradores gerenciam backups NF-e" on public.nfe_backups for all to authenticated using (app.is_admin()) with check (app.is_admin());

-- A Central de Notificações também pode registrar a confirmação de alertas do Fiscal NF-e.
alter table public.notification_acknowledgements drop constraint if exists notification_acknowledgements_module_check;
alter table public.notification_acknowledgements add constraint notification_acknowledgements_module_check
  check (module in ('inventory', 'management', 'control', 'flux', 'nfe'));

-- Bucket privado: apenas contas ativas leem; somente administradores gravam ou removem PDFs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nfe-pdfs', 'nfe-pdfs', false, 10485760, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists "Contas ativas leem PDFs NF-e" on storage.objects;
drop policy if exists "Administradores gravam PDFs NF-e" on storage.objects;
drop policy if exists "Administradores atualizam PDFs NF-e" on storage.objects;
drop policy if exists "Administradores removem PDFs NF-e" on storage.objects;
create policy "Contas ativas leem PDFs NF-e" on storage.objects for select to authenticated using (bucket_id = 'nfe-pdfs' and app.has_active_account());
create policy "Administradores gravam PDFs NF-e" on storage.objects for insert to authenticated with check (bucket_id = 'nfe-pdfs' and app.is_admin());
create policy "Administradores atualizam PDFs NF-e" on storage.objects for update to authenticated using (bucket_id = 'nfe-pdfs' and app.is_admin()) with check (bucket_id = 'nfe-pdfs' and app.is_admin());
create policy "Administradores removem PDFs NF-e" on storage.objects for delete to authenticated using (bucket_id = 'nfe-pdfs' and app.is_admin());

alter table public.nfe_occurrences replica identity full;
alter table public.nfe_occurrence_logs replica identity full;
alter table public.nfe_backups replica identity full;

do $$
declare target_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach target_table in array array['nfe_occurrences', 'nfe_occurrence_logs', 'nfe_backups'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target_table) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;

revoke all on function public.nfe_dashboard_metrics(), public.nfe_recurring_pdv_alerts() from anon;
grant execute on function public.nfe_dashboard_metrics(), public.nfe_recurring_pdv_alerts() to authenticated;

commit;
