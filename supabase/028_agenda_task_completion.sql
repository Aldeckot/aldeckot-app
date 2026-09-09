-- ALDECKOT | Conclusão persistente das tarefas da agenda.
-- Mantém a tarefa visível no quadro "Tarefas de hoje" após ser concluída.

alter table public.agenda_entries
  add column if not exists is_completed boolean not null default false,
  add column if not exists completed_at timestamptz;

create index if not exists agenda_entries_due_completion_idx
  on public.agenda_entries (due_date, is_completed, due_time);

-- A função permite que qualquer conta ativa marque uma tarefa corporativa como
-- concluída ou pendente, sem conceder permissão para alterar seu conteúdo.
create or replace function public.set_agenda_task_completion(
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
    raise exception 'Conta ativa obrigatória para concluir tarefas.' using errcode = '42501';
  end if;

  return query
  update public.agenda_entries
  set is_completed = coalesce(p_completed, false),
      completed_at = case when coalesce(p_completed, false) then timezone('utc', now()) else null end
  where agenda_entries.id = p_entry_id
    and agenda_entries.kind = 'task'
  returning agenda_entries.id, agenda_entries.is_completed, agenda_entries.completed_at;

  if not found then
    raise exception 'Tarefa não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_agenda_task_completion(uuid, boolean) from public;
grant execute on function public.set_agenda_task_completion(uuid, boolean) to authenticated;
