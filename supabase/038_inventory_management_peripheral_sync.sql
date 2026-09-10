-- ALDECKOT | Sincronização Inventário → Periféricos da Gestão TI
-- Execute após 037_identity_update_validation.sql no SQL Editor do Supabase.
-- A TAG do Inventário é associada ao computador cujo campo "equipment"
-- corresponde exatamente ao campo "location" do item, respeitando o dono dos dados.

begin;

create or replace function app.inventory_tag_peripheral_type(p_tag text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when upper(btrim(coalesce(p_tag, ''))) ~ '^IMPR[0-9]+$' then 'Impressora'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^EAN[0-9]+$' then 'Leitor'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^GVT[0-9]+$' then 'Gaveta'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^PP[0-9]+$' then 'Pin Pad'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^BAL[0-9]+$' then 'Balança'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^MON[0-9]+$' then 'Monitor'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^TEC[0-9]+$' then 'Teclado'
    else null
  end;
$$;

create or replace function app.management_peripheral_tag_is_valid(p_type text, p_tag text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_tag, '')), '') is null then true
    when lower(btrim(coalesce(p_type, ''))) = 'impressora' then upper(btrim(p_tag)) ~ '^IMPR[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'leitor' then upper(btrim(p_tag)) ~ '^EAN[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'gaveta' then upper(btrim(p_tag)) ~ '^GVT[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) in ('pin pad', 'pinpad') then upper(btrim(p_tag)) ~ '^PP[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) in ('balança', 'balanca') then upper(btrim(p_tag)) ~ '^BAL[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'monitor' then upper(btrim(p_tag)) ~ '^MON[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'teclado' then upper(btrim(p_tag)) ~ '^TEC[0-9]+$'
    else true
  end;
$$;

create or replace function app.validate_management_peripheral_tags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  peripheral jsonb;
  peripheral_type text;
  peripheral_tag text;
begin
  if not exists (select 1 from public.module_tables where id = new.table_id and module = 'management') then
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.payload -> 'peripherals') is not distinct from (old.payload -> 'peripherals') then
    return new;
  end if;

  for peripheral in select value from jsonb_array_elements(coalesce(new.payload -> 'peripherals', '[]'::jsonb)) loop
    peripheral_type := coalesce(peripheral ->> 'type', peripheral ->> 'tipo', '');
    peripheral_tag := upper(btrim(coalesce(peripheral ->> 'status', '')));
    if tg_op = 'UPDATE' and exists (
      select 1
      from jsonb_array_elements(coalesce(old.payload -> 'peripherals', '[]'::jsonb)) previous_peripheral(value)
      where coalesce(previous_peripheral.value ->> 'id', '') = coalesce(peripheral ->> 'id', '')
        and coalesce(previous_peripheral.value ->> 'type', previous_peripheral.value ->> 'tipo', '') = peripheral_type
        and coalesce(previous_peripheral.value ->> 'status', '') = coalesce(peripheral ->> 'status', '')
    ) then
      continue;
    end if;
    if not app.management_peripheral_tag_is_valid(peripheral_type, peripheral_tag) then
      raise exception using
        errcode = '23514',
        message = format('A TAG %s não é compatível com o periférico %s.', coalesce(nullif(peripheral_tag, ''), 'informada'), peripheral_type);
    end if;
  end loop;

  return new;
end;
$$;

create or replace function app.apply_inventory_peripheral_assignment(
  p_owner_id uuid,
  p_inventory_item_id uuid,
  p_location text,
  p_peripheral_type text,
  p_tag text,
  p_remove boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  record_row record;
  current_peripherals jsonb;
  next_peripherals jsonb;
  next_payload jsonb;
  matching_type boolean;
  changed_count integer := 0;
  activity_message text;
begin
  if p_owner_id is null or nullif(btrim(coalesce(p_location, '')), '') is null or p_peripheral_type is null or p_tag is null then
    return 0;
  end if;

  for record_row in
    select record_item.id, record_item.payload
    from public.module_records record_item
    join public.module_tables table_row on table_row.id = record_item.table_id
    where table_row.module = 'management'
      and record_item.owner_id = p_owner_id
      and lower(btrim(coalesce(record_item.payload ->> 'equipment', ''))) = lower(btrim(p_location))
    for update of record_item
  loop
    current_peripherals := case
      when jsonb_typeof(record_row.payload -> 'peripherals') = 'array' then record_row.payload -> 'peripherals'
      else '[]'::jsonb
    end;

    if p_remove then
      select coalesce(jsonb_agg(peripheral.value), '[]'::jsonb)
      into next_peripherals
      from jsonb_array_elements(current_peripherals) as peripheral(value)
      where not (
        lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) = lower(btrim(p_peripheral_type))
        and (
          coalesce(peripheral.value ->> 'sourceItemId', '') = p_inventory_item_id::text
          or upper(btrim(coalesce(peripheral.value ->> 'status', ''))) = upper(btrim(p_tag))
        )
      );
      activity_message := format('Sincronização do Inventário — %s desvinculado da TAG %s.', p_peripheral_type, upper(btrim(p_tag)));
    else
      select exists (
        select 1
        from jsonb_array_elements(current_peripherals) as peripheral(value)
        where lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) = lower(btrim(p_peripheral_type))
      ) into matching_type;

      select coalesce(jsonb_agg(
        case when lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) = lower(btrim(p_peripheral_type)) then
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(peripheral.value, '{type}', to_jsonb(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', p_peripheral_type)), true),
                '{status}', to_jsonb(upper(btrim(p_tag))), true
              ),
              '{sourceModule}', to_jsonb('inventory'::text), true
            ),
            '{sourceItemId}', to_jsonb(p_inventory_item_id::text), true
          )
        else peripheral.value end
      ), '[]'::jsonb)
      into next_peripherals
      from jsonb_array_elements(current_peripherals) as peripheral(value);

      if not matching_type then
        next_peripherals := next_peripherals || jsonb_build_array(jsonb_build_object(
          'id', format('inventory-peripheral-%s-%s', p_inventory_item_id, regexp_replace(lower(p_peripheral_type), '[[:space:]]+', '-', 'g')),
          'type', p_peripheral_type,
          'status', upper(btrim(p_tag)),
          'sourceModule', 'inventory',
          'sourceItemId', p_inventory_item_id::text
        ));
      end if;
      activity_message := format('Sincronização do Inventário — %s atualizado com a TAG %s.', p_peripheral_type, upper(btrim(p_tag)));
    end if;

    if next_peripherals is not distinct from current_peripherals then
      continue;
    end if;

    next_payload := jsonb_set(coalesce(record_row.payload, '{}'::jsonb), '{peripherals}', next_peripherals, true);
    next_payload := jsonb_set(next_payload, '{lastActivity}', to_jsonb(activity_message), true);
    update public.module_records
    set payload = next_payload
    where id = record_row.id;
    changed_count := changed_count + 1;
  end loop;

  return changed_count;
end;
$$;

create or replace function app.sync_inventory_peripherals_to_management()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_type text;
  previous_type text;
  clear_previous boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    previous_type := app.inventory_tag_peripheral_type(old.tag);
    clear_previous := previous_type is not null
      and nullif(btrim(coalesce(old.location, '')), '') is not null
      and (
        tg_op = 'DELETE'
        or app.inventory_tag_peripheral_type(new.tag) is distinct from previous_type
        or lower(btrim(coalesce(new.location, ''))) is distinct from lower(btrim(coalesce(old.location, '')))
      );
    if clear_previous then
      perform app.apply_inventory_peripheral_assignment(old.owner_id, old.id, old.location, previous_type, old.tag, true);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  current_type := app.inventory_tag_peripheral_type(new.tag);
  if current_type is not null and nullif(btrim(coalesce(new.location, '')), '') is not null then
    perform app.apply_inventory_peripheral_assignment(new.owner_id, new.id, new.location, current_type, new.tag, false);
  end if;

  return new;
end;
$$;

drop trigger if exists management_peripheral_tag_format on public.module_records;
create trigger management_peripheral_tag_format
  before insert or update of payload on public.module_records
  for each row execute procedure app.validate_management_peripheral_tags();

drop trigger if exists inventory_peripheral_management_sync on public.inventory_items;
create trigger inventory_peripheral_management_sync
  after insert or update of tag, location on public.inventory_items
  for each row execute procedure app.sync_inventory_peripherals_to_management();

drop trigger if exists inventory_peripheral_management_cleanup on public.inventory_items;
create trigger inventory_peripheral_management_cleanup
  after delete on public.inventory_items
  for each row execute procedure app.sync_inventory_peripherals_to_management();

commit;
