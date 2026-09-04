-- ALDECKOT | Correção da auditoria de exclusão Fiscal NF-e
-- Execute após 020_nfe_backup_settings.sql no SQL Editor do Supabase.
-- Uma ocorrência pode possuir vários registros de auditoria; o log de exclusão
-- é preservado sem manter uma chave estrangeira para a NF-e já removida.

begin;

alter table public.nfe_occurrence_logs
  drop constraint if exists nfe_occurrence_logs_occurrence_id_key;

create or replace function app.audit_nfe_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  target_action text;
  target_details jsonb;
begin
  if tg_op = 'DELETE' then
    target_id := null;
    target_action := 'deleted';
    target_details := jsonb_build_object(
      'occurrenceId', old.id,
      'pdv', old.pdv,
      'nfeNumber', old.nfe_number,
      'reason', old.reason
    );
  elsif tg_op = 'INSERT' then
    target_id := new.id;
    target_action := 'created';
    target_details := jsonb_build_object('pdv', new.pdv, 'nfeNumber', new.nfe_number, 'reason', new.reason);
  else
    target_id := new.id;
    target_action := 'updated';
    target_details := jsonb_build_object('pdv', new.pdv, 'nfeNumber', new.nfe_number, 'reason', new.reason);
  end if;

  insert into public.nfe_occurrence_logs (occurrence_id, actor_id, action, details)
  values (target_id, auth.uid(), target_action, target_details);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

commit;
