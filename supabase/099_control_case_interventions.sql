-- ALDECKOT | Etapa 06: intervenções formais e cronologia do chamado.
-- Aplicar após 098, somente depois de validação isolada e backup.
-- Esta migração não cria movimentos físicos nem altera o estado dos chamados.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.control_case_diagnostics') is null
    or to_regprocedure('public.get_control_case_detail(uuid)') is null
    or to_regprocedure('app.can_manage_module_table(uuid,text,text)') is null then
    raise exception 'A migração 098 e suas dependências devem estar aplicadas antes da 099.';
  end if;
end;
$preflight$;

create table public.control_case_interventions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  request_id uuid not null unique,
  occurred_at timestamptz not null,
  intervention_type text not null check (intervention_type in (
    'Inspeção','Diagnóstico','Limpeza','Configuração','Atualização','Reparo',
    'Troca de componente','Teste funcional','Teste de estabilidade',
    'Envio externo','Retorno','Outro')),
  description text not null check (char_length(btrim(description)) between 3 and 2000),
  result text not null check (char_length(btrim(result)) between 3 and 2000),
  contextual_state text,
  technical_author text not null default '' check (char_length(technical_author) <= 160),
  reference_note text not null default '' check (char_length(reference_note) <= 500),
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index control_case_interventions_timeline_idx
  on public.control_case_interventions(case_id,occurred_at,id);
create index control_case_interventions_recent_idx
  on public.control_case_interventions(occurred_at desc,id desc);
alter table public.control_case_interventions enable row level security;
revoke all on public.control_case_interventions from public,anon,authenticated;
grant select on public.control_case_interventions to authenticated;
create policy "Contas ativas consultam intervenções"
  on public.control_case_interventions for select to authenticated
  using (app.has_active_account());

create function public.append_control_case_intervention(
  p_case_id uuid,p_payload jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path = public,app,pg_temp as $$
declare
  current_case public.control_cases%rowtype;
  prior public.control_case_interventions%rowtype;
  event_time timestamptz;
  kind text;
  details text;
  outcome text;
  technician text;
  reference_text text;
  new_id uuid;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Sessão, chamado, operação e intervenção válidos são necessários.';
  end if;
  event_time := nullif(p_payload->>'occurredAt','')::timestamptz;
  kind := btrim(coalesce(p_payload->>'type',''));
  details := btrim(coalesce(p_payload->>'description',''));
  outcome := btrim(coalesce(p_payload->>'result',''));
  technician := btrim(coalesce(p_payload->>'technicalAuthor',''));
  reference_text := btrim(coalesce(p_payload->>'referenceNote',''));
  if event_time is null or event_time > now()+interval '5 minutes'
    or kind not in ('Inspeção','Diagnóstico','Limpeza','Configuração',
      'Atualização','Reparo','Troca de componente','Teste funcional',
      'Teste de estabilidade','Envio externo','Retorno','Outro')
    or char_length(details) not between 3 and 2000
    or char_length(outcome) not between 3 and 2000
    or char_length(technician) > 160
    or char_length(reference_text) > 500 then
    raise exception 'Data, tipo ou conteúdo da intervenção inválidos.';
  end if;
  select * into current_case from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if current_case.table_id is null or
    not coalesce(app.can_manage_module_table(current_case.table_id,'control','update'),false) then
    raise exception 'Sem permissão para registrar intervenção.';
  end if;
  select * into prior from public.control_case_interventions where request_id=p_request_id;
  if found then
    if prior.case_id <> p_case_id or prior.occurred_at <> event_time
      or prior.intervention_type <> kind or prior.description <> details
      or prior.result <> outcome or prior.technical_author <> technician
      or prior.reference_note <> reference_text then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('id',prior.id,'alreadyApplied',true);
  end if;
  if current_case.ticket_state in ('Concluído','Cancelado') then
    raise exception 'Chamado encerrado não aceita nova intervenção.';
  end if;
  insert into public.control_case_interventions(case_id,request_id,occurred_at,
    intervention_type,description,result,contextual_state,technical_author,
    reference_note,recorded_by)
  values(p_case_id,p_request_id,event_time,kind,details,outcome,
    current_case.ticket_state,technician,reference_text,auth.uid())
  returning id into new_id;
  return jsonb_build_object('id',new_id,'alreadyApplied',false);
end;
$$;
revoke all on function public.append_control_case_intervention(uuid,jsonb,uuid)
  from public,anon;
grant execute on function public.append_control_case_intervention(uuid,jsonb,uuid)
  to authenticated;

create function public.recent_control_case_interventions()
returns jsonb language plpgsql stable security definer
set search_path = public,app,pg_temp as $$
declare result jsonb;
begin
  if auth.uid() is null or not app.has_active_account() then
    raise exception 'Conta ativa necessária para consultar intervenções.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.occurred_at desc,r.id desc),'[]'::jsonb)
    into result from (
      select x.id,x.case_id as "caseId",c.control_item_id as "controlItemId",
        c.table_id as "tableId",c.equipment,c.tag,x.intervention_type as "type",
        x.description,x.result,x.technical_author as "technicalAuthor",x.occurred_at
      from public.control_case_interventions x
      join public.control_cases c on c.id=x.case_id
      order by x.occurred_at desc,x.id desc limit 6
    ) r;
  return result;
end;
$$;
revoke all on function public.recent_control_case_interventions() from public,anon;
grant execute on function public.recent_control_case_interventions() to authenticated;
commit;
