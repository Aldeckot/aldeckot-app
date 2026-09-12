-- ALDECKOT | Notas Post-it integradas à Agenda.
-- Execute após 044_route_management_maintenance_to_current_month.sql.

begin;

alter table public.agenda_entries
  add column if not exists postit_level text,
  add column if not exists postit_tasks jsonb not null default '[]'::jsonb;

alter table public.agenda_entries
  drop constraint if exists agenda_entries_kind_check;

alter table public.agenda_entries
  add constraint agenda_entries_kind_check
  check (kind in ('event', 'task', 'note'));

alter table public.agenda_entries
  drop constraint if exists agenda_entries_postit_level_check;

alter table public.agenda_entries
  add constraint agenda_entries_postit_level_check
  check (
    (kind <> 'note' and postit_level is null)
    or (kind = 'note' and postit_level in ('urgent', 'maintenance', 'verify', 'network', 'update', 'equipment'))
  );

alter table public.agenda_entries
  drop constraint if exists agenda_entries_postit_tasks_check;

alter table public.agenda_entries
  add constraint agenda_entries_postit_tasks_check
  check (jsonb_typeof(postit_tasks) = 'array');

-- A base corporativa centralizada não tem owner_id; instalações privadas têm.
-- O índice e a regra de limite se adaptam aos dois modelos.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenda_entries'
      and column_name = 'owner_id'
  ) then
    execute 'create index if not exists agenda_entries_owner_note_idx on public.agenda_entries (owner_id, created_at desc) where kind = ''note''';
  else
    execute 'create index if not exists agenda_entries_note_idx on public.agenda_entries (created_at desc) where kind = ''note''';
  end if;
end;
$$;

create or replace function app.limit_agenda_postit_notes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  note_count integer;
  notes_require_owner boolean;
  note_owner_id uuid;
begin
  if new.kind <> 'note' then
    new.postit_level := null;
    new.postit_tasks := '[]'::jsonb;
    return new;
  end if;

  new.postit_level := coalesce(new.postit_level, 'verify');
  new.postit_tasks := coalesce(new.postit_tasks, '[]'::jsonb);

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenda_entries'
      and column_name = 'owner_id'
  ) into notes_require_owner;

  if notes_require_owner then
    note_owner_id := nullif(to_jsonb(new) ->> 'owner_id', '')::uuid;
    if note_owner_id is null then
      raise exception 'Não foi possível identificar o proprietário da nota Post-it.'
        using errcode = 'P0001';
    end if;

    perform pg_advisory_xact_lock(hashtext(note_owner_id::text));
    execute
      'select count(*) from public.agenda_entries where owner_id = $1 and kind = ''note'' and id is distinct from $2'
      into note_count
      using note_owner_id, new.id;
  else
    perform pg_advisory_xact_lock(hashtext('aldeckot-central-postit-notes'));
    select count(*)
      into note_count
    from public.agenda_entries
    where kind = 'note'
      and id is distinct from new.id;
  end if;

  if note_count >= 9 then
    raise exception 'Limite de 9 notas Post-it atingido. Exclua uma nota antes de criar outra.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists agenda_entries_limit_postit_notes on public.agenda_entries;
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agenda_entries'
      and column_name = 'owner_id'
  ) then
    execute 'create trigger agenda_entries_limit_postit_notes before insert or update of kind, owner_id, postit_level, postit_tasks on public.agenda_entries for each row execute procedure app.limit_agenda_postit_notes()';
  else
    execute 'create trigger agenda_entries_limit_postit_notes before insert or update of kind, postit_level, postit_tasks on public.agenda_entries for each row execute procedure app.limit_agenda_postit_notes()';
  end if;
end;
$$;

-- Notas permanecem na Home até serem removidas manualmente.
create or replace function public.purge_expired_agenda_entries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged_count integer;
begin
  delete from public.agenda_entries
  where kind <> 'note'
    and (((created_at at time zone 'America/Sao_Paulo')::date + interval '2 months')::date)
      <= (timezone('America/Sao_Paulo', now()))::date;

  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

commit;
