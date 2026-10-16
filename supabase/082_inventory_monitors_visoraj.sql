-- Permite Modelo vazio no Inventário e cadastra VISORAJ com TAGs MON001-MON033.
-- Execute após a 081. Não modifica equipamentos nem TAGs já existentes.
begin;

do $$
declare
  v_table_id uuid;
  v_table_count integer;
  v_added integer;
begin
  select count(*), (array_agg(id))[1] into v_table_count, v_table_id
    from public.module_tables
    where module = 'inventory'
      and regexp_replace(lower(name), '[[:space:]]+', '', 'g')
        in ('monitores', 'monitores🖥️');
  if v_table_count <> 1 then
    raise exception 'Esperada uma única tabela MONITORES no Inventário; encontradas: %', v_table_count;
  end if;

  alter table public.inventory_items
    drop constraint if exists inventory_items_model_check;
  alter table public.inventory_items
    add constraint inventory_items_model_check
    check (char_length(btrim(model)) <= 160);

  with candidates as (
    select 'MON' || lpad(number::text, 3, '0') as tag
      from generate_series(1, 33) as number
  ), inserted as (
    insert into public.inventory_items (table_id, equipment, model, tag)
    select v_table_id, 'VISORAJ', '', candidate.tag
      from candidates candidate
      where not exists (
        select 1 from public.inventory_items item
          where lower(btrim(item.tag)) = lower(candidate.tag)
      )
    on conflict do nothing
    returning id
  )
  insert into public.inventory_item_logs (inventory_item_id, action, message)
    select id, 'create', 'Equipamento VISORAJ cadastrado na tabela MONITORES (migração 082).'
      from inserted;
  get diagnostics v_added = row_count;
  raise notice 'VISORAJ: % equipamento(s) novo(s) cadastrado(s); TAGs existentes preservadas.', v_added;
end $$;

commit;
