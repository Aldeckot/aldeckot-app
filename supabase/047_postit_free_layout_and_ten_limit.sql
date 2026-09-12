-- ALDECKOT | Post-its livres, bloqueados após criação e limite de dez notas.
-- Pode ser executada diretamente após 045_agenda_postit_notes.sql.
-- Ela substitui a regra de limite introduzida pela 046.

begin;

alter table public.agenda_entries
  add column if not exists postit_layout jsonb not null default '{}'::jsonb;

alter table public.agenda_entries
  drop constraint if exists agenda_entries_postit_layout_check;

alter table public.agenda_entries
  add constraint agenda_entries_postit_layout_check
  check (jsonb_typeof(postit_layout) = 'object');

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
    new.postit_layout := '{}'::jsonb;
    return new;
  end if;

  new.postit_level := coalesce(new.postit_level, 'verify');
  new.postit_tasks := coalesce(new.postit_tasks, '[]'::jsonb);
  new.postit_layout := coalesce(new.postit_layout, '{}'::jsonb);

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
      'select count(*) from public.agenda_entries where owner_id = $1 and kind = ''note'' and id is distinct from $2 and (jsonb_array_length(coalesce(postit_tasks, ''[]''::jsonb)) = 0 or exists (select 1 from jsonb_array_elements(coalesce(postit_tasks, ''[]''::jsonb)) as task where coalesce((task ->> ''completed'')::boolean, false) = false))'
      into note_count
      using note_owner_id, new.id;
  else
    perform pg_advisory_xact_lock(hashtext('aldeckot-central-postit-notes'));
    select count(*)
      into note_count
    from public.agenda_entries
    where kind = 'note'
      and id is distinct from new.id
      and (
        jsonb_array_length(coalesce(postit_tasks, '[]'::jsonb)) = 0
        or exists (
          select 1
          from jsonb_array_elements(coalesce(postit_tasks, '[]'::jsonb)) as task
          where coalesce((task ->> 'completed')::boolean, false) = false
        )
      );
  end if;

  if note_count >= 10 then
    raise exception 'Limite de 10 notas Post-it atingido. Finalize as notas pendentes antes de criar outra.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function app.lock_agenda_postit_content()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_task_shape jsonb;
  new_task_shape jsonb;
begin
  if old.kind <> 'note' then
    return new;
  end if;

  if new.kind is distinct from old.kind
    or new.title is distinct from old.title
    or new.due_date is distinct from old.due_date
    or new.due_time is distinct from old.due_time
    or new.reminder_minutes is distinct from old.reminder_minutes
    or new.priority is distinct from old.priority
    or new.notes is distinct from old.notes
    or new.postit_level is distinct from old.postit_level then
    raise exception 'O conteúdo da nota Post-it fica bloqueado após a criação.'
      using errcode = 'P0001';
  end if;

  if new.postit_tasks is distinct from old.postit_tasks then
    select coalesce(jsonb_agg(task - 'completed' order by position), '[]'::jsonb)
      into old_task_shape
    from jsonb_array_elements(coalesce(old.postit_tasks, '[]'::jsonb)) with ordinality as entries(task, position);
    select coalesce(jsonb_agg(task - 'completed' order by position), '[]'::jsonb)
      into new_task_shape
    from jsonb_array_elements(coalesce(new.postit_tasks, '[]'::jsonb)) with ordinality as entries(task, position);
    if new_task_shape is distinct from old_task_shape then
      raise exception 'Após a criação, apenas a conclusão das tarefas pode ser alterada.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists agenda_entries_lock_postit_content on public.agenda_entries;
create trigger agenda_entries_lock_postit_content
before update on public.agenda_entries
for each row execute procedure app.lock_agenda_postit_content();

commit;
