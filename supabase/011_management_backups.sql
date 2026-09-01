-- ALDECKOT | Backups privados da Gestão TI
-- Execute após 010_management_ti.sql.

create table if not exists public.management_backups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default 'Backup da Gestão TI' check (char_length(btrim(label)) between 1 and 120),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source text not null default 'network' check (source in ('local', 'network')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists management_backups_owner_created_idx
  on public.management_backups (owner_id, created_at desc);

alter table public.management_backups enable row level security;

drop policy if exists "Management backups are private" on public.management_backups;
create policy "Management backups are private" on public.management_backups
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update, delete on public.management_backups to authenticated;
