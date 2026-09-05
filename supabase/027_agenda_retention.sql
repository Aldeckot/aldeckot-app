-- Retém tarefas e eventos por dois meses-calendário a partir da data de criação.
-- Exemplo: 08/08/2026 permanece até 07/10/2026 e é removido em 08/10/2026.

create index if not exists agenda_entries_created_at_idx
  on public.agenda_entries (created_at);

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
  where (((created_at at time zone 'America/Sao_Paulo')::date + interval '2 months')::date)
    <= (timezone('America/Sao_Paulo', now()))::date;

  get diagnostics purged_count = row_count;
  return purged_count;
end;
$$;

revoke all on function public.purge_expired_agenda_entries() from public;
grant execute on function public.purge_expired_agenda_entries() to authenticated;

-- Executa todos os dias às 00:05 no horário de São Paulo (03:05 UTC).
-- Se a extensão pg_cron não estiver habilitada no projeto, a aplicação ainda
-- remove os registros vencidos na primeira abertura da agenda.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $command$
      select cron.unschedule(jobid)
      from cron.job
      where jobname = 'aldeckot-purge-expired-agenda-entries'
    $command$;

    execute format(
      'select cron.schedule(%L, %L, %L)',
      'aldeckot-purge-expired-agenda-entries',
      '5 3 * * *',
      'select public.purge_expired_agenda_entries()'
    );
  else
    raise notice 'pg_cron não está habilitado: a aplicação fará a limpeza ao abrir a agenda.';
  end if;
end;
$$;

-- Limpa imediatamente itens que já ultrapassaram o período de retenção.
select public.purge_expired_agenda_entries();
