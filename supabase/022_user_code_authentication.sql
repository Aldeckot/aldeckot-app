-- ALDECKOT | Login por código de usuário numérico
-- Execute após 021_fix_nfe_delete_audit.sql no SQL Editor do Supabase.
-- O e-mail permanece somente como identificador técnico privado do Supabase Auth.

begin;

create schema if not exists app;

alter table public.profiles add column if not exists user_code text;

create or replace function app.normalize_user_code(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g');
$$;

-- Cada perfil atual recebe um código numérico único. A faixa começa em 2000
-- para reservar códigos administrativos menores, como 1014.
do $$
declare
  profile_row record;
  base_code text;
  candidate_code text;
  next_code bigint := 2000;
begin
  for profile_row in
    select id, email, user_code
    from public.profiles
    order by created_at nulls last, id
  loop
    base_code := app.normalize_user_code(profile_row.user_code);
    if base_code !~ '^[0-9]{4,12}$' then
      loop
        candidate_code := next_code::text;
        next_code := next_code + 1;
        exit when not exists (select 1 from public.profiles where user_code = candidate_code and id <> profile_row.id);
      end loop;
    else
      candidate_code := base_code;
    end if;
    if exists (select 1 from public.profiles where user_code = candidate_code and id <> profile_row.id) then
      loop
        candidate_code := next_code::text;
        next_code := next_code + 1;
        exit when not exists (select 1 from public.profiles where user_code = candidate_code and id <> profile_row.id);
      end loop;
    end if;
    update public.profiles set user_code = candidate_code where id = profile_row.id;
  end loop;
end;
$$;

alter table public.profiles alter column user_code set not null;
alter table public.profiles drop constraint if exists profiles_user_code_format_check;
alter table public.profiles add constraint profiles_user_code_format_check check (user_code ~ '^[0-9]{4,12}$');
create unique index if not exists profiles_user_code_key on public.profiles (user_code);

-- Mantém o perfil sincronizado se uma conta for criada diretamente pelo Auth.
create or replace function app.create_profile_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  generated_code text;
begin
  generated_code := app.normalize_user_code(new.raw_user_meta_data ->> 'user_code');
  if generated_code !~ '^[0-9]{4,12}$' then
    generated_code := left(regexp_replace(new.id::text, '[^0-9]', '', 'g'), 12);
  end if;

  insert into public.profiles (id, display_name, full_name, user_code, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'display_name', ''),
    generated_code,
    coalesce(new.email, ''),
    'standard',
    'pending'
  )
  on conflict (id) do update
  set full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name),
      display_name = coalesce(nullif(profiles.display_name, ''), excluded.display_name),
      user_code = coalesce(nullif(profiles.user_code, ''), excluded.user_code),
      email = excluded.email;
  return new;
end;
$$;

revoke all on function app.normalize_user_code(text) from public;

commit;
