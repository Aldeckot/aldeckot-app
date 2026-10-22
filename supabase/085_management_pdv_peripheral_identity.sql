-- ALDECKOT | Identidade dos periféricos instalados em PDVs.
-- Aplicar após 084, primeiro em homologação. Não altera localização, computador,
-- status, terminal nem chamado. A próxima etapa tratará a localização por PDV.
begin;

-- A auditoria é repetida dentro da transação. Uma edição concorrente não pode
-- trocar a TAG entre a resolução e a gravação do vínculo.
lock table public.inventory_items, public.module_records, public.module_tables in share row exclusive mode;

create temporary table aldeckot_pdv_peripheral_links on commit drop as
select
  record_row.id as position_id,
  btrim(record_row.payload ->> 'terminal') as terminal,
  btrim(coalesce(record_row.payload ->> 'equipment', '')) as computer,
  peripheral.ordinality as peripheral_index,
  btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', '')) as peripheral_type,
  upper(btrim(coalesce(peripheral.value ->> 'status', ''))) as peripheral_tag,
  candidate.match_count,
  candidate.inventory_id,
  candidate.inventory_location
from public.module_records record_row
join public.module_tables table_row on table_row.id = record_row.table_id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
    then record_row.payload -> 'peripherals' else '[]'::jsonb end
) with ordinality as peripheral(value, ordinality)
cross join lateral (
  select count(*)::integer as match_count,
    min(item.id::text)::uuid as inventory_id,
    min(item.location) as inventory_location
  from public.inventory_items item
  where upper(btrim(coalesce(item.tag, ''))) = upper(btrim(coalesce(peripheral.value ->> 'status', '')))
) candidate
where table_row.module = 'management'
  and btrim(coalesce(record_row.payload ->> 'terminal', '')) ~* '^PDV[[:space:]]+[0-9]+$'
  and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is null;

do $$
declare
  link_count integer;
  existing_link_count integer;
begin
  select count(*) into link_count from pg_temp.aldeckot_pdv_peripheral_links;

  select count(*) into existing_link_count
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
      then record_row.payload -> 'peripherals' else '[]'::jsonb end
  ) as peripheral(value)
  where table_row.module = 'management'
    and btrim(coalesce(record_row.payload ->> 'terminal', '')) ~* '^PDV[[:space:]]+[0-9]+$'
    and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is not null;

  if existing_link_count <> 19 then
    raise exception 'Esperados 19 periféricos de PDV já vinculados, encontrados %. Execute novamente a auditoria.', existing_link_count;
  end if;

  if exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
        then record_row.payload -> 'peripherals' else '[]'::jsonb end
    ) as peripheral(value)
    left join public.inventory_items item
      on item.id::text = (peripheral.value ->> 'sourceItemId')
    where table_row.module = 'management'
      and btrim(coalesce(record_row.payload ->> 'terminal', '')) ~* '^PDV[[:space:]]+[0-9]+$'
      and nullif(btrim(coalesce(peripheral.value ->> 'sourceItemId', '')), '') is not null
      and (item.id is null
        or upper(btrim(coalesce(item.tag, ''))) is distinct from upper(btrim(coalesce(peripheral.value ->> 'status', '')))
        or lower(btrim(coalesce(item.location, ''))) not in (
          lower(btrim(coalesce(record_row.payload ->> 'equipment', ''))),
          lower(btrim(coalesce(record_row.payload ->> 'terminal', '')))
        ))
  ) then
    raise exception 'Um vínculo existente de PDV diverge do Inventário; nenhuma alteração foi gravada.';
  end if;

  if exists (
    select 1 from pg_temp.aldeckot_pdv_peripheral_links
    where peripheral_tag = '' or match_count <> 1 or inventory_id is null
  ) then
    raise exception 'Há periféricos de PDV sem TAG única no Inventário; execute novamente a auditoria antes da migração.';
  end if;

  if exists (
    select 1 from pg_temp.aldeckot_pdv_peripheral_links
    where lower(peripheral_type) is distinct from lower(app.inventory_tag_peripheral_type(peripheral_tag))
  ) then
    raise exception 'A TAG e o tipo de um periférico de PDV divergem; nenhuma alteração foi gravada.';
  end if;

  if exists (
    select 1 from pg_temp.aldeckot_pdv_peripheral_links
    where lower(btrim(coalesce(inventory_location, ''))) not in (lower(computer), lower(terminal))
  ) then
    raise exception 'O local de um periférico mudou após a auditoria; nenhuma alteração foi gravada.';
  end if;

  if exists (
    select 1 from pg_temp.aldeckot_pdv_peripheral_links
    group by inventory_id having count(*) > 1
  ) then
    raise exception 'Um item do Inventário aparece em mais de uma posição; nenhuma alteração foi gravada.';
  end if;

  if exists (
    select 1
    from pg_temp.aldeckot_pdv_peripheral_links link
    join public.module_records other_record on true
    join public.module_tables other_table on other_table.id = other_record.table_id and other_table.module = 'management'
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(other_record.payload -> 'peripherals') = 'array'
        then other_record.payload -> 'peripherals' else '[]'::jsonb end
    ) with ordinality as other_peripheral(value, peripheral_index)
    where not (other_record.id = link.position_id and other_peripheral.peripheral_index = link.peripheral_index)
      and (
        other_peripheral.value ->> 'sourceItemId' = link.inventory_id::text
        or upper(btrim(coalesce(other_peripheral.value ->> 'status', ''))) = link.peripheral_tag
      )
  ) then
    raise exception 'Uma TAG ou ID já está vinculado a outro periférico; nenhuma alteração foi gravada.';
  end if;

  if exists (
    select 1 from pg_temp.aldeckot_pdv_peripheral_links
    group by lower(terminal) having count(distinct position_id) > 1
  ) then
    raise exception 'Há posições PDV duplicadas; nenhuma alteração foi gravada.';
  end if;

  -- O preflight validado pelo usuário encontrou 59 vínculos sem ID. Se houve
  -- edição desde então, interromper e exigir nova auditoria, sem adivinhar.
  if link_count <> 59 then
    raise exception 'Esperados 59 periféricos sem ID, encontrados %. Execute novamente a auditoria.', link_count;
  end if;
  raise notice 'Vínculos únicos conferidos: %.', link_count;
end;
$$;

-- Atualização apenas dos dois campos de origem de cada entrada existente.
-- Não adiciona nem remove periféricos; a ordem e as demais propriedades ficam.
select set_config('app.management_transfer_in_progress', 'on', true);

with rebuilt as (
  select record_row.id,
    jsonb_agg(
      case when link.inventory_id is null then peripheral.value
        else peripheral.value || jsonb_build_object(
          'sourceModule', 'inventory', 'sourceItemId', link.inventory_id::text
        ) end
      order by peripheral.ordinality
    ) as peripherals
  from public.module_records record_row
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(record_row.payload -> 'peripherals') = 'array'
      then record_row.payload -> 'peripherals' else '[]'::jsonb end
  )
    with ordinality as peripheral(value, ordinality)
  left join pg_temp.aldeckot_pdv_peripheral_links link
    on link.position_id = record_row.id and link.peripheral_index = peripheral.ordinality
  where record_row.id in (select position_id from pg_temp.aldeckot_pdv_peripheral_links)
  group by record_row.id
)
update public.module_records record_row
set payload = jsonb_set(record_row.payload, '{peripherals}', rebuilt.peripherals, true)
from rebuilt
where record_row.id = rebuilt.id
  and record_row.payload -> 'peripherals' is distinct from rebuilt.peripherals;

select set_config('app.management_transfer_in_progress', 'off', true);

do $$
begin
  if exists (
    select 1
    from pg_temp.aldeckot_pdv_peripheral_links link
    join public.module_records record_row on record_row.id = link.position_id
    cross join lateral jsonb_array_elements(record_row.payload -> 'peripherals')
      with ordinality as peripheral(value, ordinality)
    where peripheral.ordinality = link.peripheral_index
      and (peripheral.value ->> 'sourceItemId' is distinct from link.inventory_id::text
        or peripheral.value ->> 'sourceModule' is distinct from 'inventory'
        or upper(btrim(coalesce(peripheral.value ->> 'status', ''))) is distinct from link.peripheral_tag)
  ) then
    raise exception 'A conferência final dos vínculos falhou; a transação foi cancelada.';
  end if;
end;
$$;

commit;
