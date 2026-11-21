-- Etapa 15: equipamento reserva de outro setor assume setor/local atendidos.
-- Dados fictícios e transação integralmente revertida.
begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

create function app.test_fail_replacement_install() returns trigger language plpgsql as $$
begin
  if new.id='00000000-0000-4000-8000-000000000104'::uuid then
    raise exception 'falha simulada na instalação';
  end if;
  return new;
end $$;
create trigger test_fail_replacement_install before update of location,sector
  on public.inventory_items for each row execute function app.test_fail_replacement_install();

do $test$
declare table_id uuid; result_id uuid; failed boolean:=false;
  removed_id uuid:='00000000-0000-4000-8000-000000000101';
  installed_id uuid:='00000000-0000-4000-8000-000000000102';
  removed_fail_id uuid:='00000000-0000-4000-8000-000000000103';
  installed_fail_id uuid:='00000000-0000-4000-8000-000000000104';
begin
  select id into table_id from public.module_tables where module='inventory' and name='MONITORES' limit 1;
  if table_id is null then raise exception 'Tabela de Inventário fictícia ausente.'; end if;
  insert into public.inventory_items(id,table_id,equipment,model,serial,tag,sector,location,status)
  values
    (removed_id,table_id,'Impressora Frente de Loja','Laser 1','SER-101','PRN-101','Frente de Loja','Guichê 1','Ativo'),
    (installed_id,table_id,'Impressora Escritório','Laser 2','SER-102','PRN-102','Escritório','Armário 2','Reserva'),
    (removed_fail_id,table_id,'Impressora retirada teste','Laser 1','SER-103','PRN-103','Frente de Loja','Guichê 2','Ativo'),
    (installed_fail_id,table_id,'Impressora reserva teste','Laser 2','SER-104','PRN-104','Escritório','Armário 3','Reserva');

  result_id:=public.inventory_replace_equipment(removed_id,installed_id,'Defeito','Oficina','Falha de impressão recorrente');
  if not exists(select 1 from public.inventory_items where id=removed_id and status='Defeito'
      and location='Oficina' and sector='Frente de Loja')
    or not exists(select 1 from public.inventory_items where id=installed_id and status='Ativo'
      and location='Guichê 1' and sector='Frente de Loja')
    or not exists(select 1 from public.inventory_replacements where id=result_id
      and removed_identity=removed_id and installed_identity=installed_id
      and removed_sector='Frente de Loja' and installed_previous_sector='Escritório'
      and installed_sector='Frente de Loja')
    or (select count(*) from public.inventory_item_logs where inventory_item_id in (removed_id,installed_id))<>2 then
    raise exception 'Substituição entre setores não transferiu o ativo nem preservou identidade/auditoria.';
  end if;

  begin
    perform public.inventory_replace_equipment(removed_fail_id,installed_fail_id,'Inativo','Descarte','Equipamento sem reparo');
  exception when others then
    if sqlerrm like 'falha simulada na instalação%' then failed:=true; else raise; end if;
  end;
  if not failed
    or not exists(select 1 from public.inventory_items where id=removed_fail_id
      and status='Ativo' and location='Guichê 2' and sector='Frente de Loja')
    or not exists(select 1 from public.inventory_items where id=installed_fail_id
      and status='Reserva' and location='Armário 3' and sector='Escritório')
    or exists(select 1 from public.inventory_replacements where removed_identity=removed_fail_id)
    or (select count(*) from public.inventory_item_logs where inventory_item_id in (removed_fail_id,installed_fail_id))<>0 then
    raise exception 'Falha na segunda unidade não reverteu toda a substituição.';
  end if;
end
$test$;
rollback;
