-- ALDECKOT | Correção da validação de identidade na edição
-- Execute após 033_equipment_identity_reconciliation.sql no SQL Editor do Supabase.
-- Preserva a validação de TAG e série em alterações reais, mas não bloqueia
-- a edição de outros campos quando a identidade do próprio item não mudou.

begin;

create or replace function app.prevent_inventory_identity_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_item_id uuid;
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.tag, ''))), ''), '-'), '***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.serial, ''))), ''), '-'), '***');
begin
  current_item_id := case when tg_op = 'UPDATE' then old.id else new.id end;

  if tg_op = 'UPDATE'
    and new.tag is not distinct from old.tag
    and new.serial is not distinct from old.serial then
    return new;
  end if;

  if incoming_tag is not null and exists (
    select 1 from public.inventory_items item
    where item.id <> coalesce(current_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.tag, ''))), ''), '-'), '***') = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está cadastrada no Inventário.';
  end if;

  if incoming_serial is not null and exists (
    select 1 from public.inventory_items item
    where item.id <> coalesce(current_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.serial, ''))), ''), '-'), '***') = incoming_serial
  ) then
    raise exception using errcode = '23505', message = 'Este número de série já está cadastrado no Inventário.';
  end if;

  return new;
end;
$$;

create or replace function app.prevent_control_identity_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_item_id uuid;
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.tag, ''))), ''), '-'), '***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.serial, ''))), ''), '-'), '***');
begin
  current_item_id := case when tg_op = 'UPDATE' then old.id else new.id end;

  if tg_op = 'UPDATE'
    and new.tag is not distinct from old.tag
    and new.serial is not distinct from old.serial then
    return new;
  end if;

  if incoming_tag is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(current_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.tag, ''))), ''), '-'), '***') = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está cadastrada no Controle TI.';
  end if;

  if incoming_serial is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(current_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.serial, ''))), ''), '-'), '***') = incoming_serial
  ) then
    raise exception using errcode = '23505', message = 'Este número de série já está cadastrado no Controle TI.';
  end if;

  return new;
end;
$$;

create or replace function app.prevent_management_identity_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_item_id uuid;
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.payload ->> 'tag', ''))), ''), '-'), '***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.payload ->> 'serial', new.payload ->> 'numeroSerie', ''))), ''), '-'), '***');
begin
  current_item_id := case when tg_op = 'UPDATE' then old.id else new.id end;

  if not exists (select 1 from public.module_tables where id = new.table_id and module = 'management') then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and (new.payload ->> 'tag') is not distinct from (old.payload ->> 'tag')
    and coalesce(new.payload ->> 'serial', new.payload ->> 'numeroSerie', '') is not distinct from coalesce(old.payload ->> 'serial', old.payload ->> 'numeroSerie', '') then
    return new;
  end if;

  if incoming_tag is not null and exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
    where record_row.id <> coalesce(current_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(record_row.payload ->> 'tag', ''))), ''), '-'), '***') = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está vinculada a outro terminal da Gestão TI.';
  end if;

  if incoming_serial is not null and exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
    where record_row.id <> coalesce(current_item_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', ''))), ''), '-'), '***') = incoming_serial
  ) then
    raise exception using errcode = '23505', message = 'Este número de série já está vinculado a outro terminal da Gestão TI.';
  end if;

  return new;
end;
$$;

commit;
