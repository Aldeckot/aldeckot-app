-- ALDECKOT | Integração entre Controle TI e Gestão TI
-- Execute após 014_centralized_realtime.sql, 015_authentication_and_permissions.sql
-- e 023_management_fixed_terminals.sql.
--
-- Um item do Controle TI localizado por TAG ou Nº de série atualiza o PC
-- correspondente da Gestão TI. Cada registro criado no histórico do Controle
-- também é copiado para o histórico do PC encontrado.

create or replace function app.management_status_from_control(control_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(coalesce(control_status, '')))
    when 'em manutenção' then 'Manutenção'
    when 'manutenção' then 'Manutenção'
    when 'manutencao' then 'Manutenção'
    when 'manutenção concluída' then 'Ativo'
    when 'manutencao concluida' then 'Ativo'
    when 'aguardando avaliação' then 'Defeito'
    when 'aguardando avaliacao' then 'Defeito'
    when 'em uso' then 'Ativo'
    when 'em sala' then 'Manutenção'
    when 'descartado' then 'Desativado'
    else null
  end;
$$;

create or replace function app.sync_management_status_from_control()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  management_status text;
  matched_record record;
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

    next_payload := jsonb_set(
      matched_record.payload,
      '{status}',
      to_jsonb(management_status),
      true
    );
    next_payload := jsonb_set(
      next_payload,
      '{lastActivity}',
      to_jsonb(format(
        'Status sincronizado pelo Controle TI: %s → %s.',
        previous_status,
        management_status
      )),
      true
    );

    update public.module_records
    set payload = next_payload
    where id = matched_record.id;
  end loop;

  return new;
end;
$$;

create or replace function app.copy_control_log_to_management()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  control_item record;
  matched_record record;
  existing_logs jsonb;
  next_payload jsonb;
begin
  select id, tag, serial
  into control_item
  from public.control_items
  where id = new.control_item_id;

  if control_item.id is null
    or (nullif(btrim(control_item.tag), '') is null and nullif(btrim(control_item.serial), '') is null) then
    return new;
  end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (
        (nullif(btrim(control_item.tag), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'tag', ''))) = lower(btrim(control_item.tag)))
        or
        (nullif(btrim(control_item.serial), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'serial', ''))) = lower(btrim(control_item.serial)))
      )
  loop
    existing_logs := case
      when jsonb_typeof(matched_record.payload -> 'logs') = 'array'
        then matched_record.payload -> 'logs'
      else '[]'::jsonb
    end;
    next_payload := jsonb_set(
      matched_record.payload,
      '{logs}',
      existing_logs || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'at', new.created_at,
        'text', new.message,
        'source', 'Controle TI',
        'controlLogId', new.id::text
      )),
      true
    );
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(new.message), true);

    update public.module_records
    set payload = next_payload
    where id = matched_record.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists control_item_management_status_sync on public.control_items;
create trigger control_item_management_status_sync
  after insert or update of status, tag, serial on public.control_items
  for each row execute procedure app.sync_management_status_from_control();

drop trigger if exists control_log_management_history_sync on public.control_item_logs;
create trigger control_log_management_history_sync
  after insert on public.control_item_logs
  for each row execute procedure app.copy_control_log_to_management();
