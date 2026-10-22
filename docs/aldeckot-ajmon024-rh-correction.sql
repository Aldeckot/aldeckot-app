-- CORREÇÃO CADASTRAL AUTORIZADA | AJMON024: AUDITÓRIO -> RH.
-- Usar após 093. Não é migração de estrutura. Não reaplicar 089–093.
-- Não modifica PCs, status, TAG, série ou outros periféricos.
-- Confere o estado auditado em 22/10/2026; divergência cancela tudo.
begin;
lock table public.inventory_items, public.module_records, public.module_tables
  in share row exclusive mode;
do $$
declare
  item_id constant uuid := '10947087-ef80-48e2-9474-1359e5cce8a5';
  source_id constant uuid := '29c59e81-30a8-4a58-b46c-94b2f90c8cac';
  target_id constant uuid := '5bce380d-ff6a-494d-845d-52fae0dc7417';
  item_before public.inventory_items%rowtype;
  source_before public.module_records%rowtype;
  target_before public.module_records%rowtype;
  link_count integer; linked_id uuid; n integer; current_value jsonb;
begin
  if to_regprocedure('app.inventory_installation_location_key(text)') is null then
    raise exception 'A migração 093 deve estar instalada antes desta correção.';
  end if;
  select * into item_before from public.inventory_items where id=item_id;
  select count(*) into n from public.inventory_items where upper(btrim(tag))='AJMON024';
  if item_before.id is null or item_before.tag <> 'AJMON024' or n <> 1 then
    raise exception 'Identidade do monitor AJMON024 divergente. Nada foi alterado.';
  end if;
  select * into source_before from public.module_records where id=source_id;
  select * into target_before from public.module_records where id=target_id;
  if source_before.id is null or target_before.id is null
    or source_before.payload->>'terminal' is distinct from 'AUDITÓRIO'
    or target_before.payload->>'terminal' is distinct from 'RH'
    or target_before.payload->>'equipment' is distinct from 'AJ RH'
    or target_before.payload->>'tag' is distinct from 'AJPCRH01'
    or not exists(select 1 from public.module_tables where id=source_before.table_id and module='management')
    or not exists(select 1 from public.module_tables where id=target_before.table_id and module='management') then
    raise exception 'Os terminais ou o PC do RH mudaram desde a auditoria.';
  end if;
  select count(*),min(r.id::text)::uuid into link_count,linked_id
    from public.module_records r join public.module_tables t on t.id=r.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.payload->'peripherals')='array'
        then r.payload->'peripherals' else '[]'::jsonb end) p
    where t.module='management' and p.value->>'sourceItemId'=item_id::text;
  if link_count <> 1 then
    raise exception 'AJMON024 sem vínculo único; correção cancelada.';
  end if;
  select p.value into current_value from public.module_records r
    cross join lateral jsonb_array_elements(r.payload->'peripherals') p
    where r.id=linked_id and p.value->>'sourceItemId'=item_id::text;
  if current_value->>'sourceModule' is distinct from 'inventory'
    or current_value->>'type' is distinct from 'Monitor'
    or current_value->>'status' is distinct from 'AJMON024' then
    raise exception 'O vínculo atual do monitor diverge da auditoria.';
  end if;
  if linked_id=target_id and item_before.location='RH' then
    raise notice 'AJMON024 já está associado ao RH. Nenhum log duplicado.';
    return;
  end if;
  if linked_id<>source_id or item_before.location is distinct from 'AUDITÓRIO'
    or item_before.status is distinct from 'Ativo' then
    raise exception 'Local, status ou vínculo mudou desde a auditoria; nenhuma alteração aplicada.';
  end if;
  if exists(select 1 from jsonb_array_elements(
      coalesce(target_before.payload->'peripherals','[]'::jsonb)) p
    where lower(btrim(coalesce(p.value->>'type',p.value->>'tipo','')))='monitor') then
    raise exception 'O RH já possui entrada de monitor; não será sobrescrita.';
  end if;

  -- Os gatilhos existentes retiram apenas este ID do AUDITÓRIO e o associam ao RH.
  update public.inventory_items set location='RH' where id=item_id;
  select count(*),min(r.id::text)::uuid into link_count,linked_id
    from public.module_records r join public.module_tables t on t.id=r.table_id
    cross join lateral jsonb_array_elements(coalesce(r.payload->'peripherals','[]'::jsonb)) p
    where t.module='management' and p.value->>'sourceItemId'=item_id::text;
  if link_count<>1 or linked_id<>target_id then
    raise exception 'Não foi possível confirmar a associação exclusiva ao RH.';
  end if;
  if (select to_jsonb(i)-'location'-'updated_at' from public.inventory_items i where id=item_id)
    is distinct from (to_jsonb(item_before)-'location'-'updated_at') then
    raise exception 'A correção alteraria outros dados do monitor; operação cancelada.';
  end if;
  if (select r.payload-'peripherals'-'lastActivity' from public.module_records r where id=source_id)
      is distinct from (source_before.payload-'peripherals'-'lastActivity')
    or (select r.payload-'peripherals'-'lastActivity' from public.module_records r where id=target_id)
      is distinct from (target_before.payload-'peripherals'-'lastActivity') then
    raise exception 'A correção alteraria dados de computador/terminal; operação cancelada.';
  end if;
  if (select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
      from public.module_records r,
      lateral jsonb_array_elements(r.payload->'peripherals') with ordinality p(value,ordinality)
      where r.id=source_id)
    is distinct from (select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
      from jsonb_array_elements(source_before.payload->'peripherals') with ordinality p(value,ordinality)
      where p.value->>'sourceItemId' is distinct from item_id::text)
    or (select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
      from public.module_records r,
      lateral jsonb_array_elements(r.payload->'peripherals') with ordinality p(value,ordinality)
      where r.id=target_id and p.value->>'sourceItemId' is distinct from item_id::text)
    is distinct from coalesce(target_before.payload->'peripherals','[]'::jsonb) then
    raise exception 'A correção alteraria outro periférico; operação cancelada.';
  end if;
  insert into public.inventory_item_logs(inventory_item_id,action,message)
  values(item_id,'update',
    'Correção cadastral autorizada pela relação de monitores: AJMON024, local AUDITÓRIO → RH (PC AJ RH, TAG AJPCRH01). Status Ativo e demais dados preservados. Não representa deslocamento físico retroativo. Referência: conciliacao-ajmon024-rh-20261022.');
end;
$$;
commit;
