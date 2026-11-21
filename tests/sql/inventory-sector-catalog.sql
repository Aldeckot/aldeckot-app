-- Etapa 16: catálogo central, mapeamento sem renomear legado e setor distinto de local.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $test$
declare v_table_id uuid; branch_count bigint;
begin
  if (select count(*) from public.organizational_sectors where active)<>9 then
    raise exception 'O catálogo global deve publicar exatamente os nove setores padronizados.';
  end if;
  select id into v_table_id from public.module_tables where module='inventory' and name='MONITORES' limit 1;
  if v_table_id is null then raise exception 'Tabela fictícia MONITORES ausente.'; end if;
  select count(*) into branch_count from public.inventory_branches b where b.table_id=v_table_id;
  insert into public.inventory_items(table_id,equipment,model,sector,location)
  values(v_table_id,'Monitor fictício setor oficial','Modelo teste','  frente   de loja ','Sala 01');
  if not exists(select 1 from public.inventory_items where table_id=v_table_id
      and equipment='Monitor fictício setor oficial' and sector='  frente   de loja '
      and sector_code='frente-de-loja' and location='Sala 01') then
    raise exception 'O catálogo deve mapear o setor sem substituir o texto existente nem o local.';
  end if;
  insert into public.inventory_items(table_id,equipment,model,sector,location)
  values(v_table_id,'Monitor fictício legado','Modelo teste','Depósito Antigo','Prateleira 2');
  if not exists(select 1 from public.inventory_items where table_id=v_table_id
      and equipment='Monitor fictício legado' and sector='Depósito Antigo' and sector_code is null) then
    raise exception 'Setor legado fora do catálogo deve ser preservado sem classificação inventada.';
  end if;
  if (select count(*) from public.inventory_branches b where b.table_id=v_table_id)<>branch_count then
    raise exception 'Catálogo de setores não pode alterar ramificações e classificações existentes.';
  end if;
  insert into public.module_tables(module,name)
  values('flux','Flux fictício de setores');
  select id into v_table_id from public.module_tables where module='flux' limit 1;
  if v_table_id is null then raise exception 'Tabela fictícia Flux ausente.'; end if;
  insert into public.flux_items(table_id,movement,equipment,model,brand,serial,tag,sender_company,destination_company,sender_responsible,receiver_responsible,send_date,received_date,shipping_type,reason,status,sector_code,location)
  values(v_table_id,'Envio','Roteador fictício setor oficial','Modelo teste','Marca teste','SER-SETOR-109','TAG-SETOR-109','Empresa teste','Unidade teste','Pessoa remetente','Pessoa recebedora',current_date,current_date,'Transporte Interno','Transferência','Recebido','informatica','Rack 03');
  if not exists(select 1 from public.flux_items where tag='TAG-SETOR-109' and sector='Informática' and sector_code='informatica' and location='Rack 03') then
    raise exception 'Flux deve aplicar o setor oficial e manter Local como dado distinto.';
  end if;
  if not exists(select 1 from public.central_equipment_search('TAG-SETOR-109') where metadata->>'sector'='Informática' and location='Rack 03') then
    raise exception 'Busca central deve devolver Setor e Local reais do registro Flux.';
  end if;
end
$test$;
rollback;
