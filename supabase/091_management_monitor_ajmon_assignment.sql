-- ALDECKOT | AJMON no Inventario e vinculo por PC fora dos PDVs.
-- Depende da 090. Preserva MON antigo; nao renomeia TAGs nem move itens.
-- A reconciliacao de AJMON e transacional e aborta em caso de ambiguidade.
begin;

lock table public.inventory_items, public.module_records, public.module_tables
  in share row exclusive mode;

do $$
begin
  if to_regprocedure('public.inventory_save_pdv_peripheral(uuid,jsonb,timestamptz,text,uuid)') is null
    or to_regprocedure('app.apply_inventory_peripheral_assignment(uuid,uuid,text,text,text,boolean)') is null
    or to_regprocedure('app.management_peripheral_tag_is_valid(text,text)') is null
    or not exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.module_records'::regclass
        and trigger_row.tgname = 'management_pdv_peripheral_location_guard'
        and trigger_row.tgenabled <> 'D'
    ) then
    raise exception 'A sincronizacao 086 e a migracao 090 devem estar ativas antes da 091.';
  end if;
end;
$$;

create or replace function app.inventory_tag_peripheral_type(p_tag text)
returns text language sql immutable set search_path = public as $$
  select case
    when upper(btrim(coalesce(p_tag, ''))) ~ '^IMPR[0-9]+$' then 'Impressora'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^EAN[0-9]+$' then 'Leitor'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^GVT[0-9]+$' then 'Gaveta'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^PP[0-9]+$' then 'Pin Pad'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^BAL[0-9]+$' then 'Balança'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^(MON|AJMON)[0-9]+$' then 'Monitor'
    when upper(btrim(coalesce(p_tag, ''))) ~ '^TEC[0-9]+$' then 'Teclado'
    else null
  end;
$$;

create or replace function app.management_peripheral_tag_is_valid(p_type text, p_tag text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when nullif(btrim(coalesce(p_tag, '')), '') is null then true
    when lower(btrim(coalesce(p_type, ''))) = 'impressora' then upper(btrim(p_tag)) ~ '^IMPR[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'leitor' then upper(btrim(p_tag)) ~ '^EAN[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'gaveta' then upper(btrim(p_tag)) ~ '^GVT[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) in ('pin pad', 'pinpad') then upper(btrim(p_tag)) ~ '^PP[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) in ('balança', 'balanca') then upper(btrim(p_tag)) ~ '^BAL[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'monitor' then upper(btrim(p_tag)) ~ '^(MON|AJMON)[0-9]+$'
    when lower(btrim(coalesce(p_type, ''))) = 'teclado' then upper(btrim(p_tag)) ~ '^TEC[0-9]+$'
    else true
  end;
$$;

create or replace function app.ensure_ajmon_legacy_slot_available(
  p_location text, p_tag text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if upper(btrim(coalesce(p_tag, ''))) !~ '^AJMON[0-9]+$' then return; end if;
  if exists (
    select 1 from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
        then record_row.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    where table_row.module = 'management'
      and coalesce(record_row.payload ->> 'terminal', '')
        !~* '^PDV[[:space:]]+[0-9]+$'
      and (lower(btrim(coalesce(record_row.payload ->> 'terminal', ''))) =
          lower(btrim(p_location))
        or lower(btrim(coalesce(record_row.payload ->> 'equipment', ''))) =
          lower(btrim(p_location)))
      and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
      and lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))) =
        'monitor'
      and upper(btrim(coalesce(peripheral.value ->> 'status', ''))) <>
        upper(btrim(p_tag))
  ) then
    raise exception 'Monitor AJMON % conflita com monitor legado na posição.', p_tag;
  end if;
end;
$$;

-- A 086 ja aceita tanto o nome do terminal quanto o nome do PC e grava o
-- vinculo no ID da posicao fisica. Nao o reinterprete pelo nome do PC quando
-- a TAG mudar sem mudanca de Local de instalacao.
alter table public.module_records disable trigger management_pdv_peripheral_location_guard;

create or replace function app.sync_inventory_peripherals_to_management()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  current_type text;
  previous_type text;
  clear_previous boolean := false;
  linked_id uuid;
  linked_count integer;
  current_peripherals jsonb;
  next_peripherals jsonb;
begin
  if tg_op = 'UPDATE' then
    current_type := app.inventory_tag_peripheral_type(new.tag);
    previous_type := app.inventory_tag_peripheral_type(old.tag);
    if current_type is not null and current_type is not distinct from previous_type
      and lower(btrim(coalesce(new.location, ''))) =
        lower(btrim(coalesce(old.location, ''))) then
      select count(*), min(record_row.id::text)::uuid into linked_count, linked_id
      from public.module_records record_row
      join public.module_tables table_row on table_row.id = record_row.table_id
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
          then record_row.payload -> 'peripherals' else '[]'::jsonb end
      ) as peripheral(value)
      where table_row.module = 'management'
        and peripheral.value ->> 'sourceItemId' = new.id::text;
      if linked_count > 1 then
        raise exception 'O periférico % possui vínculos duplicados na Gestão TI.', new.id;
      end if;
      if linked_count = 1 then
        select record_row.payload -> 'peripherals' into current_peripherals
        from public.module_records record_row where record_row.id = linked_id for update;
        if jsonb_typeof(current_peripherals) <> 'array' then
          raise exception 'Lista de periféricos inválida na posição %.', linked_id;
        end if;
        select coalesce(jsonb_agg(
          case when peripheral.value ->> 'sourceItemId' = new.id::text
            then peripheral.value || jsonb_build_object(
              'type', current_type, 'status', upper(btrim(new.tag)),
              'sourceModule', 'inventory')
            else peripheral.value end order by peripheral.ordinality), '[]'::jsonb)
        into next_peripherals
        from jsonb_array_elements(current_peripherals)
          with ordinality as peripheral(value, ordinality);
        if next_peripherals is distinct from current_peripherals then
          update public.module_records set payload =
            jsonb_set(payload, '{peripherals}', next_peripherals, true)
          where id = linked_id;
        end if;
        return new;
      end if;
    end if;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    previous_type := app.inventory_tag_peripheral_type(old.tag);
    clear_previous := previous_type is not null
      and nullif(btrim(coalesce(old.location, '')), '') is not null
      and (tg_op = 'DELETE'
        or app.inventory_tag_peripheral_type(new.tag) is distinct from previous_type
        or lower(btrim(coalesce(new.location, ''))) is distinct from
          lower(btrim(coalesce(old.location, ''))));
    if clear_previous then
      perform app.apply_inventory_peripheral_assignment(
        null, old.id, old.location, previous_type, old.tag, true);
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  current_type := app.inventory_tag_peripheral_type(new.tag);
  if current_type is not null
    and nullif(btrim(coalesce(new.location, '')), '') is not null then
    perform app.ensure_ajmon_legacy_slot_available(new.location, new.tag);
    perform app.apply_inventory_peripheral_assignment(
      null, new.id, new.location, current_type, new.tag, false);
  end if;
  return new;
end;
$$;

-- Recupera somente monitores AJMON. Um vínculo preexistente fica na mesma
-- posição; um item ainda não vinculado usa Local (terminal OU nome do PC).
-- Nenhum histórico de movimentação é inventado nesta reconciliação.
do $$
declare
  item_row record;
  linked_id uuid;
  linked_count integer;
  current_peripherals jsonb;
  next_peripherals jsonb;
begin
  for item_row in
    select id, tag, location from public.inventory_items
    where upper(btrim(coalesce(tag, ''))) ~ '^AJMON[0-9]+$'
    order by id
  loop
    select count(*), min(record_row.id::text)::uuid into linked_count, linked_id
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
        then record_row.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    where table_row.module = 'management'
      and peripheral.value ->> 'sourceItemId' = item_row.id::text;
    if linked_count > 1 then
      raise exception 'Monitor AJMON % aparece em mais de uma posição.', item_row.id;
    end if;
    if linked_count = 1 then
      select record_row.payload -> 'peripherals' into current_peripherals
      from public.module_records record_row where record_row.id = linked_id for update;
      select coalesce(jsonb_agg(
        case when peripheral.value ->> 'sourceItemId' = item_row.id::text
          then peripheral.value || jsonb_build_object(
            'type', 'Monitor', 'status', upper(btrim(item_row.tag)),
            'sourceModule', 'inventory')
          else peripheral.value end order by peripheral.ordinality), '[]'::jsonb)
      into next_peripherals
      from jsonb_array_elements(current_peripherals)
        with ordinality as peripheral(value, ordinality);
      if next_peripherals is distinct from current_peripherals then
        update public.module_records set payload =
          jsonb_set(payload, '{peripherals}', next_peripherals, true)
        where id = linked_id;
      end if;
    elsif nullif(btrim(coalesce(item_row.location, '')), '') is not null then
      perform app.ensure_ajmon_legacy_slot_available(item_row.location, item_row.tag);
      perform app.apply_inventory_peripheral_assignment(
        null, item_row.id, item_row.location, 'Monitor', item_row.tag, false);
    end if;
  end loop;
end;
$$;

alter table public.module_records enable trigger management_pdv_peripheral_location_guard;

-- Cada monitor AJMON marcado como instalado em um PDV precisa estar ligado
-- àquele PDV. Falha cancela também qualquer reconciliação anterior.
do $$
begin
  if exists (
    select 1 from public.inventory_items item
    join public.module_records position_row on exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(position_row.payload -> 'peripherals') = 'array'
          then position_row.payload -> 'peripherals' else '[]'::jsonb end
      ) as peripheral(value)
      where peripheral.value ->> 'sourceItemId' = item.id::text
    )
    join public.module_tables table_row on table_row.id = position_row.table_id
    where table_row.module = 'management'
      and btrim(position_row.payload ->> 'terminal') ~* '^PDV[[:space:]]+[0-9]+$'
      and upper(btrim(coalesce(item.tag, ''))) ~ '^AJMON[0-9]+$'
      and lower(btrim(coalesce(item.location, ''))) <>
        lower(btrim(position_row.payload ->> 'terminal'))
  ) then
    raise exception 'Monitor AJMON vinculado a PDV com Local divergente; a 091 foi cancelada.';
  end if;
  if exists (
    select 1 from public.inventory_items item
    join public.module_records position_row
      on lower(btrim(position_row.payload ->> 'terminal')) =
        lower(btrim(item.location))
    join public.module_tables table_row on table_row.id = position_row.table_id
    where table_row.module = 'management'
      and btrim(position_row.payload ->> 'terminal') ~* '^PDV[[:space:]]+[0-9]+$'
      and upper(btrim(coalesce(item.tag, ''))) ~ '^AJMON[0-9]+$'
      and not exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(position_row.payload -> 'peripherals') = 'array'
            then position_row.payload -> 'peripherals' else '[]'::jsonb end
        ) as peripheral(value)
        where peripheral.value ->> 'sourceItemId' = item.id::text
          and peripheral.value ->> 'sourceModule' = 'inventory'
          and upper(btrim(peripheral.value ->> 'status')) = upper(btrim(item.tag))
      )
  ) then
    raise exception 'Monitor AJMON em PDV sem vínculo correto; a 091 foi cancelada.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
