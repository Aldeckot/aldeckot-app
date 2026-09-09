-- ALDECKOT | Relatórios mensais da Auditoria
-- Execute após 029_agenda_event_completion.sql no SQL Editor do Supabase.
-- Mantém os PDFs de auditoria privados e vinculados ao período apurado.

begin;

create table if not exists public.monthly_audit_reports (
  id uuid primary key default gen_random_uuid(),
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  cutoff_date date not null check (cutoff_date >= period_start and cutoff_date < (period_start + interval '1 month')::date),
  status text not null default 'draft' check (status in ('draft', 'finalized')),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  pdf_path text not null check (char_length(btrim(pdf_path)) > 0),
  pdf_name text not null check (char_length(btrim(pdf_name)) > 0),
  pdf_size bigint not null check (pdf_size > 0 and pdf_size <= 10485760),
  generated_by uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default timezone('utc', now()),
  finalized_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (period_start, cutoff_date)
);

create index if not exists monthly_audit_reports_period_idx
  on public.monthly_audit_reports (period_start desc, cutoff_date desc);

create or replace function app.touch_monthly_audit_report()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  if new.status = 'finalized' and new.finalized_at is null then
    new.finalized_at = timezone('utc', now());
  elsif new.status = 'draft' then
    new.finalized_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists monthly_audit_reports_set_updated_at on public.monthly_audit_reports;
create trigger monthly_audit_reports_set_updated_at
  before update on public.monthly_audit_reports
  for each row execute procedure app.touch_monthly_audit_report();

-- Consultas mensais percorrem apenas compromissos concluídos e eventos que já
-- alimentam o painel "Últimos itens atualizados" da Home.
create index if not exists agenda_entries_completed_at_idx
  on public.agenda_entries (completed_at desc)
  where is_completed = true;
create index if not exists sync_events_audit_created_idx
  on public.sync_events (created_at desc)
  where operation in ('create', 'update', 'delete', 'log');

alter table public.monthly_audit_reports enable row level security;
revoke all on public.monthly_audit_reports from anon;
grant select, insert, update, delete on public.monthly_audit_reports to authenticated;

drop policy if exists "Administradores acessam relatórios mensais" on public.monthly_audit_reports;
create policy "Administradores acessam relatórios mensais"
  on public.monthly_audit_reports
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- A pasta é o arquivo corporativo dos relatórios gerados. Os arquivos não são
-- públicos e só podem ser manipulados por administradores autenticados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-reports', 'audit-reports', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

drop policy if exists "Administradores leem PDFs de auditoria" on storage.objects;
drop policy if exists "Administradores gravam PDFs de auditoria" on storage.objects;
drop policy if exists "Administradores atualizam PDFs de auditoria" on storage.objects;
drop policy if exists "Administradores removem PDFs de auditoria" on storage.objects;
create policy "Administradores leem PDFs de auditoria" on storage.objects
  for select to authenticated
  using (bucket_id = 'audit-reports' and app.is_admin());
create policy "Administradores gravam PDFs de auditoria" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audit-reports' and app.is_admin());
create policy "Administradores atualizam PDFs de auditoria" on storage.objects
  for update to authenticated
  using (bucket_id = 'audit-reports' and app.is_admin())
  with check (bucket_id = 'audit-reports' and app.is_admin());
create policy "Administradores removem PDFs de auditoria" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audit-reports' and app.is_admin());

alter table public.monthly_audit_reports replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'monthly_audit_reports'
  ) then
    alter publication supabase_realtime add table public.monthly_audit_reports;
  end if;
end;
$$;

commit;
