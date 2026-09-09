-- ALDECKOT | Correção da validação centralizada de itens
-- Execute após 031_operational_permissions_and_integrity.sql.
-- Corrige funções que não devem consultar a coluna removida owner_id.

begin;

create or replace function app.validate_inventory_item_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare source_module text;
begin
  select module into source_module from public.module_tables where id = new.table_id;
  if source_module <> 'inventory' then raise exception 'A tabela informada não pertence ao módulo Inventário'; end if;
  return new;
end;
$$;

create or replace function app.validate_control_item_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare source_module text;
begin
  select module into source_module from public.module_tables where id = new.table_id;
  if source_module <> 'control' then raise exception 'A tabela informada não pertence ao módulo Controle TI'; end if;
  return new;
end;
$$;

create or replace function app.validate_flux_item_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare source_module text;
begin
  select module into source_module from public.module_tables where id = new.table_id;
  if source_module <> 'flux' then raise exception 'A tabela informada não pertence ao módulo Flux'; end if;
  return new;
end;
$$;

create or replace function app.validate_module_record_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.module_tables where id = new.table_id) then raise exception 'O registro precisa estar vinculado a uma tabela existente'; end if;
  return new;
end;
$$;

create or replace function app.validate_inventory_log_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.inventory_items where id = new.inventory_item_id) then raise exception 'O log precisa estar vinculado a um equipamento existente'; end if;
  return new;
end;
$$;

create or replace function app.validate_control_log_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.control_items where id = new.control_item_id) then raise exception 'O log precisa estar vinculado a uma manutenção existente'; end if;
  return new;
end;
$$;

create or replace function app.validate_flux_log_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.flux_items where id = new.flux_item_id) then raise exception 'O log precisa estar vinculado a uma movimentação existente'; end if;
  return new;
end;
$$;

commit;
