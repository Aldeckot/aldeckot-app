-- ALDECKOT | Reconhecimento individual da Central de Notificações
-- Execute após 015_authentication_and_permissions.sql no SQL Editor do Supabase.

begin;

create table if not exists public.notification_acknowledgements (
  user_id uuid not null references auth.users(id) on delete cascade,
  module text not null check (module in ('inventory', 'management', 'control', 'flux')),
  item_id uuid not null,
  state_key text not null check (char_length(state_key) between 1 and 700),
  acknowledged_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, module, item_id, state_key)
);

create index if not exists notification_acknowledgements_user_created_idx
  on public.notification_acknowledgements (user_id, acknowledged_at desc);

alter table public.notification_acknowledgements enable row level security;
revoke all on public.notification_acknowledgements from anon;
grant select, insert on public.notification_acknowledgements to authenticated;

drop policy if exists "Usuário consulta seus reconhecimentos" on public.notification_acknowledgements;
drop policy if exists "Usuário reconhece seus alertas" on public.notification_acknowledgements;
create policy "Usuário consulta seus reconhecimentos"
  on public.notification_acknowledgements for select to authenticated
  using (app.has_active_account() and user_id = auth.uid());
create policy "Usuário reconhece seus alertas"
  on public.notification_acknowledgements for insert to authenticated
  with check (app.has_active_account() and user_id = auth.uid());

alter table public.notification_acknowledgements replica identity full;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_acknowledgements'
  ) then
    alter publication supabase_realtime add table public.notification_acknowledgements;
  end if;
end;
$$;

commit;
