-- ALDECKOT | Destino mensal da manutenção Gestão TI -> Controle TI
-- Execute após 043_fix_central_management_control_maintenance_sync.sql.
--
-- Registros automáticos são sempre inseridos na tabela do mês atual, por
-- exemplo, SETEMBRO 2026. Registros automáticos já vinculados são movidos para
-- essa tabela durante a reconciliação, sem alterar itens manuais.

begin;

create or replace function app.current_control_maintenance_table_name()
returns text
language sql
stable
set search_path = public
as $$
  select (case extract(month from timezone('America/Sao_Paulo', now()))::integer
    when 1 then 'JANEIRO'
    when 2 then 'FEVEREIRO'
    when 3 then 'MARÇO'
    when 4 then 'ABRIL'
    when 5 then 'MAIO'
    when 6 then 'JUNHO'
    when 7 then 'JULHO'
    when 8 then 'AGOSTO'
    when 9 then 'SETEMBRO'
    when 10 then 'OUTUBRO'
    when 11 then 'NOVEMBRO'
    when 12 then 'DEZEMBRO'
  end) || ' ' || to_char(timezone('America/Sao_Paulo', now()), 'YYYY');
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
  current_control_table_name text;
  current_control_table_id uuid;
  control_items_require_owner boolean;
  control_item_owner_id uuid;
  existing_control_id uuid;
  existing_control_table_id uuid;
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

  current_control_table_name := app.current_control_maintenance_table_name();
  select table_row.id
  into current_control_table_id
  from public.module_tables table_row
  where table_row.module = 'control'
    and lower(btrim(table_row.name)) = lower(current_control_table_name)
  order by table_row.created_at desc, table_row.id desc
  limit 1;

  -- Não use uma tabela de outro mês como alternativa. A tabela mensal deve
  -- existir para que a operação escolha explicitamente o período correto.
  if current_control_table_id is null then
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
    where table_row.id = current_control_table_id;

    if control_item_owner_id is null then
      select nullif(to_jsonb(item) ->> 'owner_id', '')::uuid
      into control_item_owner_id
      from public.control_items item
      where item.table_id = current_control_table_id
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

  select item.id, item.table_id, item.status, item.management_record_id
  into existing_control_id, existing_control_table_id, existing_control_status, existing_control_management_id
  from public.control_items item
  where item.management_record_id = p_management_record_id
    or (source_tag is not null and lower(btrim(coalesce(item.tag, ''))) = source_tag)
    or (source_serial is not null and lower(btrim(coalesce(item.serial, ''))) = source_serial)
  order by (item.management_record_id = p_management_record_id) desc, item.updated_at desc
  limit 1
  for update;

  if existing_control_id is not null then
    if existing_control_status is not distinct from 'Em manutenção'
      and existing_control_management_id is not distinct from p_management_record_id
      and existing_control_table_id is not distinct from current_control_table_id then
      return false;
    end if;

    update public.control_items
    set management_record_id = p_management_record_id,
        status = 'Em manutenção',
        table_id = case
          when existing_control_management_id is not distinct from p_management_record_id
            then current_control_table_id
          else table_id
        end
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
    using current_control_table_id, control_item_owner_id, p_management_record_id,
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
      current_control_table_id,
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

select app.reconcile_management_control_maintenance() as maintenance_items_synchronized;

commit;
