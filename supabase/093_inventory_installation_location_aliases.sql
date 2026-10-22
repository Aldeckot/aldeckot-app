-- ALDECKOT | Sala CPD e Matriz são locais sem associação.
-- Incremental após 092; não renomeia locais, não cria/move computadores.
-- ESTOQUE02/03 com ou sem espaço identificam a mesma posição.
begin;
lock table public.inventory_items, public.module_records, public.module_tables
  in share row exclusive mode;
do $$
begin
  if to_regprocedure('app.inventory_location_is_unassigned(text)') is null
    or not exists (select 1 from pg_trigger where
      tgrelid='public.module_records'::regclass
      and tgname='management_unassigned_peripheral_guard' and tgenabled <> 'D') then
    raise exception 'A migração 092 deve estar ativa antes da 093.';
  end if;
end;
$$;

create or replace function app.inventory_installation_location_key(p_location text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(
    lower(regexp_replace(btrim(coalesce(p_location, '')), '[[:space:]]+', ' ', 'g')),
    '^estoque[[:space:]]*([0-9]+)$', 'estoque \1');
$$;

create or replace function app.inventory_location_is_unassigned(p_location text)
returns boolean language sql immutable set search_path = public as $$
  select app.inventory_installation_location_key(p_location) in ('sala cpd', 'matriz');
$$;

-- Interrompe sem remover associações antigas ou inventar movimentações.
do $$
begin
  if exists (
    select 1 from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
        then record_row.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    join public.inventory_items item on (peripheral.value ->> 'sourceItemId' = item.id::text
      or (nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
        and coalesce(peripheral.value ->> 'sourceModule', 'inventory') = 'inventory'
        and nullif(btrim(coalesce(item.tag, '')), '') is not null
        and upper(btrim(coalesce(nullif(btrim(peripheral.value ->> 'tag'), ''), peripheral.value ->> 'status', ''))) =
          upper(btrim(item.tag))))
    where table_row.module = 'management'
      and app.inventory_location_is_unassigned(item.location)
  ) then
    raise exception 'Há equipamentos em Sala CPD/Matriz ainda associados na Gestão TI. Execute a auditoria de associação; nenhum vínculo foi alterado.';
  end if;
end;
$$;

create or replace function app.apply_inventory_peripheral_assignment(
  p_owner_id uuid, p_inventory_item_id uuid, p_location text,
  p_peripheral_type text, p_tag text, p_remove boolean default false
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
  target_count integer;
  linked_id uuid;
  linked_count integer;
  target public.module_records%rowtype;
  current_peripherals jsonb;
  next_peripherals jsonb;
  legacy_remove boolean := false;
  legacy_count integer := 0;
  normalized_tag text := upper(btrim(coalesce(p_tag, '')));
  activity_message text;
begin
  if p_inventory_item_id is null or p_peripheral_type is null or normalized_tag = '' then
    return 0;
  end if;

  select count(*), min(record_row.id::text)::uuid into linked_count, linked_id
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
      then record_row.payload -> 'peripherals' else '[]'::jsonb end
  ) as peripheral(value)
  where table_row.module = 'management'
    and (peripheral.value ->> 'sourceItemId') = p_inventory_item_id::text;
  if linked_count > 1 then
    raise exception 'O periférico % está vinculado mais de uma vez na Gestão TI.', p_inventory_item_id;
  end if;

  if p_remove then
    if linked_count = 0 and nullif(btrim(coalesce(p_location, '')), '') is not null then
      select count(*), min(record_row.id::text)::uuid into linked_count, linked_id
      from public.module_records record_row
      join public.module_tables table_row on table_row.id = record_row.table_id
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
          then record_row.payload -> 'peripherals' else '[]'::jsonb end
      ) as peripheral(value)
      where table_row.module = 'management'
        and coalesce(record_row.payload ->> 'terminal', '') !~* '^PDV[[:space:]]+[0-9]+$'
        and app.inventory_installation_location_key(record_row.payload ->> 'equipment') = app.inventory_installation_location_key(p_location)
        and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
        and upper(btrim(coalesce(peripheral.value ->> 'status', ''))) = normalized_tag
        and lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')))
          = lower(btrim(p_peripheral_type));
      legacy_remove := linked_count > 0;
    end if;
    if linked_count > 1 then
      raise exception 'O periférico legado % aparece mais de uma vez na Gestão TI.', normalized_tag;
    end if;
    if linked_count = 0 then return 0; end if;
    target_id := linked_id;
  else
    if app.inventory_location_is_unassigned(p_location) then
      if linked_count > 0 then
        raise exception 'Sala CPD/Matriz significa sem vínculo de instalação. Movimente o equipamento pelo Inventário.';
      end if;
      return 0;
    end if;
    if nullif(btrim(coalesce(p_location, '')), '') is null then return 0; end if;
    select count(*), min(record_row.id::text)::uuid into target_count, target_id
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (app.inventory_installation_location_key(record_row.payload ->> 'terminal') = app.inventory_installation_location_key(p_location)
        or (coalesce(record_row.payload ->> 'terminal', '') !~* '^PDV[[:space:]]+[0-9]+$'
          and app.inventory_installation_location_key(record_row.payload ->> 'equipment') = app.inventory_installation_location_key(p_location)));
    if target_count > 1 then
      raise exception 'Local % corresponde a mais de uma posição na Gestão TI.', p_location;
    end if;
    if target_count = 0 then
      if linked_count > 0 then
        raise exception 'O periférico % continua vinculado a outra posição.', p_inventory_item_id;
      end if;
      return 0;
    end if;
    if linked_count > 0 and linked_id <> target_id then
      raise exception 'O periférico % já está vinculado a outra posição.', p_inventory_item_id;
    end if;
  end if;

  select * into target from public.module_records where id = target_id for update;
  if not found then raise exception 'A posição do periférico não foi encontrada.'; end if;
  if target.payload ? 'peripherals'
    and jsonb_typeof(target.payload -> 'peripherals') <> 'array' then
    raise exception 'Formato antigo de periféricos na posição %; correção manual necessária.', target_id;
  end if;
  current_peripherals := coalesce(target.payload -> 'peripherals', '[]'::jsonb);

  if p_remove then
    select coalesce(jsonb_agg(peripheral.value order by peripheral.ordinality), '[]'::jsonb)
    into next_peripherals
    from jsonb_array_elements(current_peripherals)
      with ordinality as peripheral(value, ordinality)
    where case when legacy_remove then not (
      nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
      and upper(btrim(coalesce(peripheral.value ->> 'status', ''))) = normalized_tag
      and lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')))
        = lower(btrim(p_peripheral_type)))
      else (peripheral.value ->> 'sourceItemId') is distinct from p_inventory_item_id::text end;
    activity_message := format('Sincronização do Inventário — %s desvinculado da TAG %s.',
      p_peripheral_type, normalized_tag);
  else
    if linked_count = 0
      and coalesce(target.payload ->> 'terminal', '') !~* '^PDV[[:space:]]+[0-9]+$' then
      select count(*) into legacy_count
      from jsonb_array_elements(current_peripherals) as peripheral(value)
      where nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
        and lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')))
          = lower(btrim(p_peripheral_type));
      if legacy_count > 1 then
        raise exception 'Há periféricos legados ambíguos do tipo %.', p_peripheral_type;
      end if;
    end if;
    select coalesce(jsonb_agg(
      case when (peripheral.value ->> 'sourceItemId') = p_inventory_item_id::text
        or (legacy_count = 1
          and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
          and lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')))
            = lower(btrim(p_peripheral_type)))
        then peripheral.value || jsonb_build_object(
          'type', p_peripheral_type, 'status', normalized_tag,
          'sourceModule', 'inventory', 'sourceItemId', p_inventory_item_id::text)
        else peripheral.value end order by peripheral.ordinality), '[]'::jsonb)
    into next_peripherals
    from jsonb_array_elements(current_peripherals)
      with ordinality as peripheral(value, ordinality);
    if linked_count = 0 and legacy_count = 0 then
      next_peripherals := next_peripherals || jsonb_build_array(jsonb_build_object(
        'id', format('inventory-peripheral-%s', p_inventory_item_id),
        'type', p_peripheral_type, 'status', normalized_tag,
        'sourceModule', 'inventory', 'sourceItemId', p_inventory_item_id::text));
    end if;
    activity_message := format('Sincronização do Inventário — %s atualizado com a TAG %s.',
      p_peripheral_type, normalized_tag);
  end if;

  if next_peripherals is not distinct from current_peripherals then return 0; end if;
  update public.module_records
  set payload = jsonb_set(
    jsonb_set(target.payload, '{peripherals}', next_peripherals, true),
    '{lastActivity}', to_jsonb(activity_message), true)
  where id = target_id;
  return 1;
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
      and (app.inventory_installation_location_key(record_row.payload ->> 'terminal') =
          app.inventory_installation_location_key(p_location)
        or app.inventory_installation_location_key(record_row.payload ->> 'equipment') =
          app.inventory_installation_location_key(p_location))
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
  -- Sala CPD é depósito para qualquer TAG/tipo, inclusive equipamentos legados.
  -- A retirada usa a identidade do Inventário e preserva os demais periféricos.
  if tg_op <> 'DELETE' then
    if app.inventory_location_is_unassigned(new.location) then
      if tg_op = 'UPDATE' then
        perform app.apply_inventory_peripheral_assignment(null, old.id, old.location,
          coalesce(app.inventory_tag_peripheral_type(old.tag), 'Equipamento'),
          coalesce(nullif(btrim(old.tag), ''), old.id::text), true);
      else
        perform app.apply_inventory_peripheral_assignment(null, new.id, null,
          coalesce(app.inventory_tag_peripheral_type(new.tag), 'Equipamento'),
          coalesce(nullif(btrim(new.tag), ''), new.id::text), true);
      end if;
      return new;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    current_type := app.inventory_tag_peripheral_type(new.tag);
    previous_type := app.inventory_tag_peripheral_type(old.tag);
    if current_type is not null and current_type is not distinct from previous_type
      and app.inventory_installation_location_key(new.location) =
        app.inventory_installation_location_key(old.location) then
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
        or app.inventory_installation_location_key(new.location) is distinct from
          app.inventory_installation_location_key(old.location));
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

create or replace function app.guard_management_unassigned_peripherals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.module_tables table_row
    where table_row.id = new.table_id and table_row.module = 'management') then
    return new;
  end if;
  if exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(new.payload -> 'peripherals') = 'array'
        then new.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    join public.inventory_items item on (peripheral.value ->> 'sourceItemId' = item.id::text
      or (nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null
        and coalesce(peripheral.value ->> 'sourceModule', 'inventory') = 'inventory'
        and nullif(btrim(coalesce(item.tag, '')), '') is not null
        and upper(btrim(coalesce(nullif(btrim(peripheral.value ->> 'tag'), ''), peripheral.value ->> 'status', ''))) =
          upper(btrim(item.tag))))
    where app.inventory_location_is_unassigned(item.location)
  ) then
    raise exception 'Equipamento em Sala CPD/Matriz não pode ser associado a PC ou terminal. Confirme primeiro o local de instalação no Inventário.';
  end if;
  return new;
end;
$$;


-- Reconciliar somente os dois monitores informados pelo usuário.
-- Vínculo existente em outro local ou nomes ambíguos cancelam a transação.
do $$
declare specification record; item_row public.inventory_items%rowtype;
  target_id uuid; target_count integer; link_count integer; linked_id uuid;
begin
  for specification in select * from (values
    ('AJMON020','estoque 02'), ('AJMON021','estoque 03')
  ) as expected(tag, location_key) loop
    select count(*) into target_count from public.inventory_items
      where upper(btrim(tag))=specification.tag;
    if target_count <> 1 then
      raise exception 'Esperado um único monitor %; encontrados %.', specification.tag, target_count;
    end if;
    select * into item_row from public.inventory_items
      where upper(btrim(tag))=specification.tag;
    if app.inventory_installation_location_key(item_row.location) <> specification.location_key then
      raise exception 'O local de % mudou desde a relação enviada. Nenhuma correção aplicada.', specification.tag;
    end if;
    select count(*), min(r.id::text)::uuid into target_count,target_id
      from public.module_records r join public.module_tables t on t.id=r.table_id
      where t.module='management'
        and (app.inventory_installation_location_key(r.payload->>'terminal')=specification.location_key
          or (coalesce(r.payload->>'terminal','') !~* '^PDV[[:space:]]+[0-9]+$'
            and app.inventory_installation_location_key(r.payload->>'equipment')=specification.location_key));
    if target_count <> 1 then
      raise exception 'Destino % ausente ou ambíguo (% posições).', specification.location_key,target_count;
    end if;
    select count(*), min(r.id::text)::uuid into link_count,linked_id
      from public.module_records r join public.module_tables t on t.id=r.table_id
      cross join lateral jsonb_array_elements(coalesce(r.payload->'peripherals','[]'::jsonb)) p
      where t.module='management' and p.value->>'sourceItemId'=item_row.id::text;
    if link_count > 1 or (link_count=1 and linked_id<>target_id) then
      raise exception 'Monitor % já vinculado a outra posição; nenhuma alteração aplicada.', specification.tag;
    end if;
    if link_count=0 then
      perform app.ensure_ajmon_legacy_slot_available(item_row.location,item_row.tag);
      perform app.apply_inventory_peripheral_assignment(
        null,item_row.id,item_row.location,'Monitor',item_row.tag,false);
      insert into public.inventory_item_logs(inventory_item_id,action,message)
      values(item_row.id,'update',format(
        'Reconciliação cadastral autorizada: %s associado à posição %s pelo local já informado; sem deslocamento físico, mudança de status ou de computador.',
        item_row.tag,specification.location_key));
    end if;
    if not exists (
      select 1 from public.module_records r
      cross join lateral jsonb_array_elements(r.payload->'peripherals') p
      where r.id=target_id and p.value->>'sourceItemId'=item_row.id::text
        and p.value->>'sourceModule'='inventory'
        and p.value->>'type'='Monitor'
        and upper(btrim(p.value->>'status'))=upper(btrim(item_row.tag))
    ) then raise exception 'A associação de % não pôde ser confirmada.', specification.tag; end if;
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;

