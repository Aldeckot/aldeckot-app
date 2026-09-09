-- ALDECKOT | Conciliação de identificadores de equipamentos
-- Execute após 032_fix_centralized_validation.sql no SQL Editor do Supabase.
-- TAGs e números de série "***" ou "-" representam ausência de identificação.

begin;

create table if not exists public.equipment_identity_conflict_resolutions (
  conflict_key text primary key,
  identity_kind text not null,
  identity_value text not null,
  conflict_type text not null,
  resolved_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  resolved_at timestamptz not null default timezone('utc', now())
);

alter table public.equipment_identity_conflict_resolutions enable row level security;
revoke all on public.equipment_identity_conflict_resolutions from anon;
grant select, insert on public.equipment_identity_conflict_resolutions to authenticated;

drop policy if exists "Contas ativas leem conciliações resolvidas" on public.equipment_identity_conflict_resolutions;
drop policy if exists "Administradores resolvem conciliações" on public.equipment_identity_conflict_resolutions;
create policy "Contas ativas leem conciliações resolvidas"
  on public.equipment_identity_conflict_resolutions for select to authenticated
  using (app.has_active_account());
create policy "Administradores resolvem conciliações"
  on public.equipment_identity_conflict_resolutions for insert to authenticated
  with check (app.is_admin() and resolved_by = auth.uid());

-- Valores reservados indicam que a identificação não existe e, portanto, podem
-- ser usados por diversos equipamentos sem acionar uma duplicidade.
create or replace function app.prevent_inventory_identity_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.tag, ''))), ''), '-'), '***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.serial, ''))), ''), '-'), '***');
begin
  if incoming_tag is not null and exists (
    select 1 from public.inventory_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.tag, ''))), ''), '-'), '***') = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está cadastrada no Inventário.';
  end if;
  if incoming_serial is not null and exists (
    select 1 from public.inventory_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
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
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.tag, ''))), ''), '-'), '***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.serial, ''))), ''), '-'), '***');
begin
  if incoming_tag is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(item.tag, ''))), ''), '-'), '***') = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está cadastrada no Controle TI.';
  end if;
  if incoming_serial is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
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
  incoming_tag text := nullif(nullif(nullif(lower(btrim(coalesce(new.payload ->> 'tag', ''))), ''), '-'), '***');
  incoming_serial text := nullif(nullif(nullif(lower(btrim(coalesce(new.payload ->> 'serial', new.payload ->> 'numeroSerie', ''))), ''), '-'), '***');
begin
  if not exists (select 1 from public.module_tables where id = new.table_id and module = 'management') then
    return new;
  end if;
  if incoming_tag is not null and exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
    where record_row.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(record_row.payload ->> 'tag', ''))), ''), '-'), '***') = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está vinculada a outro terminal da Gestão TI.';
  end if;
  if incoming_serial is not null and exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
    where record_row.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and nullif(nullif(nullif(lower(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', ''))), ''), '-'), '***') = incoming_serial
  ) then
    raise exception using errcode = '23505', message = 'Este número de série já está vinculado a outro terminal da Gestão TI.';
  end if;
  return new;
end;
$$;

create or replace function public.equipment_identity_conflicts()
returns table(identity_kind text, identity_value text, conflict_type text, modules text[], records jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with equipment as (
    select 'inventory'::text as module, item.equipment,
      nullif(nullif(nullif(lower(btrim(item.tag)), ''), '-'), '***') as tag,
      nullif(nullif(nullif(lower(btrim(item.serial)), ''), '-'), '***') as serial
    from public.inventory_items item
    union all
    select 'control'::text, item.equipment,
      nullif(nullif(nullif(lower(btrim(item.tag)), ''), '-'), '***'),
      nullif(nullif(nullif(lower(btrim(item.serial)), ''), '-'), '***')
    from public.control_items item
    union all
    select 'management'::text, coalesce(record_row.payload ->> 'equipment', record_row.payload ->> 'name', 'Terminal'),
      nullif(nullif(nullif(lower(btrim(record_row.payload ->> 'tag')), ''), '-'), '***'),
      nullif(nullif(nullif(lower(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', ''))), ''), '-'), '***')
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
  ), tag_conflicts as (
    select 'TAG'::text as identity_kind, tag as identity_value, 'Números de série divergentes'::text as conflict_type,
      array_agg(distinct module order by module) as modules,
      jsonb_agg(jsonb_build_object('module', module, 'equipment', equipment, 'tag', tag, 'serial', serial)) as records
    from equipment where tag is not null
    group by tag
    having count(distinct serial) filter (where serial is not null) > 1
  ), serial_conflicts as (
    select 'Nº de série'::text, serial, 'TAGs divergentes'::text,
      array_agg(distinct module order by module),
      jsonb_agg(jsonb_build_object('module', module, 'equipment', equipment, 'tag', tag, 'serial', serial))
    from equipment where serial is not null
    group by serial
    having count(distinct tag) filter (where tag is not null) > 1
  ), all_conflicts as (
    select * from tag_conflicts
    union all
    select * from serial_conflicts
  )
  select conflict.identity_kind, conflict.identity_value, conflict.conflict_type, conflict.modules, conflict.records
  from all_conflicts conflict
  where not exists (
    select 1
    from public.equipment_identity_conflict_resolutions resolution
    where resolution.conflict_key = lower(concat_ws(':', 'identity', conflict.identity_kind, conflict.identity_value, conflict.conflict_type))
  )
$$;

alter table public.equipment_identity_conflict_resolutions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'equipment_identity_conflict_resolutions'
  ) then
    alter publication supabase_realtime add table public.equipment_identity_conflict_resolutions;
  end if;
end;
$$;

grant execute on function public.equipment_identity_conflicts() to authenticated;

commit;
