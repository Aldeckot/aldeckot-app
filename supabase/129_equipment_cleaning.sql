-- A contagem acompanha a identidade física e começa com uma limpeza explícita.
begin;

create table app.equipment_cleaning_state (
  source_module text not null check (source_module in ('management','inventory')),
  equipment_id uuid not null,
  current_type text not null check (current_type in ('Completa','Preventiva','Regular','Não realizada')),
  last_type text check (last_type in ('Completa','Preventiva','Regular')),
  last_performed_at timestamptz,
  due_on date,
  last_event_id uuid references public.equipment_events(id),
  expired boolean not null default false,
  primary key (source_module,equipment_id),
  check (num_nonnulls(last_type,last_performed_at,due_on,last_event_id) in (0,4))
);
create index equipment_cleaning_pending_idx on app.equipment_cleaning_state(due_on)
  where due_on is not null and not expired;

create table app.equipment_cleaning_settings (
  source_module text primary key check (source_module in ('management','inventory')),
  warning_days integer not null check (warning_days between 0 and 31)
);
insert into app.equipment_cleaning_settings values ('management',7),('inventory',3);
revoke all on app.equipment_cleaning_state, app.equipment_cleaning_settings from public, anon, authenticated;

create function app.cleaning_pdv_peripherals(p_position uuid)
returns table (id uuid, table_id uuid, equipment text, tag text, serial text, situation text, cleaning_type text)
language sql stable set search_path = pg_catalog, public as $$
  select distinct i.id,i.table_id,i.equipment,i.tag,i.serial,i.situation,i.cleaning_type
  from public.module_records r
  join public.module_tables t on t.id=r.table_id and t.module='management'
  cross join lateral jsonb_array_elements(case when jsonb_typeof(r.payload->'peripherals')='array'
    then r.payload->'peripherals' else '[]'::jsonb end) p(value)
  join public.inventory_items i on i.id::text=p.value->>'sourceItemId'
  where r.id=p_position
    and app.inventory_installation_location_key(r.payload->>'terminal') ~ '^pdv [0-9]+$'
    and p.value->>'sourceModule'='inventory'
    and app.inventory_installation_location_key(i.location)=app.inventory_installation_location_key(r.payload->>'terminal')
    and coalesce(i.peripheral_kind,app.inventory_tag_peripheral_type(i.tag)) is not null;
$$;

create function public.management_cleaning_peripherals(p_position uuid)
returns table (id uuid, equipment text, tag text, serial text, situation text, cleaning_type text, overdue boolean, editable boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  select p.id,p.equipment,p.tag,p.serial,p.situation,p.cleaning_type,
    coalesce(s.due_on<=(now() at time zone 'America/Sao_Paulo')::date,false),
    app.can_manage_module_table(p.table_id,'inventory','update')
  from public.module_records r
  cross join lateral app.cleaning_pdv_peripherals(r.id) p
  left join app.equipment_cleaning_state s on s.source_module='inventory' and s.equipment_id=p.id
  where r.id=p_position and app.can_manage_module_table(r.table_id,'management','read')
    and app.can_manage_module_table(p.table_id,'inventory','read')
  order by p.equipment,p.id;
$$;

-- Formulários antigos e movimentações podem regravar o campo de apresentação.
-- Um ciclo confirmado acompanha o ID físico e só é alterado pelo registro de limpeza.
create function app.project_equipment_cleaning()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  cleaning text;
begin
  if tg_table_name='inventory_items' then
    select s.current_type into cleaning from app.equipment_cleaning_state s
      where s.source_module='inventory' and s.equipment_id=new.id;
    if found then new.cleaning_type:=cleaning; end if;
  elsif new.management_computer_id is not null then
    select s.current_type into cleaning from app.equipment_cleaning_state s
      where s.source_module='management' and s.equipment_id=new.management_computer_id;
    if found then new.payload:=jsonb_set(new.payload,'{cleaning}',to_jsonb(cleaning)); end if;
  end if;
  return new;
end;
$$;
create trigger zz_equipment_cleaning_projection before update on public.inventory_items
  for each row execute function app.project_equipment_cleaning();
create trigger zz_equipment_cleaning_projection before insert or update on public.module_records
  for each row execute function app.project_equipment_cleaning();

-- Uma atualização exclusiva de limpeza usa seu próprio evento correlacionado.
-- Os gatilhos continuam processando as edições operacionais e movimentações.
drop trigger management_record_control_sync on public.module_records;
create trigger management_record_control_sync after insert or update of payload on public.module_records
  for each row when (coalesce(current_setting('app.control_completion_event',true),'')=''
    and current_setting('app.equipment_cleaning_operation',true) is distinct from 'on')
  execute function app.sync_control_from_management();

drop trigger module_record_activity_event on public.module_records;
create trigger module_record_activity_event after insert or update of payload on public.module_records
  for each row when (current_setting('app.equipment_cleaning_operation',true) is distinct from 'on')
  execute function app.record_module_record_activity();

create function app.write_equipment_cleaning(
  p_module text, p_identity uuid, p_source uuid, p_previous text, p_type text,
  p_operation uuid, p_event uuid, p_actor uuid, p_pdv text, p_at timestamptz,
  p_request jsonb, p_expiration boolean
) returns void language plpgsql set search_path = pg_catalog, public as $$
declare
  performed boolean := p_type<>'Não realizada';
  message text := case when p_expiration then 'Prazo de limpeza vencido.'
    when performed then format('Limpeza registrada: %s.',p_type) else 'Limpeza sinalizada como não realizada.' end;
  due date := case when performed then ((p_at at time zone 'America/Sao_Paulo')::date +
    make_interval(months=>case when p_module='management' then 2 else 1 end))::date end;
  prior app.equipment_cleaning_state%rowtype;
  activity jsonb;
begin
  select * into prior from app.equipment_cleaning_state s
    where s.source_module=p_module and s.equipment_id=p_identity for update;
  -- source_id e o log individual preservam o evento sem introduzir uma nova
  -- restrição à exclusão dos itens; a identidade física fica também em metadata.
  insert into public.equipment_events (
    id,source_module,source_event_key,source_id,action,reason,affected_modules,processing_result,metadata,actor_id,created_at
  ) values (
    p_event,p_module,'cleaning:'||p_event,p_source,message,message,
    jsonb_build_array(p_module),jsonb_build_object('status','applied'),
    jsonb_build_object('cleaningKind',case when p_expiration then 'expired' when performed then 'performed' else 'missed' end,
      'operationId',p_operation,'physicalId',p_identity,'previousCleaning',p_previous,'cleaning',p_type,
      'lastCleaningType',case when performed then p_type else prior.last_type end,
      'lastPerformedAt',case when performed then p_at else prior.last_performed_at end,
      'dueOn',coalesce(due,prior.due_on),'pdv',p_pdv,'request',p_request,
      'computerIds',case when p_module='management' then jsonb_build_array(p_identity) else '[]'::jsonb end,
      'inventoryItemId',case when p_module='inventory' then p_identity end),p_actor,p_at
  );
  insert into app.equipment_cleaning_state (
    source_module,equipment_id,current_type,last_type,last_performed_at,due_on,last_event_id,expired
  ) values (
    p_module,p_identity,p_type,case when performed then p_type else prior.last_type end,
    case when performed then p_at else prior.last_performed_at end,coalesce(due,prior.due_on),
    case when performed then p_event else prior.last_event_id end,
    p_expiration or (not performed and coalesce(prior.expired,false))
  ) on conflict (source_module,equipment_id) do update set
    current_type=excluded.current_type,last_type=excluded.last_type,
    last_performed_at=excluded.last_performed_at,due_on=excluded.due_on,
    last_event_id=excluded.last_event_id,expired=excluded.expired;
  if p_module='inventory' then
    update public.inventory_items as i set cleaning_type=p_type where i.id=p_source
      returning jsonb_build_object('tableId',i.table_id,'equipment',i.equipment,'tag',i.tag,
        'serial',i.serial,'status',i.status,'targetUrl',format('inventory.html?table=%s&item=%s',i.table_id,i.id)) into activity;
    insert into public.inventory_item_logs(inventory_item_id,action,message,event_id,created_at)
      values(p_source,'update',message,p_event,p_at);
  else
    perform set_config('app.equipment_cleaning_operation','on',true);
    update public.module_records as r set payload=jsonb_set(payload,'{logs}',
      jsonb_build_array(jsonb_build_object('id',p_event,'at',p_at,'text',message,
        'eventId',p_event,'sourceModule','management')) ||
      case when jsonb_typeof(payload->'logs')='array' then payload->'logs' else '[]'::jsonb end)
    where r.id=p_source returning jsonb_build_object('tableId',r.table_id,
      'equipment',r.payload->>'equipment','tag',r.payload->>'tag','serial',r.payload->>'serial',
      'status',r.payload->>'status','targetUrl',format('management.html?item=%s',r.id)) into activity;
    perform set_config('app.equipment_cleaning_operation','',true);
  end if;
  insert into public.sync_events(module,operation,details,event_id,created_at)
    values(p_module,'update',activity||jsonb_build_object('itemId',p_source,'description',message,
      'operationId',p_operation),p_event,p_at);
end;
$$;

create function public.record_equipment_cleaning(
  p_module text, p_source uuid, p_expected_updated_at timestamptz, p_type text,
  p_selected uuid[], p_request_id uuid
) returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  actor uuid := auth.uid();
  at_time timestamptz := clock_timestamp();
  selected uuid[] := array(select distinct selected_id from unnest(p_selected) selected_id order by selected_id);
  request jsonb;
  previous_event public.equipment_events%rowtype;
  computer public.module_records%rowtype;
  item public.inventory_items%rowtype;
  peripheral record;
  terminal text;
begin
  if actor is null or p_source is null or p_request_id is null or p_expected_updated_at is null
    or p_module is null or p_module not in ('management','inventory') or p_type is null
    or p_type not in ('Completa','Preventiva','Regular','Não realizada')
    or array_position(selected,null::uuid) is not null or cardinality(selected)>32
    or (cardinality(selected)>0 and (p_module='inventory' or p_type='Não realizada')) then
    raise exception 'Registro de limpeza inválido.';
  end if;
  request:=jsonb_build_object('source',p_source,'module',p_module,'type',p_type,'selected',selected);
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into previous_event from public.equipment_events e where e.id=p_request_id;
  if found then
    if previous_event.actor_id=actor and previous_event.metadata->'request'=request then return p_request_id; end if;
    raise exception 'Identificador já utilizado para outra operação.';
  end if;
  if p_module='management' then
    select r.* into computer from public.module_records r
      join public.module_tables t on t.id=r.table_id and t.module='management'
      where r.id=p_source for update of r;
    if computer.management_computer_id is null or not coalesce(app.can_manage_module_table(computer.table_id,'management','update'),false) then
      raise exception 'Computador indisponível para registrar a limpeza.';
    end if;
    if computer.updated_at is distinct from p_expected_updated_at then
      raise exception 'O computador mudou. Reabra o registro antes de confirmar a limpeza.';
    end if;
    terminal:=computer.payload->>'terminal';
    perform i.id from public.inventory_items i where i.id=any(selected) order by i.id for update;
    if cardinality(selected)<>(select count(*) from app.cleaning_pdv_peripherals(p_source) p
        where p.id=any(selected) and app.can_manage_module_table(p.table_id,'inventory','update')) then
      raise exception 'Os vínculos do PDV mudaram ou um periférico selecionado não pode ser atualizado.';
    end if;
    perform app.write_equipment_cleaning(p_module,computer.management_computer_id,p_source,
      computer.payload->>'cleaning',p_type,p_request_id,p_request_id,actor,terminal,at_time,request,false);
    for peripheral in select p.* from app.cleaning_pdv_peripherals(p_source) p where p.id=any(selected) order by p.id loop
      perform app.write_equipment_cleaning('inventory',peripheral.id,peripheral.id,peripheral.cleaning_type,p_type,
        p_request_id,md5(p_request_id::text||':'||peripheral.id)::uuid,actor,terminal,at_time,null,false);
    end loop;
  else
    select i.* into item from public.inventory_items i where i.id=p_source for update;
    if item.id is null or not coalesce(app.can_manage_module_table(item.table_id,'inventory','update'),false) then
      raise exception 'Item indisponível para registrar a limpeza.';
    end if;
    if item.updated_at is distinct from p_expected_updated_at then
      raise exception 'O item mudou. Reabra o registro antes de confirmar a limpeza.';
    end if;
    perform app.write_equipment_cleaning(p_module,item.id,item.id,item.cleaning_type,p_type,
      p_request_id,p_request_id,actor,item.location,at_time,request,false);
  end if;
  return p_request_id;
end;
$$;

create function app.expire_equipment_cleaning(p_at timestamptz)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  today date := (p_at at time zone 'America/Sao_Paulo')::date;
  candidate app.equipment_cleaning_state%rowtype;
  state app.equipment_cleaning_state%rowtype;
  record_id uuid;
  previous_type text;
  location text;
  event_id uuid;
  total integer := 0;
begin
  for candidate in select * from app.equipment_cleaning_state s where s.due_on<=today and not s.expired
      order by s.source_module,s.equipment_id loop
    if candidate.source_module='management' then
      select r.id,r.payload->>'cleaning',r.payload->>'terminal' into record_id,previous_type,location
        from public.module_records r where r.management_computer_id=candidate.equipment_id for update skip locked;
    else
      select i.id,i.cleaning_type,i.location into record_id,previous_type,location
        from public.inventory_items i where i.id=candidate.equipment_id for update skip locked;
    end if;
    if record_id is null then continue; end if;
    select * into state from app.equipment_cleaning_state s
      where s.source_module=candidate.source_module and s.equipment_id=candidate.equipment_id for update;
    if state.expired or state.due_on>today then continue; end if;
    event_id:=md5('cleaning-expired:'||state.last_event_id)::uuid;
    perform app.write_equipment_cleaning(state.source_module,state.equipment_id,record_id,previous_type,
      'Não realizada',event_id,event_id,null,location,p_at,null,true);
    total:=total+1;
  end loop;
  return total;
end;
$$;

create function public.equipment_cleaning_alerts()
returns table (source_module text,equipment_id uuid,source_id uuid,table_id uuid,
  equipment text,tag text,serial text,pdv text,position_id uuid,
  last_performed_at timestamptz,due_on date,overdue boolean)
language sql stable security definer set search_path = pg_catalog, public as $$
  with upcoming as (
    select s.*,(now() at time zone 'America/Sao_Paulo')::date as today
    from app.equipment_cleaning_state s join app.equipment_cleaning_settings config using (source_module)
    where s.due_on<=(now() at time zone 'America/Sao_Paulo')::date+config.warning_days
  )
  select s.source_module,s.equipment_id,r.id,r.table_id,r.payload->>'equipment',r.payload->>'tag',r.payload->>'serial',
    case when app.inventory_installation_location_key(r.payload->>'terminal') ~ '^pdv [0-9]+$' then r.payload->>'terminal' end,
    r.id,s.last_performed_at,s.due_on,s.due_on<=s.today
  from upcoming s join public.module_records r on r.management_computer_id=s.equipment_id
  where s.source_module='management' and app.can_manage_module_table(r.table_id,'management','read')
  union all
  select s.source_module,s.equipment_id,i.id,i.table_id,i.equipment,i.tag,i.serial,p.pdv,p.id,
    s.last_performed_at,s.due_on,s.due_on<=s.today
  from upcoming s join public.inventory_items i on i.id=s.equipment_id
  left join lateral (
    select case when app.can_manage_module_table(r.table_id,'management','read') then r.id end as id,
      r.payload->>'terminal' as pdv from public.module_records r
    cross join lateral app.cleaning_pdv_peripherals(r.id) asset
    where asset.id=i.id order by r.id limit 1
  ) p on true
  where s.source_module='inventory' and app.can_manage_module_table(i.table_id,'inventory','read');
$$;

-- O chamado mantém sua própria situação e prioridade. A ficha consulta
-- a situação física atual somente quando o vínculo com a fonte é comprovado.
create function public.control_source_equipment_state(p_ticket_ids uuid[])
returns table (ticket_id uuid, status text, situation text, cleaning_type text)
language sql stable security definer set search_path = pg_catalog, public as $$
  select c.id,coalesce(i.status,r.payload->>'status'),coalesce(i.situation,r.payload->>'situation'),
    coalesce(i.cleaning_type,r.payload->>'cleaning')
  from public.control_items c
  left join public.inventory_items i
    on i.id=coalesce(c.inventory_item_id,c.verification_inventory_item_id)
    and app.can_manage_module_table(i.table_id,'inventory','read')
  left join public.module_records r
    on r.management_computer_id is not null
    and (r.management_computer_id=c.verification_computer_id or
      (c.verification_computer_id is null and r.id=c.management_record_id
        and app.management_identity_matches(r.payload,c.tag,c.serial)))
    and app.can_manage_module_table(r.table_id,'management','read')
  where c.id=any(p_ticket_ids) and app.can_manage_module_table(c.table_id,'control','read')
    and (i.id is not null or r.id is not null);
$$;

revoke all on function public.control_source_equipment_state(uuid[]) from public, anon;
grant execute on function public.control_source_equipment_state(uuid[]) to authenticated;

revoke all on function app.cleaning_pdv_peripherals(uuid),app.project_equipment_cleaning(),
  app.write_equipment_cleaning(text,uuid,uuid,text,text,uuid,uuid,uuid,text,timestamptz,jsonb,boolean),
  app.expire_equipment_cleaning(timestamptz) from public, anon, authenticated;
revoke all on function public.management_cleaning_peripherals(uuid),public.equipment_cleaning_alerts(),
  public.record_equipment_cleaning(text,uuid,timestamptz,text,uuid[],uuid) from public, anon;
grant execute on function public.management_cleaning_peripherals(uuid),public.equipment_cleaning_alerts(),
  public.record_equipment_cleaning(text,uuid,timestamptz,text,uuid[],uuid) to authenticated;

do $schedule$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('aldeckot-expire-equipment-cleaning','*/15 * * * *',
      'select app.expire_equipment_cleaning(clock_timestamp())');
  else
    raise notice 'pg_cron indisponível. Habilite e agende a função de vencimento antes de ativar a automação.';
  end if;
end;
$schedule$;

commit;
