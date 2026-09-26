-- ALDECKOT | Valores financeiros da Central Fiscal NF-e
-- Execute após 050_defer_management_transfer_sync.sql no SQL Editor do Supabase.
-- Mantém registros antigos sem inventar valores; novos cadastros exigem ambos os campos pela interface.

begin;

alter table public.nfe_occurrences
  add column if not exists total_value numeric(14, 2),
  add column if not exists pending_value numeric(14, 2);

alter table public.nfe_occurrences
  drop constraint if exists nfe_occurrences_total_value_nonnegative_check,
  drop constraint if exists nfe_occurrences_pending_value_nonnegative_check,
  drop constraint if exists nfe_occurrences_pending_not_greater_than_total_check;

alter table public.nfe_occurrences
  add constraint nfe_occurrences_total_value_nonnegative_check
    check (total_value is null or total_value >= 0),
  add constraint nfe_occurrences_pending_value_nonnegative_check
    check (pending_value is null or pending_value >= 0),
  add constraint nfe_occurrences_pending_not_greater_than_total_check
    check (total_value is null or pending_value is null or pending_value <= total_value);

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
      'reason', old.reason,
      'totalValue', old.total_value,
      'pendingValue', old.pending_value
    );
  elsif tg_op = 'INSERT' then
    target_id := new.id;
    target_action := 'created';
    target_details := jsonb_build_object(
      'pdv', new.pdv,
      'nfeNumber', new.nfe_number,
      'reason', new.reason,
      'totalValue', new.total_value,
      'pendingValue', new.pending_value
    );
  else
    target_id := new.id;
    target_action := 'updated';
    target_details := jsonb_build_object(
      'pdv', new.pdv,
      'nfeNumber', new.nfe_number,
      'reason', new.reason,
      'totalValue', new.total_value,
      'pendingValue', new.pending_value
    );
  end if;

  insert into public.nfe_occurrence_logs (occurrence_id, actor_id, action, details)
  values (target_id, auth.uid(), target_action, target_details);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

comment on column public.nfe_occurrences.total_value is 'Valor total da NF-e, informado em reais.';
comment on column public.nfe_occurrences.pending_value is 'Valor pendente da NF-e, informado em reais.';

commit;
