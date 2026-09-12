-- ALDECKOT | Limite de quatro notas Post-it.
-- Execute após 045_agenda_postit_notes.sql.

begin;

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

  if note_count >= 4 then
    raise exception 'Limite de 4 notas Post-it atingido. Exclua uma nota antes de criar outra.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

commit;
