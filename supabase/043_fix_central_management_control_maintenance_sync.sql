-- ALDECKOT | Correção da sincronização corporativa Gestão TI -> Controle TI
-- Execute após 042_fix_management_control_maintenance_owner.sql.
--
-- A base corporativa centralizada não usa owner_id em module_records. Esta
-- versão mantém o vínculo técnico por management_record_id e identifica de
-- forma segura se versões privadas ainda exigem owner_id em itens e logs.

begin;

alter table public.control_items
  add column if not exists management_record_id uuid
  references public.module_records(id) on delete set null;

create unique index if not exists control_items_management_record_unique
  on public.control_items (management_record_id)
  where management_record_id is not null;

create or replace function app.management_requires_control(p_payload jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(btrim(coalesce(p_payload ->> 'status', ''))) in ('manutenção', 'manutencao', 'em manutenção', 'em manutencao', 'defeito')
    or lower(btrim(coalesce(p_payload ->> 'situation', ''))) in ('em manutenção', 'em manutencao');
$$;

-- Compatibilidade entre a base corporativa centralizada e instalações antigas
-- que ainda exigem owner_id nos logs do Controle TI.
create or replace function app.add_management_control_log(
  p_control_item_id uuid,
  p_action text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  control_logs_require_owner boolean;
  control_item_owner_id uuid;
  control_table_id uuid;
  control_table_owner_id uuid;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'control_item_logs'
      and column_name = 'owner_id'
  ) into control_logs_require_owner;

  if not control_logs_require_owner then
    insert into public.control_item_logs (control_item_id, action, message)
    values (p_control_item_id, p_action, p_message);
    return;
  end if;

  select nullif(to_jsonb(item) ->> 'owner_id', '')::uuid, item.table_id
  into control_item_owner_id, control_table_id
  from public.control_items item
  where item.id = p_control_item_id;

  if control_item_owner_id is null then
    select nullif(to_jsonb(table_row) ->> 'owner_id', '')::uuid
    into control_table_owner_id
    from public.module_tables table_row
    where table_row.id = control_table_id;
    control_item_owner_id := control_table_owner_id;
  end if;

  if control_item_owner_id is null then
    raise exception 'Não foi possível identificar o proprietário do item do Controle TI';
  end if;

  execute
    'insert into public.control_item_logs (control_item_id, owner_id, action, message) values ($1, $2, $3, $4)'
  using p_control_item_id, control_item_owner_id, p_action, p_message;
end;
$$;

create or replace function app.sync_management_record_to_control(
  p_management_record_id uuid,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_control_table_id uuid;
  control_items_require_owner boolean;
  control_item_owner_id uuid;
  existing_control_id uuid;
  existing_control_status text;
  existing_control_management_id uuid;
  source_tag text;
  source_serial text;
  equipment_name text;
  model_name text;
  cleaning_value text;
  sync_message text;
  control_item_id uuid;
begin
  if not app.management_requires_control(p_payload) then
    return false;
  end if;

  if not exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where record_row.id = p_management_record_id
      and table_row.module = 'management'
  ) then
    return false;
  end if;

  -- Em ambiente corporativo, a última tabela criada é compartilhada pela operação.
  select table_row.id
  into latest_control_table_id
  from public.module_tables table_row
  where table_row.module = 'control'
  order by table_row.created_at desc, table_row.id desc
  limit 1;

  if latest_control_table_id is null then
    return false;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'control_items'
      and column_name = 'owner_id'
  ) into control_items_require_owner;

  if control_items_require_owner then
    select nullif(to_jsonb(table_row) ->> 'owner_id', '')::uuid
    into control_item_owner_id
    from public.module_tables table_row
    where table_row.id = latest_control_table_id;

    if control_item_owner_id is null then
      select nullif(to_jsonb(item) ->> 'owner_id', '')::uuid
      into control_item_owner_id
      from public.control_items item
      where item.table_id = latest_control_table_id
      order by item.updated_at desc
      limit 1;
    end if;

    if control_item_owner_id is null then
      raise exception 'Não foi possível identificar o proprietário da tabela do Controle TI';
    end if;
  end if;

  source_tag := nullif(lower(btrim(coalesce(p_payload ->> 'tag', ''))), '');
  source_serial := nullif(lower(btrim(coalesce(p_payload ->> 'serial', p_payload ->> 'numeroSerie', ''))), '');
  if source_tag in ('-', '***') then source_tag := null; end if;
  if source_serial in ('-', '***') then source_serial := null; end if;

  equipment_name := coalesce(
    nullif(btrim(p_payload ->> 'equipment'), ''),
    nullif(btrim(p_payload ->> 'terminal'), ''),
    'Terminal sem nome'
  );
  model_name := coalesce(nullif(btrim(p_payload ->> 'model'), ''), 'Não informado');
  cleaning_value := case lower(btrim(coalesce(p_payload ->> 'cleaning', '')))
    when 'completa' then 'Completa'
    when 'preventiva' then 'Preventiva'
    when 'regular' then 'Regular'
    else 'Não realizada'
  end;
  sync_message := format(
    'Sincronizado automaticamente da Gestão TI: %s marcado para manutenção.',
    equipment_name
  );

  select item.id, item.status, item.management_record_id
  into existing_control_id, existing_control_status, existing_control_management_id
  from public.control_items item
  where item.management_record_id = p_management_record_id
    or (source_tag is not null and lower(btrim(coalesce(item.tag, ''))) = source_tag)
    or (source_serial is not null and lower(btrim(coalesce(item.serial, ''))) = source_serial)
  order by (item.management_record_id = p_management_record_id) desc, item.updated_at desc
  limit 1
  for update;

  if existing_control_id is not null then
    if existing_control_status is not distinct from 'Em manutenção'
      and existing_control_management_id is not distinct from p_management_record_id then
      return false;
    end if;

    update public.control_items
    set management_record_id = p_management_record_id,
        status = 'Em manutenção'
    where id = existing_control_id;

    perform app.add_management_control_log(existing_control_id, 'update', sync_message);
    return true;
  end if;

  if control_items_require_owner then
    execute $insert_control_item_with_owner$
      insert into public.control_items (
        table_id, owner_id, management_record_id, equipment, model, brand, serial, tag,
        sector, entry_date, status, cleaning_type, notes, position
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      returning id
    $insert_control_item_with_owner$
    into control_item_id
    using latest_control_table_id, control_item_owner_id, p_management_record_id,
      equipment_name, model_name, coalesce(p_payload ->> 'brand', ''),
      coalesce(p_payload ->> 'serial', p_payload ->> 'numeroSerie', ''), coalesce(p_payload ->> 'tag', ''),
      coalesce(nullif(btrim(p_payload ->> 'sector'), ''), nullif(btrim(p_payload ->> 'area'), ''), ''),
      current_date, 'Em manutenção', cleaning_value,
      'Registro criado automaticamente a partir da Gestão TI para acompanhamento técnico.', 0;
  else
    insert into public.control_items (
      table_id, management_record_id, equipment, model, brand, serial, tag,
      sector, entry_date, status, cleaning_type, notes, position
    )
    values (
      latest_control_table_id,
      p_management_record_id,
      equipment_name,
      model_name,
      coalesce(p_payload ->> 'brand', ''),
      coalesce(p_payload ->> 'serial', p_payload ->> 'numeroSerie', ''),
      coalesce(p_payload ->> 'tag', ''),
      coalesce(nullif(btrim(p_payload ->> 'sector'), ''), nullif(btrim(p_payload ->> 'area'), ''), ''),
      current_date,
      'Em manutenção',
      cleaning_value,
      'Registro criado automaticamente a partir da Gestão TI para acompanhamento técnico.',
      0
    )
    returning id into control_item_id;
  end if;

  perform app.add_management_control_log(control_item_id, 'create', sync_message);
  return true;
end;
$$;

create or replace function app.sync_control_from_management()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.module_tables table_row
    where table_row.id = new.table_id
      and table_row.module = 'management'
  ) then
    return new;
  end if;

  perform app.sync_management_record_to_control(new.id, new.payload);
  return new;
end;
$$;

drop trigger if exists management_record_control_sync on public.module_records;
create trigger management_record_control_sync
  after insert or update of payload on public.module_records
  for each row execute procedure app.sync_control_from_management();

create or replace function app.sync_management_status_from_control()
returns trigger
language plpgsql
security definer
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
  if management_status is null then
    return new;
  end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (
        (new.management_record_id is not null and record_row.id = new.management_record_id)
        or (nullif(btrim(new.tag), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'tag', ''))) = lower(btrim(new.tag)))
        or (nullif(btrim(new.serial), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', ''))) = lower(btrim(new.serial)))
      )
  loop
    previous_status := coalesce(matched_record.payload ->> 'status', 'Ativo');
    if previous_status is not distinct from management_status then
      continue;
    end if;

    next_payload := jsonb_set(matched_record.payload, '{status}', to_jsonb(management_status), true);
    existing_logs := case
      when jsonb_typeof(matched_record.payload -> 'logs') = 'array' then matched_record.payload -> 'logs'
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

create or replace function app.copy_control_log_to_management()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  control_item record;
  matched_record record;
  existing_logs jsonb;
  next_payload jsonb;
begin
  select id, tag, serial, management_record_id
  into control_item
  from public.control_items
  where id = new.control_item_id;

  if control_item.id is null then
    return new;
  end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (
        (control_item.management_record_id is not null and record_row.id = control_item.management_record_id)
        or (nullif(btrim(control_item.tag), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'tag', ''))) = lower(btrim(control_item.tag)))
        or (nullif(btrim(control_item.serial), '') is not null
          and lower(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', ''))) = lower(btrim(control_item.serial)))
      )
  loop
    existing_logs := case
      when jsonb_typeof(matched_record.payload -> 'logs') = 'array' then matched_record.payload -> 'logs'
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

create or replace function app.reconcile_management_control_maintenance()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  management_record record;
  synchronized_count integer := 0;
begin
  for management_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and app.management_requires_control(record_row.payload)
    order by record_row.updated_at, record_row.id
  loop
    if app.sync_management_record_to_control(management_record.id, management_record.payload) then
      synchronized_count := synchronized_count + 1;
    end if;
  end loop;

  return synchronized_count;
end;
$$;

select app.reconcile_management_control_maintenance() as maintenance_items_synchronized;

commit;
