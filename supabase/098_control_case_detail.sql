-- ALDECKOT | Etapa 05: detalhe e diagnóstico versionado do chamado.
-- Aplicar somente após 097 e validação isolada; não reconcilia dados antigos.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.equipment_events') is null
    or to_regprocedure('app.can_manage_module_table(uuid,text,text)') is null then
    raise exception 'As migrações 095–097 devem estar aplicadas antes da 098.';
  end if;
end;
$preflight$;

create table public.control_case_diagnostics (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  request_id uuid not null unique,
  revision integer not null check (revision > 0),
  symptom text not null default '',
  hypothesis text not null default '',
  tests text not null default '',
  results text not null default '',
  cause text not null default '',
  final_diagnosis text not null default '',
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (case_id,revision)
);
create index control_case_diagnostics_history_idx
  on public.control_case_diagnostics(case_id,revision desc);
alter table public.control_case_diagnostics enable row level security;
revoke all on public.control_case_diagnostics from public,anon,authenticated;
grant select on public.control_case_diagnostics to authenticated;
create policy "Contas ativas consultam diagnósticos"
  on public.control_case_diagnostics for select to authenticated
  using (app.has_active_account());

create function public.append_control_case_diagnostic(
  p_case_id uuid,p_payload jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path = public,app,pg_temp as $$
declare
  current_case public.control_cases%rowtype;
  previous public.control_case_diagnostics%rowtype;
  normalized jsonb;
  next_revision integer;
  new_id uuid;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Sessão, chamado, operação e diagnóstico válidos são necessários.';
  end if;
  normalized := jsonb_build_object(
    'symptom',btrim(coalesce(p_payload->>'symptom','')),
    'hypothesis',btrim(coalesce(p_payload->>'hypothesis','')),
    'tests',btrim(coalesce(p_payload->>'tests','')),
    'results',btrim(coalesce(p_payload->>'results','')),
    'cause',btrim(coalesce(p_payload->>'cause','')),
    'finalDiagnosis',btrim(coalesce(p_payload->>'finalDiagnosis','')));
  if exists (select 1 from jsonb_each_text(normalized) f where char_length(f.value) > 2000)
    or not exists (select 1 from jsonb_each_text(normalized) f where f.value <> '') then
    raise exception 'Informe ao menos um campo; cada campo aceita até 2000 caracteres.';
  end if;
  select * into current_case from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if current_case.table_id is null or
    not coalesce(app.can_manage_module_table(current_case.table_id,'control','update'),false) then
    raise exception 'Sem permissão para registrar diagnóstico.';
  end if;
  select * into previous from public.control_case_diagnostics where request_id=p_request_id;
  if found then
    if previous.case_id <> p_case_id or
      jsonb_build_object('symptom',previous.symptom,'hypothesis',previous.hypothesis,
        'tests',previous.tests,'results',previous.results,'cause',previous.cause,
        'finalDiagnosis',previous.final_diagnosis) <> normalized then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('id',previous.id,'revision',previous.revision,'alreadyApplied',true);
  end if;
  if current_case.ticket_state in ('Concluído','Cancelado') then
    raise exception 'Chamado encerrado não aceita novo diagnóstico.';
  end if;
  select coalesce(max(revision),0)+1 into next_revision
    from public.control_case_diagnostics where case_id=p_case_id;
  insert into public.control_case_diagnostics(case_id,request_id,revision,symptom,
    hypothesis,tests,results,cause,final_diagnosis,author_id)
  values(p_case_id,p_request_id,next_revision,normalized->>'symptom',
    normalized->>'hypothesis',normalized->>'tests',normalized->>'results',
    normalized->>'cause',normalized->>'finalDiagnosis',auth.uid())
  returning id into new_id;
  return jsonb_build_object('id',new_id,'revision',next_revision,'alreadyApplied',false);
end;
$$;
revoke all on function public.append_control_case_diagnostic(uuid,jsonb,uuid) from public,anon;
grant execute on function public.append_control_case_diagnostic(uuid,jsonb,uuid) to authenticated;

create function public.get_control_case_detail(p_case_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() or p_case_id is null then
    raise exception 'Conta ativa e chamado são necessários.';
  end if;
  select jsonb_build_object(
    'case',to_jsonb(c),
    'item',case when i.id is null then null else jsonb_build_object(
      'id',i.id,'equipment',i.equipment,'model',i.model,'brand',i.brand,
      'serial',i.serial,'tag',i.tag,'sector',i.sector,'status',i.status,
      'notes',i.notes,'entryDate',i.entry_date,'exitDate',i.exit_date) end,
    'location',case when c.source_module='inventory'
      then (select nullif(location,'') from public.inventory_items where id=c.source_id)
      when c.source_module='management' and not c.requires_review
      then (select nullif(payload->>'location','') from public.module_records
        where management_computer_id=c.source_id limit 1)
      else null end,
    'diagnostics',coalesce((select jsonb_agg(to_jsonb(d) order by d.revision desc)
      from public.control_case_diagnostics d where d.case_id=c.id),'[]'::jsonb),
    'transitions',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc,t.id desc)
      from public.control_case_transitions t where t.case_id=c.id),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc)
      from public.equipment_events e
      where ((c.source_module='inventory' and e.inventory_item_id=c.source_id)
        or (e.source_module=c.source_module and e.source_id=c.source_id)
        or (c.source_module='management' and e.source_module='management'
          and e.metadata->'computerIds' ? c.source_id::text))
        and e.created_at >= c.opened_at
        and (c.closed_at is null or e.created_at <= c.closed_at)
        and (e.metadata->>'physicalMovement'='true'
          or e.action in ('computer_transfer','computer_replacement')
          or nullif(e.previous_location,'') is distinct from nullif(e.new_location,'')
          or nullif(e.origin_location,'') is distinct from nullif(e.destination_location,''))
      ),'[]'::jsonb)
    ) into result
  from public.control_cases c
  left join public.control_items i on i.id=c.control_item_id
  where c.id=p_case_id;
  if result is null then raise exception 'Chamado não encontrado.'; end if;
  return result;
end;
$$;
revoke all on function public.get_control_case_detail(uuid) from public,anon;
grant execute on function public.get_control_case_detail(uuid) to authenticated;
commit;
