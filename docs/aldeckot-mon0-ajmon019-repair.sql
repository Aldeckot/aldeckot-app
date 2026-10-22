-- Correção pontual autorizada: MON0 -> AJMON019, somente ESTOQUE 01.
-- Não cria nem exclui equipamentos. Mantém o mesmo ID patrimonial.
-- Consolida apenas as quatro entradas exatas informadas pelo usuário.
-- As entradas anteriores ficam arquivadas no evento de correção.
begin;
lock table public.inventory_items, public.module_records, public.module_tables
  in share row exclusive mode;
do $$
declare
  repair_item_id constant uuid := 'c5c96233-c834-4397-81db-341dece769a0';
  repair_position_id constant uuid := 'c4a736eb-96da-4455-8845-bf6304f214d3';
  repair_key constant text := 'identity-repair:mon0-ajmon019-20261022';
  canonical_id constant text := 'inventory-peripheral-c5c96233-c834-4397-81db-341dece769a0';
  before_item public.inventory_items%rowtype;
  before_position public.module_records%rowtype;
  expected_links jsonb; actual_links jsonb; after_links jsonb; filtered_links jsonb;
  link_count integer; position_count integer; linked_position uuid;
  repair_event_id uuid := gen_random_uuid();
begin
  if to_regprocedure('app.inventory_installation_location_key(text)') is null then
    raise exception 'A migração 093 deve estar instalada.';
  end if;
  select * into before_item from public.inventory_items where id=repair_item_id;
  select * into before_position from public.module_records where id=repair_position_id;
  if before_item.id is null or before_position.id is null
    or before_item.tag not in ('MON0','AJMON019')
    or app.inventory_installation_location_key(before_item.location) <> 'estoque 01'
    or app.inventory_installation_location_key(before_position.payload->>'terminal') <> 'estoque 01'
    or not exists(select 1 from public.module_tables t
      where t.id=before_position.table_id and t.module='management') then
    raise exception 'Identidade ou posição do monitor mudou; correção cancelada.';
  end if;
  if exists(select 1 from public.inventory_items i
    where upper(btrim(i.tag))='AJMON019' and i.id<>repair_item_id) then
    raise exception 'AJMON019 já pertence a outro equipamento. Não será sobrescrito.';
  end if;
  select count(*),count(distinct r.id),min(r.id::text)::uuid
    into link_count,position_count,linked_position
    from public.module_records r join public.module_tables t on t.id=r.table_id
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r.payload->'peripherals')='array'
        then r.payload->'peripherals' else '[]'::jsonb end) p
    where t.module='management' and p.value->>'sourceItemId'=repair_item_id::text;
  select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb) into actual_links
    from jsonb_array_elements(before_position.payload->'peripherals')
      with ordinality p(value,ordinality)
    where p.value->>'sourceItemId'=repair_item_id::text;

  if before_item.tag='AJMON019' and link_count=1 and linked_position=repair_position_id
    and actual_links->0->>'type'='Monitor'
    and actual_links->0->>'status'='AJMON019'
    and actual_links->0->>'sourceModule'='inventory' then
    raise notice 'Monitor já corrigido; nenhum vínculo ou histórico duplicado.';
    return;
  end if;
  if before_item.tag <> 'MON0' or link_count<>4 or position_count<>1
    or linked_position<>repair_position_id then
    raise exception 'Não são mais as quatro associações auditadas de MON0 no ESTOQUE 01.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id',e.entry_id,'type','Monitor','status','MON0',
    'sourceItemId',repair_item_id::text,'sourceModule','inventory') order by e.n)
    into expected_links
    from (values
      (1,'inventory-peripheral-c5c96233-c834-4397-81db-341dece769a0-monitor'),
      (2,'inventory-peripheral-c2b17e61-771c-47f9-9fa2-e54a0040ce03'),
      (3,'inventory-peripheral-96eef490-d29a-4df1-81be-5242db9fc71b'),
      (4,'inventory-peripheral-c5c96233-c834-4397-81db-341dece769a0')
    ) e(n,entry_id);
  if actual_links is distinct from expected_links then
    raise exception 'O conteúdo das entradas mudou desde a auditoria; nada será descartado.';
  end if;
  if exists(select 1 from public.equipment_events
    where source_module='inventory' and source_event_key=repair_key) then
    raise exception 'Já existe evento desta correção, mas o estado diverge. Revisão necessária.';
  end if;

  select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
    into filtered_links from jsonb_array_elements(before_position.payload->'peripherals')
      with ordinality p(value,ordinality)
    where p.value->>'sourceItemId' is distinct from repair_item_id::text
      or p.value->>'id'=canonical_id;
  update public.module_records
    set payload=jsonb_set(payload,'{peripherals}',filtered_links)
    where id=repair_position_id;
  -- Agora há um único vínculo; os gatilhos existentes propagam a TAG pelo ID.
  update public.inventory_items set tag='AJMON019' where id=repair_item_id;

  select r.payload->'peripherals' into after_links from public.module_records r
    where r.id=repair_position_id;
  if (select count(*) from public.module_records r join public.module_tables t on t.id=r.table_id,
      lateral jsonb_array_elements(coalesce(r.payload->'peripherals','[]'::jsonb)) p
      where t.module='management' and p.value->>'sourceItemId'=repair_item_id::text) <> 1
    or not exists(select 1 from jsonb_array_elements(after_links) p
      where p.value->>'id'=canonical_id and p.value->>'sourceItemId'=repair_item_id::text
        and p.value->>'type'='Monitor' and p.value->>'status'='AJMON019'
        and p.value->>'sourceModule'='inventory') then
    raise exception 'Não foi possível confirmar uma única associação AJMON019.';
  end if;
  if (select to_jsonb(i)-'tag'-'updated_at' from public.inventory_items i where id=repair_item_id)
      is distinct from (to_jsonb(before_item)-'tag'-'updated_at')
    or (select r.payload-'peripherals' from public.module_records r where id=repair_position_id)
      is distinct from (before_position.payload-'peripherals') then
    raise exception 'A operação alteraria outros dados do equipamento ou computador.';
  end if;
  if (select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
      from jsonb_array_elements(after_links) with ordinality p(value,ordinality)
      where p.value->>'sourceItemId' is distinct from repair_item_id::text)
    is distinct from (select coalesce(jsonb_agg(p.value order by p.ordinality),'[]'::jsonb)
      from jsonb_array_elements(before_position.payload->'peripherals') with ordinality p(value,ordinality)
      where p.value->>'sourceItemId' is distinct from repair_item_id::text) then
    raise exception 'A correção alteraria outro periférico.';
  end if;

  insert into public.equipment_events(
    id,source_module,source_event_key,source_id,inventory_item_id,action,
    previous_status,new_status,previous_location,new_location,reason,
    affected_modules,processing_result,metadata,actor_id)
  values(repair_event_id,'inventory',repair_key,repair_item_id,repair_item_id,
    'peripheral-identity-repair',before_item.status,before_item.status,
    before_item.location,before_item.location,
    'Correção autorizada: consolidar quatro referências ao mesmo monitor e atualizar MON0 para AJMON019.',
    '["inventory","management"]'::jsonb,'{"status":"applied"}'::jsonb,
    jsonb_build_object('positionIds',jsonb_build_array(repair_position_id),
      'previousTag','MON0','newTag','AJMON019','physicalMovement',false,
      'previousPeripherals',before_position.payload->'peripherals','newPeripherals',after_links),
    auth.uid());
  insert into public.equipment_event_effects(event_id,module,status,attempts,processed_at)
    values(repair_event_id,'inventory','applied',1,now()),
      (repair_event_id,'management','applied',1,now());
  insert into public.inventory_item_logs(inventory_item_id,action,message,event_id)
  values(repair_item_id,'update',
    'Correção cadastral autorizada: MON0 → AJMON019. Quatro referências duplicadas consolidadas em uma no ESTOQUE 01; cópia anterior preservada no evento. Mesmo equipamento, série, status e local; sem movimentação física.',
    repair_event_id);
end;
$$;
commit;
