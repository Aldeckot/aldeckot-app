-- ALDECKOT | Permissões operacionais, integridade de equipamentos e indicadores.
-- Execute após 030_monthly_audit_reports.sql no SQL Editor do Supabase.

begin;

create schema if not exists app;

-- Permissões granulares são atribuídas pelo administrador em Configurações.
-- Administradores continuam com acesso integral, sem depender desta coluna.
alter table public.profiles
  add column if not exists module_permissions jsonb not null default '{}'::jsonb
  check (jsonb_typeof(module_permissions) = 'object');

update public.profiles
set module_permissions = '{}'::jsonb
where module_permissions is null or jsonb_typeof(module_permissions) <> 'object';

create or replace function app.can_manage_module(p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app.is_admin()
    or coalesce((profile.module_permissions -> lower(trim(p_module)) ->> lower(trim(p_action)))::boolean, false)
  from public.profiles profile
  where profile.id = auth.uid() and profile.status = 'active'
$$;

create or replace function app.can_manage_module_table(p_table_id uuid, p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.module_tables table_row
    where table_row.id = p_table_id
      and table_row.module = lower(trim(p_module))
      and app.can_manage_module(p_module, p_action)
  )
$$;

-- As tabelas corporativas são centralizadas. Estas validações preservam somente
-- a relação entre módulo, tabela, item e log; a autorização é feita pelas RLS.
create or replace function app.validate_inventory_item_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare table_module text;
begin
  select module into table_module from public.module_tables where id = new.table_id;
  if table_module <> 'inventory' then raise exception 'A tabela informada não pertence ao módulo Inventário'; end if;
  return new;
end;
$$;

create or replace function app.validate_control_item_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare table_module text;
begin
  select module into table_module from public.module_tables where id = new.table_id;
  if table_module <> 'control' then raise exception 'A tabela informada não pertence ao módulo Controle TI'; end if;
  return new;
end;
$$;

create or replace function app.validate_flux_item_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare table_module text;
begin
  select module into table_module from public.module_tables where id = new.table_id;
  if table_module <> 'flux' then raise exception 'A tabela informada não pertence ao módulo Flux'; end if;
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

-- A identidade não é duplicada dentro do mesmo módulo. A mesma TAG pode,
-- intencionalmente, existir em módulos distintos para a sincronização corporativa.
create or replace function app.prevent_inventory_identity_duplicate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(coalesce(new.tag, '')), '') is not null and exists (
    select 1 from public.inventory_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(btrim(coalesce(item.tag, ''))) = lower(btrim(new.tag))
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está cadastrada no Inventário.';
  end if;
  if nullif(btrim(coalesce(new.serial, '')), '') is not null and exists (
    select 1 from public.inventory_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(btrim(coalesce(item.serial, ''))) = lower(btrim(new.serial))
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
begin
  if nullif(btrim(coalesce(new.tag, '')), '') is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(btrim(coalesce(item.tag, ''))) = lower(btrim(new.tag))
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está cadastrada no Controle TI.';
  end if;
  if nullif(btrim(coalesce(new.serial, '')), '') is not null and exists (
    select 1 from public.control_items item
    where item.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(btrim(coalesce(item.serial, ''))) = lower(btrim(new.serial))
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
  incoming_tag text := nullif(lower(btrim(coalesce(new.payload ->> 'tag', ''))), '');
  incoming_serial text := nullif(lower(btrim(coalesce(new.payload ->> 'serial', new.payload ->> 'numeroSerie', ''))), '');
begin
  if not exists (select 1 from public.module_tables where id = new.table_id and module = 'management') then
    return new;
  end if;
  if incoming_tag is not null and exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
    where record_row.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(btrim(coalesce(record_row.payload ->> 'tag', ''))) = incoming_tag
  ) then
    raise exception using errcode = '23505', message = 'Esta TAG já está vinculada a outro terminal da Gestão TI.';
  end if;
  if incoming_serial is not null and exists (
    select 1
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
    where record_row.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and lower(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', ''))) = incoming_serial
  ) then
    raise exception using errcode = '23505', message = 'Este número de série já está vinculado a outro terminal da Gestão TI.';
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_identity_is_unique on public.inventory_items;
create trigger inventory_identity_is_unique before insert or update of tag, serial on public.inventory_items
  for each row execute procedure app.prevent_inventory_identity_duplicate();

drop trigger if exists control_identity_is_unique on public.control_items;
create trigger control_identity_is_unique before insert or update of tag, serial on public.control_items
  for each row execute procedure app.prevent_control_identity_duplicate();

drop trigger if exists management_identity_is_unique on public.module_records;
create trigger management_identity_is_unique before insert or update of table_id, payload on public.module_records
  for each row execute procedure app.prevent_management_identity_duplicate();

-- Conflitos são diferenças reais entre registros correlacionados, não a simples
-- presença da mesma TAG em módulos que devem permanecer sincronizados.
create or replace function public.equipment_identity_conflicts()
returns table(identity_kind text, identity_value text, conflict_type text, modules text[], records jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with equipment as (
    select 'inventory'::text as module, item.equipment, nullif(btrim(item.tag), '') as tag, nullif(btrim(item.serial), '') as serial
    from public.inventory_items item
    union all
    select 'control'::text, item.equipment, nullif(btrim(item.tag), ''), nullif(btrim(item.serial), '')
    from public.control_items item
    union all
    select 'management'::text, coalesce(record_row.payload ->> 'equipment', record_row.payload ->> 'name', 'Terminal'),
      nullif(btrim(record_row.payload ->> 'tag'), ''),
      nullif(btrim(coalesce(record_row.payload ->> 'serial', record_row.payload ->> 'numeroSerie', '')), '')
    from public.module_records record_row
    join public.module_tables table_row on table_row.id = record_row.table_id and table_row.module = 'management'
  ), tag_conflicts as (
    select 'TAG'::text as identity_kind, lower(tag) as identity_value, 'Números de série divergentes'::text as conflict_type,
      array_agg(distinct module order by module) as modules,
      jsonb_agg(jsonb_build_object('module', module, 'equipment', equipment, 'tag', tag, 'serial', serial)) as records
    from equipment where tag is not null
    group by lower(tag)
    having count(distinct lower(serial)) filter (where serial is not null) > 1
  ), serial_conflicts as (
    select 'Nº de série'::text, lower(serial), 'TAGs divergentes'::text,
      array_agg(distinct module order by module),
      jsonb_agg(jsonb_build_object('module', module, 'equipment', equipment, 'tag', tag, 'serial', serial))
    from equipment where serial is not null
    group by lower(serial)
    having count(distinct lower(tag)) filter (where tag is not null) > 1
  )
  select * from tag_conflicts union all select * from serial_conflicts
$$;

-- Indicadores e alertas usados pela página inicial e pela Central de Operações.
create or replace function public.operational_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with today as (select (timezone('America/Sao_Paulo', now()))::date as value),
  metrics as (
    select
      (select count(*) from public.inventory_items) as inventory_total,
      (select count(*) from public.inventory_items where lower(status) = 'ativo') as inventory_active,
      (select count(*) from public.control_items where lower(status) in ('manutenção', 'manutencao', 'defeito')) as maintenance_open,
      (select count(*) from public.flux_items where lower(status) in ('pendente', 'em trânsito', 'em transito')) as transfers_open,
      (select count(*) from public.nfe_occurrences where occurred_at >= date_trunc('month', now())) as nfe_month,
      (select count(*) from public.agenda_entries, today where not is_completed and due_date < today.value) as agenda_overdue,
      (select count(*) from public.equipment_identity_conflicts()) as identity_conflicts
  )
  select jsonb_build_object(
    'inventoryTotal', inventory_total,
    'inventoryActive', inventory_active,
    'maintenanceOpen', maintenance_open,
    'transfersOpen', transfers_open,
    'nfeMonth', nfe_month,
    'agendaOverdue', agenda_overdue,
    'identityConflicts', identity_conflicts
  ) from metrics
$$;

-- Escrita concedida apenas quando a permissão do módulo contempla a ação.
-- Políticas administrativas existentes continuam válidas como acesso integral.
drop policy if exists "Permissão por módulo cria tabela" on public.module_tables;
drop policy if exists "Permissão por módulo edita tabela" on public.module_tables;
drop policy if exists "Permissão por módulo exclui tabela" on public.module_tables;
create policy "Permissão por módulo cria tabela" on public.module_tables for insert to authenticated
  with check (app.can_manage_module(module, 'create'));
create policy "Permissão por módulo edita tabela" on public.module_tables for update to authenticated
  using (app.can_manage_module(module, 'update')) with check (app.can_manage_module(module, 'update'));
create policy "Permissão por módulo exclui tabela" on public.module_tables for delete to authenticated
  using (app.can_manage_module(module, 'delete'));

drop policy if exists "Permissão por módulo cria item de inventário" on public.inventory_items;
drop policy if exists "Permissão por módulo edita item de inventário" on public.inventory_items;
drop policy if exists "Permissão por módulo exclui item de inventário" on public.inventory_items;
create policy "Permissão por módulo cria item de inventário" on public.inventory_items for insert to authenticated
  with check (app.can_manage_module_table(table_id, 'inventory', 'create'));
create policy "Permissão por módulo edita item de inventário" on public.inventory_items for update to authenticated
  using (app.can_manage_module('inventory', 'update')) with check (app.can_manage_module_table(table_id, 'inventory', 'update'));
create policy "Permissão por módulo exclui item de inventário" on public.inventory_items for delete to authenticated
  using (app.can_manage_module('inventory', 'delete'));

drop policy if exists "Permissão por módulo cria log de inventário" on public.inventory_item_logs;
drop policy if exists "Permissão por módulo edita log de inventário" on public.inventory_item_logs;
drop policy if exists "Permissão por módulo exclui log de inventário" on public.inventory_item_logs;
create policy "Permissão por módulo cria log de inventário" on public.inventory_item_logs for insert to authenticated
  with check (app.can_manage_module('inventory', 'update'));
create policy "Permissão por módulo edita log de inventário" on public.inventory_item_logs for update to authenticated
  using (app.can_manage_module('inventory', 'update')) with check (app.can_manage_module('inventory', 'update'));
create policy "Permissão por módulo exclui log de inventário" on public.inventory_item_logs for delete to authenticated
  using (app.can_manage_module('inventory', 'delete'));

drop policy if exists "Permissão por módulo cria item de controle" on public.control_items;
drop policy if exists "Permissão por módulo edita item de controle" on public.control_items;
drop policy if exists "Permissão por módulo exclui item de controle" on public.control_items;
create policy "Permissão por módulo cria item de controle" on public.control_items for insert to authenticated
  with check (app.can_manage_module_table(table_id, 'control', 'create'));
create policy "Permissão por módulo edita item de controle" on public.control_items for update to authenticated
  using (app.can_manage_module('control', 'update')) with check (app.can_manage_module_table(table_id, 'control', 'update'));
create policy "Permissão por módulo exclui item de controle" on public.control_items for delete to authenticated
  using (app.can_manage_module('control', 'delete'));

drop policy if exists "Permissão por módulo cria log de controle" on public.control_item_logs;
drop policy if exists "Permissão por módulo edita log de controle" on public.control_item_logs;
drop policy if exists "Permissão por módulo exclui log de controle" on public.control_item_logs;
create policy "Permissão por módulo cria log de controle" on public.control_item_logs for insert to authenticated
  with check (app.can_manage_module('control', 'update'));
create policy "Permissão por módulo edita log de controle" on public.control_item_logs for update to authenticated
  using (app.can_manage_module('control', 'update')) with check (app.can_manage_module('control', 'update'));
create policy "Permissão por módulo exclui log de controle" on public.control_item_logs for delete to authenticated
  using (app.can_manage_module('control', 'delete'));

drop policy if exists "Permissão por módulo cria item de fluxo" on public.flux_items;
drop policy if exists "Permissão por módulo edita item de fluxo" on public.flux_items;
drop policy if exists "Permissão por módulo exclui item de fluxo" on public.flux_items;
create policy "Permissão por módulo cria item de fluxo" on public.flux_items for insert to authenticated
  with check (app.can_manage_module_table(table_id, 'flux', 'create'));
create policy "Permissão por módulo edita item de fluxo" on public.flux_items for update to authenticated
  using (app.can_manage_module('flux', 'update')) with check (app.can_manage_module_table(table_id, 'flux', 'update'));
create policy "Permissão por módulo exclui item de fluxo" on public.flux_items for delete to authenticated
  using (app.can_manage_module('flux', 'delete'));

drop policy if exists "Permissão por módulo cria log de fluxo" on public.flux_item_logs;
drop policy if exists "Permissão por módulo edita log de fluxo" on public.flux_item_logs;
drop policy if exists "Permissão por módulo exclui log de fluxo" on public.flux_item_logs;
create policy "Permissão por módulo cria log de fluxo" on public.flux_item_logs for insert to authenticated
  with check (app.can_manage_module('flux', 'update'));
create policy "Permissão por módulo edita log de fluxo" on public.flux_item_logs for update to authenticated
  using (app.can_manage_module('flux', 'update')) with check (app.can_manage_module('flux', 'update'));
create policy "Permissão por módulo exclui log de fluxo" on public.flux_item_logs for delete to authenticated
  using (app.can_manage_module('flux', 'delete'));

drop policy if exists "Permissão por módulo cria registro de gestão" on public.module_records;
drop policy if exists "Permissão por módulo edita registro de gestão" on public.module_records;
drop policy if exists "Permissão por módulo exclui registro de gestão" on public.module_records;
create policy "Permissão por módulo cria registro de gestão" on public.module_records for insert to authenticated
  with check (app.can_manage_module_table(table_id, 'management', 'create'));
create policy "Permissão por módulo edita registro de gestão" on public.module_records for update to authenticated
  using (app.can_manage_module('management', 'update')) with check (app.can_manage_module_table(table_id, 'management', 'update'));
create policy "Permissão por módulo exclui registro de gestão" on public.module_records for delete to authenticated
  using (app.can_manage_module('management', 'delete'));

drop policy if exists "Permissão por módulo cria evento sincronizado" on public.sync_events;
create policy "Permissão por módulo cria evento sincronizado" on public.sync_events for insert to authenticated
  with check (app.can_manage_module(module, 'update'));

-- Cópias e restaurações recebem uma permissão própria. A leitura continua
-- disponível a contas ativas, como já ocorre no restante dos módulos.
do $$
declare target_table text; target_module text;
begin
  for target_table, target_module in
    select * from (values
      ('inventory_backups', 'inventory'), ('inventory_backup_settings', 'inventory'),
      ('management_backups', 'management'), ('management_backup_settings', 'management'),
      ('control_backups', 'control'), ('control_backup_settings', 'control'),
      ('flux_backups', 'flux'), ('flux_backup_settings', 'flux'),
      ('nfe_backups', 'nfe'), ('nfe_backup_settings', 'nfe')
    ) as targets(table_name, module_name)
  loop
    execute format('drop policy if exists %I on public.%I', 'Permissão de backup cria', target_table);
    execute format('drop policy if exists %I on public.%I', 'Permissão de backup edita', target_table);
    execute format('drop policy if exists %I on public.%I', 'Permissão de backup exclui', target_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (app.can_manage_module(%L, ''backup''))', 'Permissão de backup cria', target_table, target_module);
    execute format('create policy %I on public.%I for update to authenticated using (app.can_manage_module(%L, ''backup'')) with check (app.can_manage_module(%L, ''backup''))', 'Permissão de backup edita', target_table, target_module, target_module);
    execute format('create policy %I on public.%I for delete to authenticated using (app.can_manage_module(%L, ''backup''))', 'Permissão de backup exclui', target_table, target_module);
  end loop;
end;
$$;

drop policy if exists "Permissão por módulo cria NF-e" on public.nfe_occurrences;
drop policy if exists "Permissão por módulo edita NF-e" on public.nfe_occurrences;
drop policy if exists "Permissão por módulo exclui NF-e" on public.nfe_occurrences;
create policy "Permissão por módulo cria NF-e" on public.nfe_occurrences for insert to authenticated
  with check (app.can_manage_module('nfe', 'create'));
create policy "Permissão por módulo edita NF-e" on public.nfe_occurrences for update to authenticated
  using (app.can_manage_module('nfe', 'update')) with check (app.can_manage_module('nfe', 'update'));
create policy "Permissão por módulo exclui NF-e" on public.nfe_occurrences for delete to authenticated
  using (app.can_manage_module('nfe', 'delete'));

grant execute on function app.can_manage_module(text, text), app.can_manage_module_table(uuid, text, text) to authenticated;
grant execute on function public.equipment_identity_conflicts(), public.operational_dashboard() to authenticated;

commit;
