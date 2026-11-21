-- Executar após autorização e somente entre BEGIN e ROLLBACK no projeto de testes.
-- Usa um registro já existente; nenhuma linha de equipamento é criada.
do $auth$
begin
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.profiles where role = 'admin' and status = 'active' limit 1), true);
end;
$auth$;
set local role authenticated;

do $verify$
declare
  item public.control_items%rowtype;
  saved public.control_items%rowtype;
  request_id uuid := gen_random_uuid();
  preventive_id uuid := gen_random_uuid();
  flux_count integer := (select count(*) from public.flux_items);
  movement_count integer := (select count(*) from public.supply_movements);
  case_count integer := (select count(*) from public.control_cases);
  result jsonb;
begin
  select * into strict item from public.control_items where status = 'Em manutenção'
    and operational_status is null and operational_situation is null order by id limit 1;
  update public.control_items set operational_status = 'Em manutenção' where id = item.id;
  update public.control_items set operational_situation = 'Aguardando peça'
    where id = item.id returning * into saved;
  if saved.status is distinct from item.status or saved.cleaning_type is distinct from item.cleaning_type
    or saved.operational_status is distinct from 'Em manutenção'
    or saved.operational_situation is distinct from 'Aguardando peça' then
    raise exception 'Independent classification failed.';
  end if;
  if not exists (select 1 from public.equipment_events e where e.source_id = item.id
      and e.metadata->>'boardKind' = 'classification'
      and e.previous_status = 'Em manutenção' and e.new_status = 'Em manutenção'
      and e.metadata->'previousSituation' = 'null'::jsonb and e.metadata->>'newSituation' = 'Aguardando peça'
      and e.actor_id = auth.uid()) then
    raise exception 'Structured situation transition was not recorded.';
  end if;
  begin
    update public.control_items set operational_situation = 'Preventiva' where id = item.id;
    raise exception 'Cleaning was accepted as a situation.';
  exception when check_violation then null;
  end;
  result := public.control_record_board_activity(item.id, 'part',
    '{"part":"Peça para validação","quantity":2,"priority":"Alta","reason":"Ensaio transacional","notes":""}', request_id);
  if result->>'alreadyApplied' is distinct from 'false' then raise exception 'Part request was not created.'; end if;
  result := public.control_record_board_activity(item.id, 'part',
    '{"part":"Peça para validação","quantity":2,"priority":"Alta","reason":"Ensaio transacional","notes":""}', request_id);
  if result->>'alreadyApplied' is distinct from 'true' then raise exception 'Part request retry was not idempotent.'; end if;
  perform public.control_record_board_activity(item.id, 'preventive',
    jsonb_build_object('activity', 'Validação preventiva', 'dueDate', current_date + 1,
      'responsible', 'Responsável de ensaio'), preventive_id);
  if (select count(*) from public.control_board_timeline(item.id)
      where event_id in (request_id, preventive_id) and origin = 'board') <> 2
    or (select count(*) from public.supply_movements) <> movement_count
    or (select count(*) from public.flux_items) <> flux_count
    or (select count(*) from public.control_cases) <> case_count then
    raise exception 'Timeline missed an activity or affected another workflow.';
  end if;
end;
$verify$;
reset role;
select 'control_board_128_independence_history_and_activity_ok';
