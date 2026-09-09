-- ALDECKOT | Estende a conclusão persistente para eventos da agenda.
-- Execute após 028_agenda_task_completion.sql.

create or replace function public.set_agenda_entry_completion(
  p_entry_id uuid,
  p_completed boolean
)
returns table (id uuid, is_completed boolean, completed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa obrigatória para concluir compromissos.' using errcode = '42501';
  end if;

  return query
  update public.agenda_entries
  set is_completed = coalesce(p_completed, false),
      completed_at = case when coalesce(p_completed, false) then timezone('utc', now()) else null end
  where agenda_entries.id = p_entry_id
  returning agenda_entries.id, agenda_entries.is_completed, agenda_entries.completed_at;

  if not found then
    raise exception 'Tarefa ou evento não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_agenda_entry_completion(uuid, boolean) from public;
grant execute on function public.set_agenda_entry_completion(uuid, boolean) to authenticated;
