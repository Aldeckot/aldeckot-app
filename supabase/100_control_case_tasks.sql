-- ALDECKOT | Etapa 07: pendências e decisão explícita no encerramento.
-- Aplicar após 099, somente depois de validação isolada e backup.
begin;
do $preflight$
begin
  if to_regclass('public.control_case_interventions') is null
    or to_regprocedure('public.transition_control_case(uuid,text,text,uuid)') is null then
    raise exception 'A migração 099 e suas dependências devem estar aplicadas antes da 100.';
  end if;
end;
$preflight$;

create table public.control_case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  description text not null check (char_length(btrim(description)) between 3 and 2000),
  due_at timestamptz,
  priority text not null default 'Média' check (priority in ('Alta','Média','Baixa')),
  task_state text not null default 'Pendente'
    check (task_state in ('Pendente','Em andamento','Concluída','Cancelada')),
  completion_note text not null default '',
  notes text not null default '',
  completed_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(notes) <= 2000),
  check (char_length(completion_note) <= 2000),
  check ((task_state='Concluída') =
    (completed_at is not null and char_length(btrim(completion_note)) >= 3))
);
create index control_case_tasks_case_idx
  on public.control_case_tasks(case_id,task_state,due_at,id);
create index control_case_tasks_overdue_idx
  on public.control_case_tasks(due_at,id)
  where task_state in ('Pendente','Em andamento') and due_at is not null;

create table public.control_case_task_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  task_id uuid not null references public.control_case_tasks(id) on delete restrict,
  request_id uuid not null unique,
  action text not null check (action in ('Criada','Atualizada')),
  payload jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index control_case_task_events_case_idx
  on public.control_case_task_events(case_id,created_at,id);
alter table public.control_case_tasks enable row level security;
alter table public.control_case_task_events enable row level security;
revoke all on public.control_case_tasks,public.control_case_task_events
  from public,anon,authenticated;
grant select on public.control_case_tasks,public.control_case_task_events to authenticated;
create policy "Contas ativas consultam pendências" on public.control_case_tasks
  for select to authenticated using (app.has_active_account());
create policy "Contas ativas consultam histórico de pendências"
  on public.control_case_task_events for select to authenticated
  using (app.has_active_account());

create function public.create_control_case_task(
  p_case_id uuid,p_payload jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare c public.control_cases%rowtype; prior public.control_case_task_events%rowtype;
  task public.control_case_tasks%rowtype; details text; urgency text;
  deadline timestamptz; remarks text;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Sessão, chamado, operação e pendência válidos são necessários.';
  end if;
  details:=btrim(coalesce(p_payload->>'description',''));
  urgency:=coalesce(nullif(p_payload->>'priority',''),'Média');
  remarks:=btrim(coalesce(p_payload->>'notes',''));
  deadline:=nullif(p_payload->>'dueAt','')::timestamptz;
  if char_length(details) not between 3 and 2000
    or urgency not in ('Alta','Média','Baixa')
    or char_length(remarks)>2000 then
    raise exception 'Descrição, prioridade ou observações inválidas.';
  end if;
  select * into c from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if c.table_id is null or
    not coalesce(app.can_manage_module_table(c.table_id,'control','update'),false) then
    raise exception 'Sem permissão para registrar pendência.';
  end if;
  select * into prior from public.control_case_task_events where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.action<>'Criada'
      or prior.payload<>jsonb_build_object('description',details,'priority',urgency,
        'notes',remarks,'dueAt',deadline) then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('id',prior.task_id,'alreadyApplied',true);
  end if;
  if c.ticket_state in ('Concluído','Cancelado') then
    raise exception 'Chamado encerrado não aceita nova pendência.';
  end if;
  insert into public.control_case_tasks(case_id,description,due_at,priority,notes,
    created_by,updated_by)
  values(p_case_id,details,deadline,urgency,remarks,auth.uid(),auth.uid())
  returning * into task;
  insert into public.control_case_task_events(case_id,task_id,request_id,action,
    payload,after_snapshot,actor_id)
  values(p_case_id,task.id,p_request_id,'Criada',
    jsonb_build_object('description',details,'priority',urgency,
      'notes',remarks,'dueAt',deadline),to_jsonb(task),auth.uid());
  return jsonb_build_object('id',task.id,'alreadyApplied',false);
end;
$$;
revoke all on function public.create_control_case_task(uuid,jsonb,uuid) from public,anon;
grant execute on function public.create_control_case_task(uuid,jsonb,uuid) to authenticated;

create function public.update_control_case_task(
  p_task_id uuid,p_payload jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare c public.control_cases%rowtype; task public.control_case_tasks%rowtype;
  prior public.control_case_task_events%rowtype; old_row jsonb;
  details text; urgency text; state_name text; remarks text; finish_note text;
  deadline timestamptz; expected_revision integer; canonical jsonb; target_case uuid;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_task_id is null or p_request_id is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Sessão, tarefa, operação e atualização válidas são necessárias.';
  end if;
  details:=btrim(coalesce(p_payload->>'description',''));
  urgency:=coalesce(p_payload->>'priority','');
  state_name:=coalesce(p_payload->>'state','');
  remarks:=btrim(coalesce(p_payload->>'notes',''));
  finish_note:=btrim(coalesce(p_payload->>'completionNote',''));
  deadline:=nullif(p_payload->>'dueAt','')::timestamptz;
  expected_revision:=nullif(p_payload->>'revision','')::integer;
  if char_length(details) not between 3 and 2000
    or urgency not in ('Alta','Média','Baixa')
    or state_name not in ('Pendente','Em andamento','Concluída','Cancelada')
    or char_length(remarks)>2000 or char_length(finish_note)>2000
    or (state_name='Concluída' and char_length(finish_note)<3)
    or expected_revision is null or expected_revision<1 then
    raise exception 'Conteúdo, conclusão ou revisão da pendência inválidos.';
  end if;
  canonical:=jsonb_build_object('description',details,'priority',urgency,
    'state',state_name,'notes',remarks,'completionNote',finish_note,
    'dueAt',deadline,'revision',expected_revision);
  select case_id into target_case from public.control_case_tasks where id=p_task_id;
  if not found then raise exception 'Pendência não encontrada.'; end if;
  select * into c from public.control_cases where id=target_case for update;
  if c.table_id is null or
    not coalesce(app.can_manage_module_table(c.table_id,'control','update'),false) then
    raise exception 'Sem permissão para atualizar pendência.';
  end if;
  select * into prior from public.control_case_task_events where request_id=p_request_id;
  if found then
    if prior.task_id<>p_task_id or prior.action<>'Atualizada'
      or prior.payload<>canonical then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('id',p_task_id,'alreadyApplied',true);
  end if;
  select * into task from public.control_case_tasks where id=p_task_id for update;
  if task.revision<>expected_revision then
    raise exception 'Pendência alterada em outra sessão; atualize os dados.';
  end if;
  old_row:=to_jsonb(task);
  update public.control_case_tasks set description=details,due_at=deadline,
    priority=urgency,task_state=state_name,notes=remarks,
    completion_note=finish_note,
    completed_at=case when state_name='Concluída'
      then case when task.task_state='Concluída' then task.completed_at else now() end
      else null end,
    revision=task.revision+1,updated_by=auth.uid(),updated_at=now()
  where id=p_task_id returning * into task;
  insert into public.control_case_task_events(case_id,task_id,request_id,action,
    payload,before_snapshot,after_snapshot,actor_id)
  values(c.id,p_task_id,p_request_id,'Atualizada',canonical,old_row,
    to_jsonb(task),auth.uid());
  return jsonb_build_object('id',p_task_id,'revision',task.revision,'alreadyApplied',false);
end;
$$;
revoke all on function public.update_control_case_task(uuid,jsonb,uuid) from public,anon;
grant execute on function public.update_control_case_task(uuid,jsonb,uuid) to authenticated;

create function public.control_overdue_case_tasks()
returns jsonb language plpgsql stable security definer
set search_path=public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa necessária para consultar pendências.';
  end if;
  select jsonb_build_object('count',(select count(*) from public.control_case_tasks
      where task_state in ('Pendente','Em andamento') and due_at<now()),
    'items',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at,t.id) from (
      select x.id,x.case_id as "caseId",c.control_item_id as "controlItemId",
        c.table_id as "tableId",c.equipment,c.tag,x.description,x.due_at,
        x.priority,x.task_state as "state"
      from public.control_case_tasks x join public.control_cases c on c.id=x.case_id
      where x.task_state in ('Pendente','Em andamento') and x.due_at<now()
      order by x.due_at,x.id limit 8
    ) t),'[]'::jsonb)) into result;
  return result;
end;
$$;
revoke all on function public.control_overdue_case_tasks() from public,anon;
grant execute on function public.control_overdue_case_tasks() to authenticated;

-- A aprovação é específica ao conjunto atual de tarefas abertas e ao request_id.
create table public.control_case_closure_decisions (
  request_id uuid primary key,
  case_id uuid not null references public.control_cases(id) on delete restrict,
  open_task_ids uuid[] not null,
  decision text not null check (decision='Manter abertas'),
  reason text not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on public.control_case_closure_decisions from public,anon,authenticated;
alter table public.control_case_closure_decisions enable row level security;

create function app.guard_control_case_task_closure()
returns trigger language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare current_ids uuid[]; approved public.control_case_closure_decisions%rowtype;
begin
  if new.ticket_state is distinct from 'Concluído'
    or old.ticket_state='Concluído' then return new; end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into current_ids
    from public.control_case_tasks
    where case_id=new.id and task_state in ('Pendente','Em andamento');
  if cardinality(current_ids)=0 then return new; end if;
  select d.* into approved from public.control_case_closure_decisions d
    join public.equipment_events e
      on e.source_event_key='case-transition:'||d.request_id::text
      and e.source_module='control' and e.source_id=new.id
      and e.metadata->>'nextCaseState'='Concluído'
    where d.case_id=new.id and d.actor_id=auth.uid()
      and d.open_task_ids=current_ids;
  if not found then
    raise exception 'Há pendências abertas. Revise a lista e confirme a decisão antes de concluir.';
  end if;
  return new;
end;
$$;
create trigger control_case_task_closure_guard
  before update of ticket_state on public.control_cases
  for each row execute function app.guard_control_case_task_closure();

create function public.close_control_case_with_tasks(
  p_case_id uuid,p_reason text,p_request_id uuid,
  p_open_task_ids uuid[],p_decision text
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare c public.control_cases%rowtype; current_ids uuid[];
  prior public.control_case_closure_decisions%rowtype;
  clean_reason text:=btrim(coalesce(p_reason,''));
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or char_length(clean_reason) not between 3 and 2000 then
    raise exception 'Sessão, chamado e justificativa de encerramento são necessários.';
  end if;
  select * into c from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if c.table_id is null or
    not coalesce(app.can_manage_module_table(c.table_id,'control','update'),false) then
    raise exception 'Sem permissão para concluir este chamado.';
  end if;
  select * into prior from public.control_case_closure_decisions
    where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.reason<>clean_reason
      or prior.open_task_ids<>p_open_task_ids or prior.decision<>p_decision then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return public.transition_control_case(
      p_case_id,'Concluído',clean_reason,p_request_id);
  end if;
  if c.ticket_state<>'Resolvido' then
    raise exception 'Registre primeiro a solução antes do encerramento formal.';
  end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into current_ids
    from public.control_case_tasks where case_id=p_case_id
      and task_state in ('Pendente','Em andamento');
  if current_ids<>coalesce((select array_agg(id order by id)
      from unnest(p_open_task_ids) id),'{}'::uuid[]) then
    raise exception 'A lista de pendências mudou; revise antes de concluir.';
  end if;
  if cardinality(current_ids)>0 then
    if p_decision is distinct from 'Manter abertas' then
      raise exception 'Escolha explicitamente manter abertas as pendências listadas.';
    end if;
    insert into public.control_case_closure_decisions(
      request_id,case_id,open_task_ids,decision,reason,actor_id)
    values(p_request_id,p_case_id,current_ids,p_decision,clean_reason,auth.uid());
  elsif p_decision is not null and p_decision<>'' then
    raise exception 'Não há pendências abertas para esta decisão.';
  end if;
  return public.transition_control_case(
    p_case_id,'Concluído',clean_reason,p_request_id);
end;
$$;
revoke all on function public.close_control_case_with_tasks(uuid,text,uuid,uuid[],text)
  from public,anon;
grant execute on function public.close_control_case_with_tasks(uuid,text,uuid,uuid[],text)
  to authenticated;
commit;
