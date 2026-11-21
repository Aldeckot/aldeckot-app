begin;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

insert into public.control_cases(id,source_module,source_id,followup_kind,ticket_state,
  equipment,priority,opened_at)
select ('00000000-0000-4000-8000-'||lpad((900+n)::text,12,'0'))::uuid,'control',
  ('00000000-0000-4000-8000-'||lpad((950+n)::text,12,'0'))::uuid,'maintenance',
  'Em manutenção','Equipamento fictício '||n,'Estável',now()-(n||' days')::interval
from generate_series(14,30) n where n in (14,15,29,30);

insert into public.control_case_transitions(case_id,previous_state,next_state,reason,source,created_at)
select id,null,'Em manutenção','Início fictício para testar severidade','manual',opened_at
from public.control_cases where id in (
  '00000000-0000-4000-8000-000000000914',
  '00000000-0000-4000-8000-000000000915',
  '00000000-0000-4000-8000-000000000929',
  '00000000-0000-4000-8000-000000000930');

do $test$
declare result jsonb; durations jsonb;
begin
  result := public.set_control_case_priority(
    '00000000-0000-4000-8000-000000000021','Alta',
    '00000000-0000-4000-8000-000000000991');
  if result->>'alreadyApplied' <> 'false'
    or (select priority_level from public.control_cases
      where id='00000000-0000-4000-8000-000000000021') <> 'Alta' then
    raise exception 'Priority update should be applied as a distinct ticket field';
  end if;
  result := public.set_control_case_priority(
    '00000000-0000-4000-8000-000000000021','Alta',
    '00000000-0000-4000-8000-000000000991');
  if result->>'alreadyApplied' <> 'true'
    or (select count(*) from public.control_case_priority_changes
      where request_id='00000000-0000-4000-8000-000000000991') <> 1 then
    raise exception 'Retrying the priority change must not duplicate audit history';
  end if;
  if (select count(*) from public.control_case_state_intervals
      where case_id in ('00000000-0000-4000-8000-000000000914',
        '00000000-0000-4000-8000-000000000915','00000000-0000-4000-8000-000000000929',
        '00000000-0000-4000-8000-000000000930') and interval_kind='maintenance') <> 4 then
    raise exception 'Each maintenance transition should create one durable interval';
  end if;
  durations := public.control_case_duration_summary(null);
  select value into result from jsonb_array_elements(durations)
    where value->>'id'='00000000-0000-4000-8000-000000000914';
  if result->>'maintenanceSeverity' <> 'Normal' then
    raise exception '14 days should remain normal: %',result;
  end if;
  select value into result from jsonb_array_elements(durations)
    where value->>'id'='00000000-0000-4000-8000-000000000915';
  if result->>'maintenanceSeverity' <> 'Atenção' then
    raise exception '15 days should enter attention: %',result;
  end if;
  select value into result from jsonb_array_elements(durations)
    where value->>'id'='00000000-0000-4000-8000-000000000929';
  if result->>'maintenanceSeverity' <> 'Atenção' then
    raise exception '29 days should remain attention: %',result;
  end if;
  select value into result from jsonb_array_elements(durations)
    where value->>'id'='00000000-0000-4000-8000-000000000930';
  if result->>'maintenanceSeverity' <> 'Crítica' then
    raise exception '30 days should become critical: %',result;
  end if;

  insert into public.control_case_transitions(case_id,previous_state,next_state,reason,source,created_at)
  values('00000000-0000-4000-8000-000000000930','Em manutenção','Aguardando peça',
    'Pausa fictícia de manutenção','manual',now()-interval '1 day');
  if not exists(select 1 from public.control_case_state_intervals
      where case_id='00000000-0000-4000-8000-000000000930'
        and interval_kind='maintenance' and ended_at is not null)
    or not exists(select 1 from public.control_case_state_intervals
      where case_id='00000000-0000-4000-8000-000000000930'
        and interval_kind='waiting' and ended_at is null) then
    raise exception 'Waiting state must stop the maintenance clock and start its own interval';
  end if;
  if (select count(*) from public.control_case_state_intervals
      where case_id='00000000-0000-4000-8000-000000000930' and transition_id in
        (select id from public.control_case_transitions where case_id='00000000-0000-4000-8000-000000000930')) <> 2 then
    raise exception 'One interval per qualifying transition is required';
  end if;
end
$test$;
rollback;
