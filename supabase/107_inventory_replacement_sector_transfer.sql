-- ALDECKOT | Etapa 15: transferência de setor e trilha ao substituir no Inventário.
-- A operação continua restrita à mesma tabela, IDs físicos nunca são copiados.
begin;

do $preflight$
begin
  if to_regprocedure('public.inventory_replace_equipment(uuid,uuid,text,text,text)') is null
    or to_regclass('public.inventory_replacements') is null
    or to_regclass('public.equipment_events') is null then
    raise exception 'As migrações 060, 061 e 090 devem estar aplicadas antes da 107.';
  end if;
end;
$preflight$;

alter table public.inventory_replacements
  add column if not exists removed_sector text not null default '',
  add column if not exists installed_previous_sector text not null default '',
  add column if not exists installed_sector text not null default '';

create or replace function public.inventory_replace_equipment(
  p_removed_item_id uuid, p_installed_item_id uuid, p_removed_status text,
  p_removed_location text, p_reason text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  outgoing public.inventory_items%rowtype;
  incoming public.inventory_items%rowtype;
  result_id uuid := gen_random_uuid();
  outgoing_label text;
  incoming_label text;
begin
  if p_removed_item_id is null or p_installed_item_id is null
    or p_removed_item_id=p_installed_item_id then
    raise exception 'Selecione dois equipamentos físicos diferentes.';
  end if;
  if p_removed_status is null or p_removed_status not in ('Manutenção','Defeito','Inativo')
    or nullif(btrim(coalesce(p_removed_location,'')),'') is null
    or nullif(btrim(coalesce(p_reason,'')),'') is null
    or char_length(btrim(p_reason))>500 then
    raise exception 'Informe destino, condição final e motivo da substituição.';
  end if;
  -- Mesma ordem de bloqueio em toda chamada reduz deadlocks entre trocas concorrentes.
  perform 1 from public.inventory_items
    where id in (p_removed_item_id,p_installed_item_id) order by id for update;
  select * into outgoing from public.inventory_items where id=p_removed_item_id;
  select * into incoming from public.inventory_items where id=p_installed_item_id;
  if outgoing.id is null or incoming.id is null then raise exception 'Equipamento não encontrado.'; end if;
  if not coalesce(app.can_manage_module_table(outgoing.table_id,'inventory','update'),false)
    or not coalesce(app.can_manage_module_table(incoming.table_id,'inventory','update'),false) then
    raise exception 'Sem permissão para substituir equipamentos do Inventário.';
  end if;
  if outgoing.table_id<>incoming.table_id then
    raise exception 'A substituição exige equipamentos da mesma tabela do Inventário.';
  end if;
  if outgoing.status<>'Ativo' or incoming.status<>'Reserva' then
    raise exception 'O equipamento retirado deve estar Ativo e o substituto em Reserva.';
  end if;
  if nullif(btrim(outgoing.location),'') is null then
    raise exception 'O equipamento retirado precisa ter um local físico.';
  end if;
  outgoing_label:=coalesce(nullif(btrim(outgoing.tag),''),nullif(btrim(outgoing.serial),''),outgoing.equipment);
  incoming_label:=coalesce(nullif(btrim(incoming.tag),''),nullif(btrim(incoming.serial),''),incoming.equipment);

  perform set_config('app.inventory_pdv_operation_id',result_id::text,true);
  perform set_config('app.inventory_pdv_movement_reason',btrim(p_reason),true);
  update public.inventory_items
    set status=p_removed_status,location=btrim(p_removed_location)
    where id=outgoing.id;
  -- O equipamento substituto assume setor e local do ativo atendido. A ramificação
  -- continua vinculada aos IDs originais; não clonamos identidade nem vínculos.
  update public.inventory_items
    set status='Ativo',location=outgoing.location,sector=outgoing.sector
    where id=incoming.id;
  perform set_config('app.inventory_pdv_operation_id','',true);
  perform set_config('app.inventory_pdv_movement_reason','',true);

  insert into public.inventory_replacements
    (id,removed_item_id,installed_item_id,removed_identity,installed_identity,
     removed_tag,installed_tag,previous_location,removed_location,removed_status,
     reason,actor_id,removed_sector,installed_previous_sector,installed_sector)
  values(result_id,outgoing.id,incoming.id,outgoing.id,incoming.id,
    outgoing_label,incoming_label,outgoing.location,btrim(p_removed_location),p_removed_status,
    btrim(p_reason),auth.uid(),coalesce(outgoing.sector,''),coalesce(incoming.sector,''),coalesce(outgoing.sector,''));

  insert into public.inventory_item_logs(inventory_item_id,action,message,event_id) values
    (outgoing.id,'update',left(format('%s saiu do setor %s e do local %s; condição: %s; destino: %s; substituída por %s. Motivo: %s',
      outgoing_label,coalesce(nullif(outgoing.sector,''),'não informado'),outgoing.location,
      p_removed_status,btrim(p_removed_location),incoming_label,btrim(p_reason)),500),
      (select id from public.equipment_events where source_module='inventory'
        and action='peripheral-transfer' and inventory_item_id=outgoing.id
        and metadata->>'operationId'=result_id::text)),
    (incoming.id,'update',left(format('%s instalada no setor %s e local %s (antes: setor %s, local %s), em substituição a %s. Motivo: %s',
      incoming_label,coalesce(nullif(outgoing.sector,''),'não informado'),outgoing.location,
      coalesce(nullif(incoming.sector,''),'não informado'),coalesce(nullif(incoming.location,''),'não informado'),
      outgoing_label,btrim(p_reason)),500),
      (select id from public.equipment_events where source_module='inventory'
        and action='peripheral-transfer' and inventory_item_id=incoming.id
        and metadata->>'operationId'=result_id::text));
  return result_id;
end;
$$;
revoke all on function public.inventory_replace_equipment(uuid,uuid,text,text,text) from public;
grant execute on function public.inventory_replace_equipment(uuid,uuid,text,text,text) to authenticated;
comment on function public.inventory_replace_equipment(uuid,uuid,text,text,text) is
  'Troca atômica dentro da mesma tabela; substituto assume setor/local do equipamento retirado, mantém identidade e registra setores anteriores.';
commit;
