-- ALDECKOT | Primeira etapa da integração por identidade.
-- Requer 061_integrated_inventory_supplies.sql. Não reconcilia nem altera
-- registros legados: vínculos ambíguos continuam pendentes de revisão.
-- Recomenda-se backup completo e teste em clone antes da execução em produção.
-- Sem backup, a execução exige autorização explícita do responsável.
begin;

-- O UUID explícito tem prioridade. Sem ele, TAG e série só identificam um
-- equipamento quando ambas (se presentes) apontam à mesma linha.
create or replace function app.resolve_inventory_item_id(
  p_item_id uuid, p_tag text, p_serial text
) returns uuid language plpgsql stable set search_path = public as $$
declare
  tag_key text := lower(nullif(btrim(coalesce(p_tag, '')), ''));
  serial_key text := lower(nullif(btrim(coalesce(p_serial, '')), ''));
  matching_count integer;
  matched_id uuid;
  matched_tag text;
  matched_serial text;
begin
  if tag_key in ('-', '***', 'n/a', 'sem tag') then tag_key := null; end if;
  if serial_key in ('-', '***', 'n/a', 'sem número', 'sem numero') then serial_key := null; end if;

  if p_item_id is not null then
    if not exists (select 1 from public.inventory_items where id = p_item_id) then
      raise exception 'Equipamento do Inventário não encontrado para o UUID informado.';
    end if;
    if (tag_key is not null and exists (
      select 1 from public.inventory_items
      where id <> p_item_id and lower(btrim(tag)) = tag_key
    )) or (serial_key is not null and exists (
      select 1 from public.inventory_items
      where id <> p_item_id and lower(btrim(serial)) = serial_key
    )) then
      raise exception 'A TAG ou o número de série aponta para outro equipamento do Inventário.';
    end if;
    return p_item_id;
  end if;

  if tag_key is null and serial_key is null then return null; end if;
  select count(*) into matching_count
  from public.inventory_items item
  where (tag_key is not null and lower(btrim(item.tag)) = tag_key)
     or (serial_key is not null and lower(btrim(item.serial)) = serial_key);
  if matching_count = 0 then return null; end if;
  if matching_count > 1 then
    raise exception 'TAG e número de série apontam para equipamentos diferentes ou duplicados no Inventário.';
  end if;

  select item.id, lower(btrim(item.tag)), lower(btrim(item.serial))
  into matched_id, matched_tag, matched_serial
  from public.inventory_items item
  where (tag_key is not null and lower(btrim(item.tag)) = tag_key)
     or (serial_key is not null and lower(btrim(item.serial)) = serial_key);
  if (tag_key is not null and matched_tag is distinct from tag_key)
    or (serial_key is not null and matched_serial is distinct from serial_key) then
    raise exception 'TAG e número de série não confirmam a mesma identidade no Inventário.';
  end if;
  return matched_id;
end; $$;

-- Um terminal da Gestão TI pode receber outro PC. O FK do terminal, sozinho,
-- não prova que o equipamento atual ainda é o mesmo do chamado antigo.
create or replace function app.management_identity_matches(
  p_payload jsonb, p_tag text, p_serial text
) returns boolean language plpgsql immutable set search_path = public as $$
declare
  tag_key text := lower(nullif(btrim(coalesce(p_tag, '')), ''));
  serial_key text := lower(nullif(btrim(coalesce(p_serial, '')), ''));
begin
  if tag_key in ('-', '***', 'n/a', 'sem tag') then tag_key := null; end if;
  if serial_key in ('-', '***', 'n/a', 'sem número', 'sem numero') then serial_key := null; end if;
  if tag_key is null and serial_key is null then return false; end if;
  return (tag_key is null or lower(btrim(coalesce(p_payload ->> 'tag', ''))) = tag_key)
     and (serial_key is null or lower(btrim(coalesce(
       nullif(btrim(p_payload ->> 'serial'), ''),
       nullif(btrim(p_payload ->> 'numeroSerie'), ''),
       nullif(btrim(p_payload ->> 'numero_série'), ''),
       nullif(btrim(p_payload ->> 'numero_serie'), ''), ''
     ))) = serial_key);
end; $$;

-- "Em uso" ainda é operacional; "Aguardando avaliação" já está em
-- manutenção. Conclusão retorna somente o Inventário a Reserva.
create or replace function app.management_status_from_control(control_status text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(control_status, '')))
    when 'em manutenção' then 'Manutenção'
    when 'manutenção' then 'Manutenção'
    when 'manutencao' then 'Manutenção'
    when 'aguardando avaliação' then 'Manutenção'
    when 'aguardando avaliacao' then 'Manutenção'
    when 'em uso' then 'Ativo'
    when 'em sala' then 'Manutenção'
    when 'descartado' then 'Desativado'
    -- Nunca reativar ou reassociar um terminal pela conclusão do chamado.
    else null
  end;
$$;

create or replace function app.sync_inventory_status_from_control()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  inventory_status text;
  inventory_id uuid;
  matched_item public.inventory_items%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then return new; end if;
  end if;
  inventory_status := case new.status
    when 'Manutenção concluída' then 'Reserva'
    when 'Em manutenção' then 'Manutenção'
    when 'Aguardando avaliação' then 'Manutenção'
    when 'Em uso' then 'Ativo'
    when 'Em sala' then 'Manutenção'
    when 'Descartado' then 'Inativo'
    else null end;
  if inventory_status is null then return new; end if;

  inventory_id := app.resolve_inventory_item_id(new.inventory_item_id, new.tag, new.serial);
  if inventory_id is null then return new; end if;
  select * into matched_item from public.inventory_items where id = inventory_id for update;
  if matched_item.status is not distinct from inventory_status then return new; end if;

  update public.inventory_items set status = inventory_status where id = inventory_id;
  insert into public.inventory_item_logs (inventory_item_id, action, message)
  values (inventory_id, 'update', format(
    'Status atualizado automaticamente pelo Controle TI: %s -> %s.',
    matched_item.status, inventory_status
  ));
  insert into public.sync_events (module, operation, details)
  values ('inventory', 'update', jsonb_build_object(
    'itemId', inventory_id, 'tableId', matched_item.table_id,
    'tableName', (select name from public.module_tables where id = matched_item.table_id),
    'equipment', matched_item.equipment, 'brand', matched_item.brand,
    'serial', matched_item.serial, 'tag', matched_item.tag, 'status', inventory_status,
    'description', format('Status sincronizado pelo Controle TI: %s -> %s.',
      matched_item.status, inventory_status),
    'targetUrl', format('inventory.html?table=%s&item=%s', matched_item.table_id, inventory_id)
  ));
  update public.module_tables set position = position + 1 where module = 'inventory';
  update public.module_tables set position = 0 where id = matched_item.table_id;
  return new;
end; $$;

create or replace function app.copy_control_log_to_inventory()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  control_item record;
  inventory_id uuid;
  matched_item public.inventory_items%rowtype;
begin
  select inventory_item_id, tag, serial into control_item
  from public.control_items where id = new.control_item_id;
  if not found then return new; end if;
  inventory_id := app.resolve_inventory_item_id(
    control_item.inventory_item_id, control_item.tag, control_item.serial
  );
  if inventory_id is null then return new; end if;
  select * into matched_item from public.inventory_items where id = inventory_id;
  insert into public.inventory_item_logs
    (inventory_item_id, action, message, source_module, source_log_id)
  values (inventory_id, 'update', new.message, 'control', new.id)
  on conflict (inventory_item_id, source_module, source_log_id)
    where source_module is not null and source_log_id is not null
  do update set action = excluded.action, message = excluded.message;
  insert into public.sync_events (module, operation, details)
  values ('inventory', 'log', jsonb_build_object(
    'itemId', inventory_id, 'tableId', matched_item.table_id,
    'tableName', (select name from public.module_tables where id = matched_item.table_id),
    'equipment', matched_item.equipment, 'brand', matched_item.brand,
    'serial', matched_item.serial, 'tag', matched_item.tag, 'status', matched_item.status,
    'description', format('Registro do Controle TI: %s', new.message),
    'targetUrl', format('inventory.html?table=%s&item=%s', matched_item.table_id, inventory_id)
  ));
  return new;
end; $$;

create or replace function app.sync_management_status_from_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  management_status text;
  matching_count integer;
  matched_record record;
  existing_logs jsonb;
  next_payload jsonb;
  previous_status text;
begin
  if tg_op = 'UPDATE' then
    if old.status is not distinct from new.status then return new; end if;
  end if;
  management_status := app.management_status_from_control(new.status);
  if management_status is null then return new; end if;

  select count(*) into matching_count
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  where table_row.module = 'management'
    and (new.management_record_id is null or record_row.id = new.management_record_id)
    and app.management_identity_matches(record_row.payload, new.tag, new.serial);
  if matching_count > 1 then
    raise exception 'Chamado corresponde a mais de um PC da Gestão TI.';
  end if;
  if matching_count = 0 then return new; end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (new.management_record_id is null or record_row.id = new.management_record_id)
      and app.management_identity_matches(record_row.payload, new.tag, new.serial)
  loop
    previous_status := coalesce(matched_record.payload ->> 'status', 'Ativo');
    if previous_status is not distinct from management_status then continue; end if;
    next_payload := jsonb_set(matched_record.payload, '{status}', to_jsonb(management_status), true);
    existing_logs := case when jsonb_typeof(matched_record.payload -> 'logs') = 'array'
      then matched_record.payload -> 'logs' else '[]'::jsonb end;
    next_payload := jsonb_set(next_payload, '{logs}',
      existing_logs || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'at', timezone('utc', now()),
        'text', format('Status atualizado pelo Controle TI: %s → %s.', previous_status, management_status),
        'source', 'Controle TI'
      )), true);
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(format(
      'Status sincronizado pelo Controle TI: %s → %s.', previous_status, management_status
    )), true);
    update public.module_records set payload = next_payload where id = matched_record.id;
  end loop;
  return new;
end; $$;

create or replace function app.copy_control_log_to_management()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  control_item record;
  matching_count integer;
  matched_record record;
  existing_logs jsonb;
  next_payload jsonb;
begin
  select tag, serial, management_record_id into control_item
  from public.control_items where id = new.control_item_id;
  if not found then return new; end if;
  select count(*) into matching_count
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  where table_row.module = 'management'
    and (control_item.management_record_id is null or record_row.id = control_item.management_record_id)
    and app.management_identity_matches(record_row.payload, control_item.tag, control_item.serial);
  if matching_count > 1 then
    raise exception 'Log do Controle TI corresponde a mais de um PC da Gestão TI.';
  end if;
  if matching_count = 0 then return new; end if;

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (control_item.management_record_id is null or record_row.id = control_item.management_record_id)
      and app.management_identity_matches(record_row.payload, control_item.tag, control_item.serial)
  loop
    existing_logs := case when jsonb_typeof(matched_record.payload -> 'logs') = 'array'
      then matched_record.payload -> 'logs' else '[]'::jsonb end;
    next_payload := jsonb_set(matched_record.payload, '{logs}',
      existing_logs || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'at', new.created_at,
        'text', new.message, 'source', 'Controle TI', 'controlLogId', new.id::text
      )), true);
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(new.message), true);
    update public.module_records set payload = next_payload where id = matched_record.id;
  end loop;
  return new;
end; $$;

-- Uma RPC security definer de diagnóstico não deve contornar RLS para anon.
revoke all on function public.equipment_identity_conflicts() from public, anon;
grant execute on function public.equipment_identity_conflicts() to authenticated;

commit;
