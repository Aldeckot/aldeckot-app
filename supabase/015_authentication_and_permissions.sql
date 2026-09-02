-- ALDECKOT | Autenticação, perfis e permissões corporativas
-- Execute após 014_centralized_realtime.sql no SQL Editor do Supabase.
-- Não contém senhas, chaves ou dados sensíveis.

begin;

create schema if not exists app;

-- Perfis vinculados exclusivamente ao usuário autenticado do Supabase Auth.
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists status text;
alter table public.profiles add column if not exists last_sign_in_at timestamptz;

update public.profiles
set full_name = coalesce(nullif(full_name, ''), nullif(display_name, ''), 'Usuário ALDECKOT'),
    email = coalesce(nullif(email, ''), ''),
    role = coalesce(nullif(role, ''), 'standard'),
    status = coalesce(nullif(status, ''), 'pending');

alter table public.profiles alter column full_name set default '';
alter table public.profiles alter column email set default '';
alter table public.profiles alter column role set default 'standard';
alter table public.profiles alter column status set default 'pending';
alter table public.profiles alter column full_name set not null;
alter table public.profiles alter column email set not null;
alter table public.profiles alter column role set not null;
alter table public.profiles alter column status set not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'standard'));
alter table public.profiles add constraint profiles_status_check check (status in ('pending', 'active', 'blocked'));

create table if not exists public.user_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(btrim(action)) between 1 and 100),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists user_audit_logs_target_created_idx on public.user_audit_logs (target_user_id, created_at desc);
create index if not exists user_audit_logs_actor_created_idx on public.user_audit_logs (actor_id, created_at desc);

-- Toda conta criada pelo Auth começa pendente e sem privilégios administrativos.
create or replace function app.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, full_name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.email, ''),
    'standard',
    'pending'
  )
  on conflict (id) do update
  set full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name),
      display_name = coalesce(nullif(profiles.display_name, ''), excluded.display_name),
      email = excluded.email;
  return new;
end;
$$;

drop trigger if exists aldeckot_on_auth_user_created on auth.users;
create trigger aldeckot_on_auth_user_created
  after insert on auth.users
  for each row execute procedure app.create_profile_for_user();

-- Funções sem dados expostos usadas nas políticas RLS.
create or replace function app.has_active_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active'
  );
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = 'admin'
  );
$$;

-- Usuários ativos consultam a base compartilhada; somente administradores a alteram.
do $$
declare target_table text; policy_row record;
begin
  foreach target_table in array array[
    'module_tables', 'inventory_items', 'inventory_item_logs', 'module_records',
    'inventory_backups', 'inventory_backup_settings', 'sync_events', 'control_items',
    'control_item_logs', 'control_backups', 'control_backup_settings', 'flux_items',
    'flux_item_logs', 'flux_backups', 'flux_backup_settings', 'management_backups',
    'management_backup_settings'
  ]
  loop
    for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = target_table loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, target_table);
    end loop;
    execute format('alter table public.%I enable row level security', target_table);
    execute format('revoke all on table public.%I from anon', target_table);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', target_table);
    execute format('create policy %I on public.%I for select to authenticated using (app.has_active_account())', 'Contas ativas consultam', target_table);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_admin()) with check (app.is_admin())', 'Administradores gerenciam', target_table);
  end loop;
end;
$$;

-- Agenda: a única escrita liberada ao perfil padrão é a criação de tarefas e eventos.
do $$
declare policy_row record;
begin
  for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = 'agenda_entries' loop
    execute format('drop policy if exists %I on public.agenda_entries', policy_row.policyname);
  end loop;
  alter table public.agenda_entries enable row level security;
  revoke all on public.agenda_entries from anon;
  grant select, insert, update, delete on public.agenda_entries to authenticated;
  create policy "Contas ativas consultam agenda" on public.agenda_entries for select to authenticated using (app.has_active_account());
  create policy "Contas ativas criam agenda" on public.agenda_entries for insert to authenticated with check (app.has_active_account());
  create policy "Administradores gerenciam agenda" on public.agenda_entries for all to authenticated using (app.is_admin()) with check (app.is_admin());
end;
$$;

-- Perfis e auditoria não recebem escrita direta pelo navegador.
do $$
declare policy_row record;
begin
  for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy if exists %I on public.profiles', policy_row.policyname);
  end loop;
  alter table public.profiles enable row level security;
  revoke all on public.profiles from anon, authenticated;
  grant select on public.profiles to authenticated;
  create policy "Usuário consulta o próprio perfil" on public.profiles for select to authenticated using (id = auth.uid());
  create policy "Administrador consulta perfis" on public.profiles for select to authenticated using (app.is_admin());

  for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = 'user_audit_logs' loop
    execute format('drop policy if exists %I on public.user_audit_logs', policy_row.policyname);
  end loop;
  alter table public.user_audit_logs enable row level security;
  revoke all on public.user_audit_logs from anon, authenticated;
  grant select on public.user_audit_logs to authenticated;
  create policy "Administrador consulta auditoria" on public.user_audit_logs for select to authenticated using (app.is_admin());
end;
$$;

revoke all on function public.central_equipment_search(text) from anon;
revoke all on function public.central_equipment_timeline(text, text, uuid[]) from anon;
grant execute on function public.central_equipment_search(text), public.central_equipment_timeline(text, text, uuid[]) to authenticated;
grant execute on function app.has_active_account(), app.is_admin() to authenticated;

-- Alterações de perfil (aprovação, bloqueio ou mudança de papel) também chegam à sessão aberta.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;

commit;
