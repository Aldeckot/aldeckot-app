-- ALDECKOT | Log de Pin Pad para Erro no cartão e Erro no Pin Pad
-- Execute após 052_nfe_management_inventory_logs.sql no SQL Editor do Supabase.

begin;

create or replace function app.sync_nfe_creation_logs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_record record;
  matched_inventory record;
  existing_logs jsonb;
  next_payload jsonb;
  pin_pad_tag text;
  management_message text;
  pin_pad_message text;
  total_value_label text;
  pending_value_label text;
begin
  if new.created_by is null then
    return new;
  end if;

  total_value_label := replace(to_char(coalesce(new.total_value, 0), 'FM999999999990D00'), '.', ',');
  pending_value_label := replace(to_char(coalesce(new.pending_value, 0), 'FM999999999990D00'), '.', ',');
  management_message := concat_ws(E'\n',
    'Nova NF-e preenchida automaticamente.',
    format('Motivo: %s', new.reason),
    format('Operador: %s', new.operator),
    format('Fiscal: %s', new.fiscal),
    format('Valor total: R$ %s', total_value_label),
    format('Valor pendente: R$ %s', pending_value_label)
  );

  for matched_record in
    select record_row.id, record_row.payload
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id
    where table_row.module = 'management'
      and regexp_replace(lower(btrim(coalesce(record_row.payload ->> 'equipment', record_row.payload ->> 'name', ''))), '[[:space:]]+', ' ', 'g')
        = regexp_replace(lower(btrim(new.pdv)), '[[:space:]]+', ' ', 'g')
  loop
    existing_logs := case
      when jsonb_typeof(matched_record.payload -> 'logs') = 'array' then matched_record.payload -> 'logs'
      else '[]'::jsonb
    end;

    if exists (
      select 1
      from jsonb_array_elements(existing_logs) as entries(entry)
      where entries.entry ->> 'sourceModule' = 'nfe'
        and entries.entry ->> 'sourceLogId' = new.id::text
    ) then
      continue;
    end if;

    next_payload := jsonb_set(
      coalesce(matched_record.payload, '{}'::jsonb),
      '{logs}',
      existing_logs || jsonb_build_array(jsonb_build_object(
        'id', concat('nfe-', new.id::text),
        'at', new.created_at,
        'text', management_message,
        'source', 'Fiscal NF-e',
        'sourceModule', 'nfe',
        'sourceLogId', new.id::text
      )),
      true
    );
    next_payload := jsonb_set(
      next_payload,
      '{lastActivity}',
      to_jsonb(format('NF-e registrada automaticamente para %s.', new.pdv)),
      true
    );

    update public.module_records
    set payload = next_payload
    where id = matched_record.id;

    if new.reason not in ('Erro no cartão', 'Erro no Pin Pad') then
      continue;
    end if;

    select nullif(btrim(coalesce(peripheral.value ->> 'status', peripheral.value ->> 'tag', '')), '')
    into pin_pad_tag
    from jsonb_array_elements(
      case
        when jsonb_typeof(next_payload -> 'peripherals') = 'array' then next_payload -> 'peripherals'
        else '[]'::jsonb
      end
    ) as peripheral(value)
    where regexp_replace(lower(btrim(coalesce(peripheral.value ->> 'type', peripheral.value ->> 'tipo', ''))), '[[:space:]-]+', '', 'g') = 'pinpad'
    limit 1;

    if pin_pad_tag is null then
      continue;
    end if;

    pin_pad_message := concat_ws(E'\n',
      'Registro automático de NF-e.',
      format('Motivo: %s', new.reason),
      format('Operador: %s', new.operator),
      format('Número do cupom: %s', new.nfe_number),
      format('PDV: %s', new.pdv)
    );

    for matched_inventory in
      select item.id
      from public.inventory_items item
      where lower(btrim(coalesce(item.tag, ''))) = lower(btrim(pin_pad_tag))
    loop
      insert into public.inventory_item_logs (
        inventory_item_id,
        action,
        message,
        source_module,
        source_log_id
      )
      values (
        matched_inventory.id,
        'update',
        pin_pad_message,
        'nfe',
        new.id
      )
      on conflict (inventory_item_id, source_module, source_log_id)
        where source_module is not null and source_log_id is not null
      do update set action = excluded.action, message = excluded.message;
    end loop;
  end loop;

  return new;
end;
$$;

comment on function app.sync_nfe_creation_logs() is
  'Registra uma NF-e nova no PC do PDV e no Pin Pad vinculado para Erro no cartão ou Erro no Pin Pad.';

commit;
