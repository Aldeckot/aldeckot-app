-- Consultas operacionais seguem a mesma leitura das tabelas corporativas.
-- Escrita, exclusão e backup continuam sujeitos às permissões por operação.
begin;

create or replace function app.can_manage_module_table(p_table_id uuid, p_module text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.module_tables table_row
    where table_row.id = p_table_id
      and table_row.module = lower(trim(p_module))
      and case
        when lower(trim(p_action)) = 'read' then app.has_active_account()
        else app.can_manage_module(p_module, p_action)
      end
  )
$$;

commit;
