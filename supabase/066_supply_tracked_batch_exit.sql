-- ALDECKOT | Saída rastreável sem reinterpretar os status operacionais.
-- Requer 065. Não altera unidades existentes nem apaga histórico.
begin;

alter table public.supply_units add column if not exists exited_at timestamptz;
alter table public.supply_units add column if not exists exit_reason text not null default '';
alter table public.supply_units add column if not exists exited_by uuid references auth.users(id);
create index if not exists supply_units_available_idx on public.supply_units(supply_id, variant_id)
  where status = 'Em estoque' and exited_at is null;

-- Uma baixa não é Inativação nem Reserva: o status anterior fica preservado.
create or replace function app.guard_exited_supply_unit() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.exited_at is not null and new is distinct from old then
    raise exception 'A unidade já teve saída registrada e não pode ser movimentada ou editada.';
  end if;
  if new.exited_at is not null and (new.status <> 'Em estoque'
    or new.installed_inventory_item_id is not null or new.installed_management_record_id is not null) then
    raise exception 'Somente unidades disponíveis podem receber baixa de estoque.';
  end if;
  return new;
end; $$;
drop trigger if exists supply_unit_exit_guard on public.supply_units;
create trigger supply_unit_exit_guard before update on public.supply_units
  for each row execute function app.guard_exited_supply_unit();
revoke all on function app.guard_exited_supply_unit() from public, anon;

create or replace function app.supply_available(p_supply_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case when s.tracking_type = 'unit'
    then (select count(*)::integer from public.supply_units u
      left join public.supply_variants v on v.id = u.variant_id
      where u.supply_id = s.id and u.status = 'Em estoque' and u.exited_at is null
        and coalesce(v.inactive,false) = false)
    else s.quantity_stock + coalesce((select sum(v.quantity_stock)::integer from public.supply_variants v
      where v.supply_id = s.id and v.inactive = false), 0)
  end from public.supplies s where s.id = p_supply_id;
$$;

create or replace view public.supply_stock_summary with (security_invoker = true) as
select s.id, s.name, s.category, s.brand, s.model, s.description, s.image_path, s.tracking_type,
       (case when s.inventory_group_key is null then s.minimum_stock else 0 end
         + coalesce(v.variant_minimum,0))::integer as minimum_stock,
       s.default_location, s.inactive, s.notes, s.quantity_stock, s.created_at, s.updated_at,
       coalesce(u.total_units,0)::integer as total_units,
       c.available_stock::integer as available_stock,
       case when s.inactive then 'Inativo'
            when (s.inventory_group_key is null and s.minimum_stock > 0
              and (case when s.tracking_type = 'unit' then coalesce(u.base_available,0) else s.quantity_stock end) < s.minimum_stock)
              or coalesce(v.variant_deficit,false) then 'Estoque baixo'
            when c.available_stock = 0 then 'Sem estoque'
            else 'Normal' end as stock_status,
       s.inventory_group_key, s.minimum_stock as base_minimum_stock
from public.supplies s
left join lateral (select count(*) as total_units,
  count(*) filter (where u.status = 'Em estoque' and u.exited_at is null
    and coalesce(v.inactive,false) = false) as available_units,
  count(*) filter (where u.status = 'Em estoque' and u.exited_at is null
    and u.variant_id is null) as base_available
  from public.supply_units u left join public.supply_variants v on v.id = u.variant_id
  where u.supply_id = s.id) u on true
left join lateral (select sum(v.quantity_stock) filter (where not v.inactive) as variant_quantity,
  sum(v.minimum_stock) filter (where not v.inactive) as variant_minimum,
  bool_or(v.minimum_stock > 0 and
    (case when s.tracking_type = 'unit' then
      (select count(*) from public.supply_units vu where vu.variant_id = v.id
        and vu.status = 'Em estoque' and vu.exited_at is null)
    else v.quantity_stock end) < v.minimum_stock) filter (where not v.inactive) as variant_deficit
  from public.supply_variants v where v.supply_id = s.id) v on true
cross join lateral (select case when s.tracking_type = 'unit' then coalesce(u.available_units,0)
  else s.quantity_stock + coalesce(v.variant_quantity,0) end as available_stock) c
where s.deleted_at is null;
grant select on public.supply_stock_summary to authenticated;

-- Bloqueia todas as unidades escolhidas antes do pai, na ordem estável dos UUIDs,
-- como as transições existentes, para impedir uma segunda saída concorrente.
create or replace function public.supply_exit_units_batch(
  p_supply_id uuid, p_unit_ids uuid[], p_reason text
) returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  parent public.supplies%rowtype;
  unit_row public.supply_units%rowtype;
  unit_id uuid;
  unit_parent uuid;
  before_stock integer;
begin
  if not coalesce(app.is_admin(), false) then raise exception 'Apenas administradores podem retirar unidades.'; end if;
  if p_unit_ids is null or cardinality(p_unit_ids) not between 1 and 50 then
    raise exception 'Selecione de 1 a 50 unidades reais.';
  end if;
  if exists(select 1 from unnest(p_unit_ids) as ids(id) where id is null)
     or (select count(distinct id) from unnest(p_unit_ids) as ids(id)) <> cardinality(p_unit_ids) then
    raise exception 'Seleção de unidades contém IDs repetidos ou inválidos.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 5 and 500 then
    raise exception 'Informe um motivo de 5 a 500 caracteres.';
  end if;

  for unit_id in select id from unnest(p_unit_ids) as ids(id) order by id loop
    select supply_id into unit_parent from public.supply_units where id = unit_id for update;
    if not found or unit_parent is distinct from p_supply_id then
      raise exception 'A unidade % não pertence ao suprimento selecionado.', unit_id;
    end if;
  end loop;
  select * into parent from public.supplies where id = p_supply_id for update;
  if not found or parent.deleted_at is not null or parent.inventory_group_key is not null
     or parent.tracking_type <> 'unit' or parent.inactive then
    raise exception 'Suprimento rastreável próprio e ativo não encontrado.';
  end if;

  before_stock := app.supply_available(p_supply_id);
  for unit_id in select id from unnest(p_unit_ids) as ids(id) order by id loop
    select * into unit_row from public.supply_units where id = unit_id;
    if unit_row.status <> 'Em estoque' or unit_row.exited_at is not null then
      raise exception 'A unidade % não está disponível para saída.', unit_row.code;
    end if;
    if unit_row.variant_id is not null and exists(
      select 1 from public.supply_variants v where v.id = unit_row.variant_id and v.inactive
    ) then raise exception 'Reative a variação antes de retirar a unidade %.', unit_row.code; end if;

    update public.supply_units set exited_at = now(), exit_reason = btrim(p_reason),
      exited_by = auth.uid(), updated_at = now() where id = unit_id;
    insert into public.supply_movements(
      supply_id, variant_id, supply_unit_id, type, quantity, origin, destination,
      previous_stock, new_stock, reason, actor_id
    ) values(p_supply_id, unit_row.variant_id, unit_id, 'Saída', 1,
      unit_row.physical_location, 'Saída registrada', before_stock, before_stock - 1,
      btrim(p_reason), auth.uid());
    insert into public.supply_logs(supply_id, variant_id, supply_unit_id, action,
      old_value, new_value, details, actor_id)
    values(p_supply_id, unit_row.variant_id, unit_id, 'Unidade retirada',
      'Em estoque', 'Saída', format('Código: %s. Série: %s. Motivo: %s', unit_row.code,
        coalesce(nullif(unit_row.serial_number, ''), 'não informada'), btrim(p_reason)), auth.uid());
    before_stock := before_stock - 1;
  end loop;
  update public.supplies set updated_at = now() where id = p_supply_id;
  return p_unit_ids;
end; $$;
revoke all on function public.supply_exit_units_batch(uuid,uuid[],text) from public, anon;
grant execute on function public.supply_exit_units_batch(uuid,uuid[],text) to authenticated;

commit;
