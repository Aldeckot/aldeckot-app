-- ALDECKOT | Entrada atômica de unidades rastreáveis próprias.
-- Requer 064. Não altera nem cria unidades existentes.
begin;

create or replace function public.supply_create_units_batch(
  p_supply_id uuid, p_variant_id uuid, p_units jsonb, p_reason text
) returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  parent public.supplies%rowtype;
  variant public.supply_variants%rowtype;
  entry jsonb;
  unit_id uuid;
  unit_code text;
  unit_serial text;
  unit_location text;
  before_stock integer;
  created_ids uuid[] := array[]::uuid[];
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem criar unidades.'; end if;
  if p_units is null or jsonb_typeof(p_units) is distinct from 'array' then
    raise exception 'Lista de unidades inválida.';
  end if;
  if jsonb_array_length(p_units) not between 1 and 50 then
    raise exception 'Informe entre 1 e 50 unidades reais por entrada.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'Informe um motivo de 5 a 500 caracteres.';
  end if;

  -- O bloqueio do pai serializa entradas concorrentes no mesmo suprimento.
  select * into parent from public.supplies where id = p_supply_id for update;
  if not found or parent.deleted_at is not null or parent.inventory_group_key is not null
     or parent.tracking_type <> 'unit' or parent.inactive then
    raise exception 'Suprimento rastreável próprio e ativo não encontrado.';
  end if;
  if p_variant_id is not null then
    select * into variant from public.supply_variants
      where id = p_variant_id and supply_id = p_supply_id for update;
    if not found or variant.inactive or variant.inventory_variant_key is not null then
      raise exception 'Variação própria ativa não encontrada neste suprimento.';
    end if;
  end if;

  before_stock := app.supply_available(p_supply_id);
  for entry in select value from jsonb_array_elements(p_units) loop
    if jsonb_typeof(entry) is distinct from 'object' then raise exception 'Identificação da unidade inválida.'; end if;
    unit_code := nullif(btrim(regexp_replace(coalesce(entry->>'code', ''), '[[:space:]]+', ' ', 'g')), '');
    if unit_code is null then unit_code := 'UN-' || replace(gen_random_uuid()::text, '-', ''); end if;
    unit_serial := btrim(regexp_replace(coalesce(entry->>'serialNumber', ''), '[[:space:]]+', ' ', 'g'));
    unit_location := coalesce(nullif(btrim(entry->>'location'), ''), parent.default_location);
    if length(unit_code) > 100 or length(unit_serial) > 160 or length(unit_location) > 160 then
      raise exception 'Código, série ou local excede o tamanho permitido.';
    end if;
    if unit_serial <> '' and exists (
      select 1 from public.supply_units u where u.supply_id = p_supply_id
        and lower(btrim(regexp_replace(u.serial_number, '[[:space:]]+', ' ', 'g'))) = lower(unit_serial)
    ) then raise exception 'Número de série já cadastrado neste suprimento: %', unit_serial; end if;

    insert into public.supply_units(supply_id, variant_id, code, serial_number, physical_location)
    values(p_supply_id, p_variant_id, unit_code, unit_serial, unit_location)
    returning id into unit_id;
    created_ids := array_append(created_ids, unit_id);
    insert into public.supply_movements(
      supply_id, variant_id, supply_unit_id, type, quantity, previous_stock, new_stock, reason, actor_id
    ) values(p_supply_id, p_variant_id, unit_id, 'Entrada', 1, before_stock, before_stock + 1,
      btrim(p_reason), auth.uid());
    insert into public.supply_logs(supply_id, variant_id, supply_unit_id, action, new_value, details, actor_id)
    values(p_supply_id, p_variant_id, unit_id, 'Unidade criada', unit_code,
      format('Série: %s. Motivo: %s', coalesce(nullif(unit_serial, ''), 'não informada'), btrim(p_reason)), auth.uid());
    before_stock := before_stock + 1;
  end loop;
  update public.supplies set updated_at = now() where id = p_supply_id;
  return created_ids;
end; $$;

-- A rotina antiga continua disponível, mas passa pelas mesmas validações.
create or replace function public.supply_create_unit(
  p_supply_id uuid, p_variant_id uuid, p_code text, p_serial_number text, p_location text
) returns uuid language plpgsql security definer set search_path = public as $$
declare created_ids uuid[];
begin
  created_ids := public.supply_create_units_batch(p_supply_id, p_variant_id,
    jsonb_build_array(jsonb_build_object('code', p_code, 'serialNumber', p_serial_number, 'location', p_location)),
    'Unidade cadastrada');
  return created_ids[1];
end; $$;

-- Edições também respeitam a unicidade de série; os registros antigos são preservados.
create or replace function public.supply_edit_unit(
  p_unit_id uuid, p_code text, p_serial_number text, p_location text
) returns void language plpgsql security definer set search_path = public as $$
declare unit_row public.supply_units%rowtype; parent_id uuid; normalized_serial text;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem editar unidades.'; end if;
  select * into unit_row from public.supply_units where id = p_unit_id for update;
  if not found then raise exception 'Unidade não encontrada.'; end if;
  parent_id := unit_row.supply_id;
  perform 1 from public.supplies where id = parent_id for update;
  normalized_serial := btrim(regexp_replace(coalesce(p_serial_number, ''), '[[:space:]]+', ' ', 'g'));
  if length(normalized_serial) > 160 then raise exception 'Número de série muito longo.'; end if;
  if normalized_serial <> '' and exists (
    select 1 from public.supply_units u where u.supply_id = parent_id and u.id <> p_unit_id
      and lower(btrim(regexp_replace(u.serial_number, '[[:space:]]+', ' ', 'g'))) = lower(normalized_serial)
  ) then raise exception 'Número de série já cadastrado neste suprimento: %', normalized_serial; end if;
  if unit_row.status = 'Instalado'
    and coalesce(nullif(btrim(p_location), ''), unit_row.physical_location) <> unit_row.physical_location then
    raise exception 'O local de uma unidade instalada vem do equipamento. Use transferência para alterá-lo.';
  end if;
  update public.supply_units set code = btrim(p_code), serial_number = normalized_serial,
    physical_location = coalesce(nullif(btrim(p_location), ''), unit_row.physical_location), updated_at = now()
  where id = p_unit_id;
  insert into public.supply_logs(supply_id, supply_unit_id, action, old_value, new_value, actor_id)
  values(parent_id, p_unit_id, 'Unidade editada', unit_row.code, btrim(p_code), auth.uid());
  update public.supplies set updated_at = now() where id = parent_id;
end; $$;

revoke all on function public.supply_create_units_batch(uuid,uuid,jsonb,text) from public, anon;
grant execute on function public.supply_create_units_batch(uuid,uuid,jsonb,text) to authenticated;

commit;
