-- Status operacional próprio dos equipamentos cadastrados em Suprimentos.
-- O status de estoque permanece independente; itens espelhados do Inventário
-- continuam usando o status das unidades na origem.
begin;

alter table public.supplies
  add column if not exists equipment_status text not null default 'Ativo';

update public.supplies
set equipment_status = 'Inativo'
where inactive and equipment_status = 'Ativo' and inventory_group_key is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'supplies_equipment_status_check'
    and conrelid = 'public.supplies'::regclass) then
    alter table public.supplies add constraint supplies_equipment_status_check
      check (equipment_status in ('Ativo', 'Reserva', 'Manutenção', 'Troca', 'Inativo', 'Defeito', 'Atenção'));
  end if;
end $$;

create or replace function app.sync_supply_equipment_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.inventory_group_key is null and new.inactive is distinct from old.inactive then
    new.equipment_status := case when new.inactive then 'Inativo' else 'Ativo' end;
  end if;
  return new;
end;
$$;

drop trigger if exists supply_equipment_status_on_active on public.supplies;
create trigger supply_equipment_status_on_active
before update of inactive on public.supplies
for each row execute function app.sync_supply_equipment_status();

create or replace function public.supply_set_equipment_status(p_supply_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, app as $$
begin
  if not app.is_admin() or not app.can_manage_module('supplies', 'update') then
    raise exception 'Sem permissão para alterar o status do equipamento.';
  end if;
  if p_status not in ('Ativo', 'Reserva', 'Manutenção', 'Troca', 'Inativo', 'Defeito', 'Atenção') then
    raise exception 'Status do equipamento inválido.';
  end if;
  update public.supplies
     set equipment_status = p_status, updated_at = now()
   where id = p_supply_id and inventory_group_key is null and deleted_at is null;
  if not found then raise exception 'Equipamento próprio de Suprimentos não encontrado.'; end if;
end;
$$;

revoke all on function public.supply_set_equipment_status(uuid, text) from public, anon;
grant execute on function public.supply_set_equipment_status(uuid, text) to authenticated;

create or replace function public.supply_save_item_with_status(
  p_id uuid, p_name text, p_category text, p_brand text, p_model text,
  p_description text, p_tracking_type text, p_minimum_stock integer,
  p_default_location text, p_notes text, p_equipment_status text
) returns uuid language plpgsql security definer set search_path = public, app as $$
declare result_id uuid;
begin
  if p_equipment_status not in ('Ativo', 'Reserva', 'Manutenção', 'Troca', 'Inativo', 'Defeito', 'Atenção') then
    raise exception 'Status do equipamento inválido.';
  end if;
  result_id := public.supply_save_item(p_id, p_name, p_category, p_brand, p_model,
    p_description, p_tracking_type, p_minimum_stock, p_default_location, p_notes);
  perform public.supply_set_equipment_status(result_id, p_equipment_status);
  return result_id;
end;
$$;

revoke all on function public.supply_save_item_with_status(uuid,text,text,text,text,text,text,integer,text,text,text) from public, anon;
grant execute on function public.supply_save_item_with_status(uuid,text,text,text,text,text,text,integer,text,text,text) to authenticated;

commit;
