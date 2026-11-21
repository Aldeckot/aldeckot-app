-- ALDECKOT | Etapa 08: componentes rastreáveis e manutenção externa.
-- Vínculos não duplicam itens. Mudanças explícitas usam os RPCs oficiais de estoque.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.inventory_items') is null
    or to_regclass('public.supply_units') is null
    or to_regprocedure('app.can_manage_module_table(uuid,text,text)') is null then
    raise exception 'As migrações 058 e 095–100 devem estar aplicadas antes da 101.';
  end if;
end;
$preflight$;

create table public.control_case_components (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  request_id uuid not null unique,
  inventory_item_id uuid references public.inventory_items(id) on delete restrict,
  supply_unit_id uuid references public.supply_units(id) on delete restrict,
  component_name text not null check (char_length(btrim(component_name)) between 1 and 160),
  brand text not null default '' check (char_length(brand)<=160),
  model text not null default '' check (char_length(model)<=160),
  tag text not null default '' check (char_length(tag)<=100),
  serial text not null default '' check (char_length(serial)<=160),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  check (num_nonnulls(inventory_item_id,supply_unit_id)<=1)
);
create unique index control_case_components_inventory_uq
  on public.control_case_components(case_id,inventory_item_id) where inventory_item_id is not null;
create unique index control_case_components_supply_uq
  on public.control_case_components(case_id,supply_unit_id) where supply_unit_id is not null;
create index control_case_components_case_idx on public.control_case_components(case_id,recorded_at,id);

create table public.control_case_component_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  component_id uuid not null references public.control_case_components(id) on delete restrict,
  request_id uuid not null unique,
  action text not null check (action in (
    'Inspecionado','Testado','Removido','Instalado','Substituído',
    'Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor')),
  occurred_at timestamptz not null,
  result text not null check (char_length(btrim(result)) between 3 and 2000),
  notes text not null default '' check (char_length(notes)<=2000),
  supplier text not null default '' check (char_length(supplier)<=200),
  reason text not null default '' check (char_length(reason)<=1000),
  protocol text not null default '' check (char_length(protocol)<=200),
  expected_return_at timestamptz,
  service_status text not null default '' check (service_status in (
    '','Enviado','Em análise','Aguardando orçamento','Em execução','Concluído','Retornado')),
  replacement_supply_unit_id uuid references public.supply_units(id) on delete restrict,
  stock_destination text not null default '' check (stock_destination in (
    '','Em estoque','Reserva','Defeito','Inativo')),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  check (expected_return_at is null or action='Enviado ao fornecedor'),
  check (action not in ('Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor')
    or (supplier<>'' and reason<>'')),
  check (action<>'Enviado ao fornecedor' or
    (service_status='Enviado' and expected_return_at is not null)),
  check (action<>'Retornado do fornecedor' or service_status='Retornado')
);
create index control_case_component_events_timeline_idx
  on public.control_case_component_events(case_id,occurred_at,id);
alter table public.control_case_components enable row level security;
alter table public.control_case_component_events enable row level security;
revoke all on public.control_case_components,public.control_case_component_events from public,anon,authenticated;
grant select on public.control_case_components,public.control_case_component_events to authenticated;
create policy "Contas ativas consultam componentes do chamado"
  on public.control_case_components for select to authenticated using (app.has_active_account());
create policy "Contas ativas consultam eventos de componentes"
  on public.control_case_component_events for select to authenticated using (app.has_active_account());

create function public.append_control_case_component_event(
  p_case_id uuid,p_component jsonb,p_event jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare
  c public.control_cases%rowtype;
  component public.control_case_components%rowtype;
  prior public.control_case_component_events%rowtype;
  item public.inventory_items%rowtype;
  unit public.supply_units%rowtype;
  supply public.supplies%rowtype;
  component_request uuid;
  linked_inventory_item_id uuid;
  linked_supply_unit_id uuid;
  component_name text;
  brand_name text;
  model_name text;
  tag_value text;
  serial_value text;
  action_name text;
  event_time timestamptz;
  outcome text;
  remarks text;
  supplier_name text;
  service_reason text;
  protocol_value text;
  expected_at timestamptz;
  service_state text;
  replacement_unit_id uuid;
  old_stock_destination text;
  target_inventory_id uuid;
  target_management_id uuid;
  replacement_unit public.supply_units%rowtype;
  replacement_supply public.supplies%rowtype;
  replacement_component_id uuid;
  payload jsonb;
  new_component_id uuid;
  new_event_id uuid;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or jsonb_typeof(p_component) is distinct from 'object'
    or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'Sessão, chamado e dados válidos são necessários.';
  end if;
  select * into c from public.control_cases where id=p_case_id for update;
  if not found or c.table_id is null
    or not coalesce(app.can_manage_module_table(c.table_id,'control','update'),false) then
    raise exception 'Sem permissão para registrar componente neste chamado.';
  end if;
  if c.ticket_state in ('Concluído','Cancelado') then
    raise exception 'Chamado encerrado não aceita novos registros de componente.';
  end if;

  component_request:=nullif(p_component->>'requestId','')::uuid;
  linked_inventory_item_id:=nullif(p_component->>'inventoryItemId','')::uuid;
  linked_supply_unit_id:=nullif(p_component->>'supplyUnitId','')::uuid;
  component_name:=btrim(coalesce(p_component->>'name',''));
  brand_name:=btrim(coalesce(p_component->>'brand',''));
  model_name:=btrim(coalesce(p_component->>'model',''));
  tag_value:=btrim(coalesce(p_component->>'tag',''));
  serial_value:=btrim(coalesce(p_component->>'serial',''));
  if component_request is null then
    raise exception 'Identificador do registro de componente necessário.';
  end if;
  select * into component from public.control_case_components where request_id=component_request;
  if found then
    if component.case_id<>p_case_id
      or component.inventory_item_id is distinct from linked_inventory_item_id
      or component.supply_unit_id is distinct from linked_supply_unit_id then
      raise exception 'Identificador do componente já usado com outra origem.';
    end if;
  else
    if num_nonnulls(linked_inventory_item_id,linked_supply_unit_id)>1 then
      raise exception 'Vincule somente um item existente por componente.';
    end if;
    if linked_inventory_item_id is not null then
      select * into item from public.inventory_items where id=linked_inventory_item_id;
      if not found or not coalesce(app.can_manage_module_table(item.table_id,'inventory','read'),false) then
        raise exception 'Item do Inventário inexistente ou sem acesso.';
      end if;
      component_name:=item.equipment; brand_name:=item.brand; model_name:=item.model;
      tag_value:=item.tag; serial_value:=item.serial;
    elsif linked_supply_unit_id is not null then
      select * into unit from public.supply_units where id=linked_supply_unit_id;
      if not found then raise exception 'Unidade de Suprimentos inexistente ou sem acesso.'; end if;
      select * into supply from public.supplies where id=unit.supply_id;
      if not found or supply.owner_id<>auth.uid() then
        raise exception 'Unidade de Suprimentos inexistente ou sem acesso.';
      end if;
      component_name:=supply.name; brand_name:=supply.brand; model_name:=supply.model;
      tag_value:=unit.code; serial_value:=unit.serial_number;
    end if;
    if char_length(component_name) not between 1 and 160 then
      raise exception 'Informe o nome ou selecione um item existente.';
    end if;
    insert into public.control_case_components(case_id,request_id,inventory_item_id,
      supply_unit_id,component_name,brand,model,tag,serial,recorded_by)
    values(p_case_id,component_request,linked_inventory_item_id,linked_supply_unit_id,component_name,
      brand_name,model_name,tag_value,serial_value,auth.uid())
    on conflict do nothing returning id into new_component_id;
    if new_component_id is null then
      select * into component from public.control_case_components x
        where (linked_inventory_item_id is not null and x.case_id=p_case_id
            and x.inventory_item_id=linked_inventory_item_id)
          or (linked_supply_unit_id is not null and x.case_id=p_case_id
            and x.supply_unit_id=linked_supply_unit_id)
          or x.request_id=component_request limit 1;
      if not found then raise exception 'Componente duplicado neste chamado.'; end if;
    else
      select * into component from public.control_case_components where id=new_component_id;
    end if;
  end if;
  action_name:=btrim(coalesce(p_event->>'action',''));
  event_time:=nullif(p_event->>'occurredAt','')::timestamptz;
  outcome:=btrim(coalesce(p_event->>'result',''));
  remarks:=btrim(coalesce(p_event->>'notes',''));
  supplier_name:=btrim(coalesce(p_event->>'supplier',''));
  service_reason:=btrim(coalesce(p_event->>'reason',''));
  protocol_value:=btrim(coalesce(p_event->>'protocol',''));
  expected_at:=nullif(p_event->>'expectedReturnAt','')::timestamptz;
  service_state:=btrim(coalesce(p_event->>'serviceStatus',''));
  replacement_unit_id:=nullif(p_event->>'replacementSupplyUnitId','')::uuid;
  old_stock_destination:=btrim(coalesce(p_event->>'stockDestination',''));
  if event_time is null or event_time>now()+interval '5 minutes'
    or action_name not in ('Inspecionado','Testado','Removido','Instalado','Substituído',
      'Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor')
    or char_length(outcome) not between 3 and 2000
    or char_length(remarks)>2000 or char_length(supplier_name)>200
    or char_length(service_reason)>1000 or char_length(protocol_value)>200
    or (expected_at is not null and action_name<>'Enviado ao fornecedor')
    or (action_name in ('Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor')
      and (supplier_name='' or service_reason=''))
    or (action_name='Enviado ao fornecedor'
      and (service_state<>'Enviado' or expected_at is null))
    or (action_name='Acompanhamento externo' and service_state not in
      ('Em análise','Aguardando orçamento','Em execução','Concluído'))
    or (action_name='Retornado do fornecedor' and service_state<>'Retornado') then
    raise exception 'Dados, resultado ou acompanhamento externo inválidos.';
  end if;
  if action_name in ('Removido','Instalado','Substituído')
    and linked_supply_unit_id is not null and service_reason='' then
    raise exception 'Informe o motivo para movimentar a unidade rastreável.';
  end if;
  if action_name='Removido' and linked_supply_unit_id is not null
    and old_stock_destination not in ('Em estoque','Reserva','Defeito','Inativo') then
    raise exception 'Escolha o destino da unidade removida.';
  end if;
  if action_name='Substituído' and linked_supply_unit_id is not null
    and (replacement_unit_id is null or replacement_unit_id=linked_supply_unit_id
      or old_stock_destination not in ('Em estoque','Reserva','Defeito','Inativo')) then
    raise exception 'Selecione a nova unidade e o destino da unidade substituída.';
  end if;
  if action_name<>'Substituído' and replacement_unit_id is not null then
    raise exception 'Unidade substituta só é aceita em uma substituição.';
  end if;
  if action_name not in ('Removido','Substituído') and old_stock_destination<>'' then
    raise exception 'Destino de estoque não aplicável a esta ação.';
  end if;
  payload:=jsonb_build_object('action',action_name,'occurredAt',event_time,'result',outcome,
    'notes',remarks,'supplier',supplier_name,'reason',service_reason,'protocol',protocol_value,
    'expectedReturnAt',expected_at,'serviceStatus',service_state,
    'replacementSupplyUnitId',replacement_unit_id,'stockDestination',old_stock_destination);
  select * into prior from public.control_case_component_events where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.component_id<>component.id
      or jsonb_build_object('action',prior.action,'occurredAt',prior.occurred_at,
        'result',prior.result,'notes',prior.notes,'supplier',prior.supplier,
        'reason',prior.reason,'protocol',prior.protocol,'expectedReturnAt',prior.expected_return_at,
        'serviceStatus',prior.service_status,
        'replacementSupplyUnitId',prior.replacement_supply_unit_id,
        'stockDestination',prior.stock_destination)<>payload then
      raise exception 'Identificador da operação já usado com outros dados.';
    end if;
    return jsonb_build_object('componentId',component.id,'eventId',prior.id,'alreadyApplied',true);
  end if;
  -- Movimento é aplicado somente nas ações físicas explícitas e pelo RPC oficial,
  -- dentro da mesma transação do evento técnico. Não cria Flux automaticamente.
  if linked_supply_unit_id is not null and action_name='Removido' then
    perform public.supply_transition_unit(linked_supply_unit_id,old_stock_destination,
      null,null,null,service_reason);
  elsif linked_supply_unit_id is not null and action_name='Instalado' then
    if c.source_module='inventory' then
      target_inventory_id:=c.source_id;
    elsif c.source_module='management' and not c.requires_review then
      select r.id into target_management_id from public.module_records r
        where r.management_computer_id=c.source_id limit 1;
      if target_management_id is null then
        raise exception 'Computador de origem não encontrado para instalar a unidade.';
      end if;
    else
      raise exception 'A instalação exige chamado ligado a um equipamento do Inventário ou Gestão TI.';
    end if;
    perform public.supply_transition_unit(linked_supply_unit_id,'Instalado',
      target_inventory_id,target_management_id,null,service_reason);
  elsif linked_supply_unit_id is not null and action_name='Substituído' then
    select * into replacement_unit from public.supply_units
      where id=replacement_unit_id for update;
    if not found then raise exception 'Unidade substituta não encontrada.'; end if;
    perform public.supply_replace_unit(linked_supply_unit_id,replacement_unit_id,
      old_stock_destination,service_reason);
    select * into replacement_supply from public.supplies
      where id=replacement_unit.supply_id;
    insert into public.control_case_components(case_id,request_id,supply_unit_id,
      component_name,brand,model,tag,serial,recorded_by)
    values(p_case_id,gen_random_uuid(),replacement_unit_id,replacement_supply.name,
      replacement_supply.brand,replacement_supply.model,replacement_unit.code,
      replacement_unit.serial_number,auth.uid())
    on conflict do nothing returning id into replacement_component_id;
  end if;
  insert into public.control_case_component_events(case_id,component_id,request_id,action,
    occurred_at,result,notes,supplier,reason,protocol,expected_return_at,service_status,
    replacement_supply_unit_id,stock_destination,recorded_by)
  values(p_case_id,component.id,p_request_id,action_name,event_time,outcome,remarks,
    supplier_name,service_reason,protocol_value,expected_at,service_state,
    replacement_unit_id,old_stock_destination,auth.uid())
  returning id into new_event_id;
  return jsonb_build_object('componentId',component.id,'eventId',new_event_id,'alreadyApplied',false);
end;
$$;
revoke all on function public.append_control_case_component_event(uuid,jsonb,jsonb,uuid)
  from public,anon;
grant execute on function public.append_control_case_component_event(uuid,jsonb,jsonb,uuid)
  to authenticated;
commit;
