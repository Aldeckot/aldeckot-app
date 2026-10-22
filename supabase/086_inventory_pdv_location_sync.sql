-- ALDECKOT | Local patrimonial dos periféricos pertence ao PDV, não ao PC.
-- Aplicar após 085. A lista física dos 14 PDVs foi confirmada pelo usuário.
-- Esta migração não transfere computadores nem toca em periféricos fora de PDV.
begin;

lock table public.inventory_items, public.module_records, public.module_tables
  in share row exclusive mode;

create temporary table aldeckot_pdv_location_map on commit drop as
select record_row.id as position_id,
  btrim(record_row.payload ->> 'terminal') as terminal,
  btrim(coalesce(record_row.payload ->> 'equipment', '')) as computer,
  peripheral.value ->> 'sourceModule' as source_module,
  peripheral.value ->> 'sourceItemId' as source_item_id,
  upper(btrim(coalesce(peripheral.value ->> 'status', ''))) as peripheral_tag,
  btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')) as peripheral_type,
  item.id as inventory_id,
  item.tag as inventory_tag,
  item.location as inventory_location
from public.module_records record_row
join public.module_tables table_row on table_row.id = record_row.table_id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
    then record_row.payload -> 'peripherals' else '[]'::jsonb end
) as peripheral(value)
left join public.inventory_items item
  on item.id::text = (peripheral.value ->> 'sourceItemId')
where table_row.module = 'management'
  and btrim(coalesce(record_row.payload ->> 'terminal', '')) ~* '^PDV[[:space:]]+[0-9]+$';

do $$
begin
  if (select count(*) from pg_temp.aldeckot_pdv_location_map) <> 78
    or (select count(distinct position_id) from pg_temp.aldeckot_pdv_location_map) <> 14
    or (select count(distinct inventory_id) from pg_temp.aldeckot_pdv_location_map) <> 78 then
    raise exception 'A ocupação dos PDVs mudou desde a auditoria; nenhuma localização foi alterada.';
  end if;
  if exists (
    select 1 from pg_temp.aldeckot_pdv_location_map
    where inventory_id is null or source_module is distinct from 'inventory'
      or upper(btrim(coalesce(inventory_tag, ''))) is distinct from peripheral_tag
      or lower(peripheral_type) is distinct from lower(app.inventory_tag_peripheral_type(peripheral_tag))
      or lower(btrim(coalesce(inventory_location, ''))) is distinct from lower(computer)
  ) then
    raise exception 'Há TAG, tipo, vínculo ou local divergente; execute novamente a auditoria.';
  end if;
  if exists (
    select 1 from pg_temp.aldeckot_pdv_location_map
    group by lower(terminal) having count(distinct position_id) > 1
  ) or exists (
    select 1 from pg_temp.aldeckot_pdv_location_map
    group by peripheral_tag having count(*) > 1
  ) then
    raise exception 'Há posição ou TAG duplicada nos PDVs; nenhuma localização foi alterada.';
  end if;
  if exists (
    select 1 from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
        then record_row.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    join pg_temp.aldeckot_pdv_location_map mapping
      on mapping.source_item_id = (peripheral.value ->> 'sourceItemId')
    where table_row.module = 'management' and record_row.id <> mapping.position_id
  ) then
    raise exception 'Um ID patrimonial está vinculado a mais de uma posição.';
  end if;
  if exists (
    select 1 from public.inventory_items item
    join (select distinct lower(terminal) as terminal_key
      from pg_temp.aldeckot_pdv_location_map) position
      on lower(btrim(item.location)) = position.terminal_key
    where app.inventory_tag_peripheral_type(item.tag) is not null
      and not exists (select 1 from pg_temp.aldeckot_pdv_location_map mapping
        where mapping.inventory_id = item.id)
  ) then
    raise exception 'Há periférico com local PDV sem vínculo na Gestão TI; execute nova auditoria.';
  end if;
  if not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.inventory_items'::regclass
      and trigger_row.tgname = 'inventory_peripheral_management_sync'
      and not trigger_row.tgisinternal and trigger_row.tgenabled <> 'D'
  ) then
    raise exception 'O gatilho de sincronização esperado não está ativo.';
  end if;
end;
$$;

-- A sincronização passa a localizar o destino pela posição física. O ID do
-- Inventário é a identidade da entrada, inclusive ao mudar TAG ou local.
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
        and lower(btrim(coalesce(record_row.payload ->> 'equipment', ''))) = lower(btrim(p_location))
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
    if nullif(btrim(coalesce(p_location, '')), '') is null then return 0; end if;
    select count(*), min(record_row.id::text)::uuid into target_count, target_id
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and (lower(btrim(coalesce(record_row.payload ->> 'terminal', ''))) = lower(btrim(p_location))
        or (coalesce(record_row.payload ->> 'terminal', '') !~* '^PDV[[:space:]]+[0-9]+$'
          and lower(btrim(coalesce(record_row.payload ->> 'equipment', ''))) = lower(btrim(p_location))));
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

-- A atualização em lote não representa instalação/movimentação: ela apenas
-- corrige o texto de localização. O gatilho antigo fica ausente somente nesta
-- transação com a tabela bloqueada, evitando remover e recriar entradas.
drop trigger inventory_peripheral_management_sync on public.inventory_items;

do $$
declare
  changed_count integer;
begin
  update public.inventory_items item
  set location = mapping.terminal
  from pg_temp.aldeckot_pdv_location_map mapping
  where item.id = mapping.inventory_id
    and lower(btrim(item.location)) = lower(mapping.computer);
  get diagnostics changed_count = row_count;
  if changed_count <> 78 then
    raise exception 'Esperadas 78 correções de local, feitas %; transação cancelada.', changed_count;
  end if;
end;
$$;

create trigger inventory_peripheral_management_sync
  after insert or update of tag, location on public.inventory_items
  for each row execute function app.sync_inventory_peripherals_to_management();

insert into public.inventory_item_logs (inventory_item_id, action, message)
select inventory_id, 'update',
  format('Localização corrigida para a posição física %s (antes vinculada ao nome do computador %s). Sem movimentação física.',
    terminal, computer)
from pg_temp.aldeckot_pdv_location_map;

-- Qualquer edição posterior de posição PDV deve manter o periférico no PDV
-- indicado pelo Inventário. A RPC antiga que troca o array de periféricos
-- falhará antes de concluir; ela não é substituta do novo fluxo de PCs.
create or replace function app.guard_management_pdv_peripheral_location()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  position_name text := btrim(coalesce(new.payload ->> 'terminal', ''));
  peripherals jsonb;
begin
  if tg_op = 'UPDATE' then
    if exists (
      select 1 from public.module_tables table_row
      where table_row.id = old.table_id and table_row.module = 'management'
    ) and btrim(coalesce(old.payload ->> 'terminal', '')) ~* '^PDV[[:space:]]+[0-9]+$'
      and (new.table_id is distinct from old.table_id
        or position_name is distinct from btrim(old.payload ->> 'terminal')) then
      raise exception 'A posição PDV não pode ser renomeada ou movida por edição do computador.';
    end if;
  end if;
  if not exists (select 1 from public.module_tables table_row
    where table_row.id = new.table_id and table_row.module = 'management')
    or position_name !~* '^PDV[[:space:]]+[0-9]+$' then
    return new;
  end if;
  perform pg_advisory_xact_lock(89186, hashtext(lower(position_name)));
  if exists (
    select 1 from public.module_records other_record
    join public.module_tables table_row on table_row.id = other_record.table_id
    where table_row.module = 'management' and other_record.id <> new.id
      and lower(btrim(coalesce(other_record.payload ->> 'terminal', ''))) = lower(position_name)
  ) then
    raise exception 'A posição % já existe na Gestão TI.', position_name;
  end if;
  if new.payload ? 'peripherals'
    and jsonb_typeof(new.payload -> 'peripherals') <> 'array' then
    raise exception 'A lista de periféricos do PDV deve ser um array.';
  end if;
  peripherals := coalesce(new.payload -> 'peripherals', '[]'::jsonb);
  if exists (
    select 1 from jsonb_array_elements(peripherals) as peripheral(value)
    left join public.inventory_items item
      on item.id::text = (peripheral.value ->> 'sourceItemId')
    where item.id is null
      or (peripheral.value ->> 'sourceModule') is distinct from 'inventory'
      or upper(btrim(coalesce(item.tag, ''))) is distinct from
        upper(btrim(coalesce(peripheral.value ->> 'status', '')))
      or lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')))
        is distinct from lower(app.inventory_tag_peripheral_type(item.tag))
      or lower(btrim(coalesce(item.location, ''))) is distinct from lower(position_name)
  ) then
    raise exception 'Periférico de PDV não corresponde ao ID, TAG ou local físico do Inventário.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(peripherals) as peripheral(value)
    group by peripheral.value ->> 'sourceItemId' having count(*) > 1
  ) or exists (
    select 1 from public.inventory_items item
    where lower(btrim(item.location)) = lower(position_name)
      and app.inventory_tag_peripheral_type(item.tag) is not null
      and not exists (select 1 from jsonb_array_elements(peripherals) as peripheral(value)
        where (peripheral.value ->> 'sourceItemId') = item.id::text)
  ) then
    raise exception 'O PDV e o Inventário têm listas diferentes de periféricos.';
  end if;
  return new;
end;
$$;

drop trigger if exists management_pdv_peripheral_location_guard on public.module_records;
create trigger management_pdv_peripheral_location_guard
  before insert or update of table_id, payload on public.module_records
  for each row execute function app.guard_management_pdv_peripheral_location();

do $$
begin
  if exists (
    select 1 from pg_temp.aldeckot_pdv_location_map mapping
    join public.inventory_items item on item.id = mapping.inventory_id
    where item.location is distinct from mapping.terminal
      or item.tag is distinct from mapping.inventory_tag
  ) or (select count(*) from public.inventory_item_logs log_row
    join pg_temp.aldeckot_pdv_location_map mapping
      on mapping.inventory_id = log_row.inventory_item_id
    where log_row.message = format(
      'Localização corrigida para a posição física %s (antes vinculada ao nome do computador %s). Sem movimentação física.',
      mapping.terminal, mapping.computer)) <> 78 then
    raise exception 'A conferência final das localizações ou dos históricos falhou.';
  end if;
end;
$$;

commit;
