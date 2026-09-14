-- ALDECKOT | Edição controlada de notas Post-it.
-- Execute após 047_postit_free_layout_and_ten_limit.sql.

begin;

-- Mantém o tipo da entrada protegido, mas permite alterar o conteúdo da nota
-- por meio do modal de edição da Home.
create or replace function app.validate_agenda_postit_edit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.kind = 'note' and new.kind is distinct from old.kind then
    raise exception 'Uma nota Post-it não pode ser convertida em outro tipo de agendamento.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists agenda_entries_lock_postit_content on public.agenda_entries;
drop trigger if exists agenda_entries_validate_postit_edit on public.agenda_entries;
create trigger agenda_entries_validate_postit_edit
before update on public.agenda_entries
for each row execute procedure app.validate_agenda_postit_edit();

commit;
