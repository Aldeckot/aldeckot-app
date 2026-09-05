-- ALDECKOT | Histórico de mudança de status da Gestão TI
-- Execute após 024_control_management_status_sync.sql.
-- Atualiza a função já instalada para registrar no histórico a alteração de
-- status recebida do Controle TI, além de manter o log original copiado.

create or replace function app.sync_management_status_from_control()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  management_status text;
  matched_record record;
  existing_logs jsonb;
  next_payload jsonb;
  previous_status text;
begin
  management_status := app.management_status_from_control(new.status);
  if management_status is null
    or (nullif(btrim(new.tag), '') is null and nullif(btrim(new.serial), '') is null) then
    return new;
  end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (
        (nullif(btrim(new.tag), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'tag', ''))) = lower(btrim(new.tag)))
        or
        (nullif(btrim(new.serial), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'serial', ''))) = lower(btrim(new.serial)))
      )
  loop
    previous_status := coalesce(matched_record.payload ->> 'status', 'Ativo');
    if previous_status is not distinct from management_status then
      continue;
    end if;

    next_payload := jsonb_set(matched_record.payload, '{status}', to_jsonb(management_status), true);
    existing_logs := case
      when jsonb_typeof(matched_record.payload -> 'logs') = 'array'
        then matched_record.payload -> 'logs'
      else '[]'::jsonb
    end;
    next_payload := jsonb_set(
      next_payload,
      '{logs}',
      existing_logs || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'at', timezone('utc', now()),
        'text', format('Status atualizado pelo Controle TI: %s → %s.', previous_status, management_status),
        'source', 'Controle TI'
      )),
      true
    );
    next_payload := jsonb_set(
      next_payload,
      '{lastActivity}',
      to_jsonb(format('Status sincronizado pelo Controle TI: %s → %s.', previous_status, management_status)),
      true
    );

    update public.module_records
    set payload = next_payload
    where id = matched_record.id;
  end loop;

  return new;
end;
$$;
