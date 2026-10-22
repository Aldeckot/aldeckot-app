-- SOMENTE LEITURA: comparação completa com a relação fornecida em 22/10/2026.
-- Funciona após 092, antes ou depois da 093. Não cria PCs ou altera vínculos.
with expected as (
  select 'AJMON' || lpad(n::text,3,'0') as tag,
    'PDV ' || lpad(n::text,2,'0') as destination, 'posição física'::text as rule
  from generate_series(1,14) n
  union all select * from (values
    ('AJMON015','Matriz','sem associação'),
    ('AJMON016','Matriz','sem associação'),
    ('AJMON017','AJPCINFO01','PC não identificado na auditoria anterior'),
    ('AJMON018','AJPCINFO02','PC não identificado na auditoria anterior'),
    ('AJMON019','ESTOQUE 01','posição física'),
    ('AJMON020','ESTOQUE 02','posição física'),
    ('AJMON021','ESTOQUE 03','posição física'),
    ('AJMON022','TESOURARIA','confirmar TESOURARIA 01 ou 02'),
    ('AJMON023','TESOURARIA 02','PC CONFERÊNCIA'),
    ('AJMON024','RH','PC AJ RH'),
    ('AJMON025','CFTV','posição física'),
    ('AJMON026','Sala CPD','sem associação')
  ) x(tag,destination,rule)
), positions as (
  select r.id, r.payload, r.payload->>'terminal' as terminal,
    r.payload->>'equipment' as computer, r.payload->>'tag' as computer_tag
  from public.module_records r join public.module_tables t on t.id=r.table_id
  where t.module='management'
), links as (
  select p.id as position_id,p.terminal,p.computer,p.computer_tag,value as peripheral
  from positions p cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.payload->'peripherals')='array'
      then p.payload->'peripherals' else '[]'::jsonb end)
), compared as (
  select e.*,
    (select count(*) from public.inventory_items i
      where upper(btrim(i.tag))=e.tag) as inventory_count,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'tag',i.tag,'location',i.location,'status',i.status,
      'linked_positions',(select coalesce(jsonb_agg(jsonb_build_object(
        'position_id',l.position_id,'terminal',l.terminal,'computer',l.computer,
        'computer_tag',l.computer_tag,'source_module',l.peripheral->>'sourceModule')),
        '[]'::jsonb) from links l where l.peripheral->>'sourceItemId'=i.id::text)
    ) order by i.id),'[]'::jsonb)
      from public.inventory_items i where upper(btrim(i.tag))=e.tag) as inventory,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'terminal',p.terminal,'computer',p.computer,'computer_tag',p.computer_tag)
      order by p.id),'[]'::jsonb)
      from positions p where e.rule<>'sem associação' and (
        regexp_replace(lower(coalesce(p.terminal,'')),'[[:space:]]+','','g')=
          regexp_replace(lower(e.destination),'[[:space:]]+','','g')
        or regexp_replace(lower(coalesce(p.computer,'')),'[[:space:]]+','','g')=
          regexp_replace(lower(e.destination),'[[:space:]]+','','g')
        or regexp_replace(lower(coalesce(p.computer_tag,'')),'[[:space:]]+','','g')=
          regexp_replace(lower(e.destination),'[[:space:]]+','','g')
      )) as destination_candidates
  from expected e
), unassigned_conflicts as (
  select i.id,i.tag,i.location,l.position_id,l.terminal
  from public.inventory_items i join links l on l.peripheral->>'sourceItemId'=i.id::text
    or (nullif(btrim(coalesce(l.peripheral->>'sourceItemId','')),'') is null
      and coalesce(l.peripheral->>'sourceModule','inventory')='inventory'
      and nullif(btrim(i.tag),'') is not null
      and upper(btrim(coalesce(nullif(btrim(l.peripheral->>'tag'),''),l.peripheral->>'status','')))=upper(btrim(i.tag)))
  where lower(regexp_replace(btrim(coalesce(i.location,'')),'[[:space:]]+',' ','g'))
    in ('sala cpd','matriz')
)
select jsonb_build_object(
  'checked_at',now(),
  'cpd_matriz_rule_active',app.inventory_location_is_unassigned('Matriz')
    and app.inventory_location_is_unassigned('Sala CPD'),
  'location_key_function_installed',to_regprocedure('app.inventory_installation_location_key(text)') is not null,
  'unassigned_conflicts',(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from unassigned_conflicts c),
  'monitors',(select jsonb_agg(to_jsonb(c) order by tag) from compared c)
) as monitor_relation_report;
