-- ALDECKOT | Etapa 10: resolução técnica estruturada antes da conclusão.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.control_case_transitions') is null
    or to_regprocedure('public.transition_control_case(uuid,text,text,uuid)') is null then
    raise exception 'A arquitetura e as transições de chamados devem estar aplicadas antes da 104.';
  end if;
end;
$preflight$;

create table public.control_case_resolutions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.control_cases(id) on delete restrict,
  request_id uuid not null unique,
  final_diagnosis text not null check (char_length(final_diagnosis) between 3 and 2000),
  solution text not null check (char_length(solution) between 3 and 2000),
  tests text not null check (char_length(tests) between 3 and 2000),
  final_condition text not null check (final_condition in ('Ativo','Reserva','Não se aplica')),
  observations text not null default '' check (char_length(observations) <= 2000),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index control_case_resolutions_history_idx
  on public.control_case_resolutions(case_id,created_at desc,id desc);
alter table public.control_case_resolutions enable row level security;
revoke all on public.control_case_resolutions from public,anon,authenticated;
grant select on public.control_case_resolutions to authenticated;
create policy "Contas ativas consultam resoluções"
  on public.control_case_resolutions for select to authenticated
  using (app.has_active_account());

create function public.resolve_control_case(
  p_case_id uuid,p_payload jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare
  c public.control_cases%rowtype;
  prior public.control_case_resolutions%rowtype;
  diagnosis text:=btrim(coalesce(p_payload->>'finalDiagnosis',''));
  solution_text text:=btrim(coalesce(p_payload->>'solution',''));
  tests_text text:=btrim(coalesce(p_payload->>'tests',''));
  condition_text text:=btrim(coalesce(p_payload->>'finalCondition',''));
  notes text:=btrim(coalesce(p_payload->>'observations',''));
  transition_result jsonb;
  resolution_id uuid;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or jsonb_typeof(p_payload) is distinct from 'object'
    or char_length(diagnosis) not between 3 and 2000
    or char_length(solution_text) not between 3 and 2000
    or char_length(tests_text) not between 3 and 2000
    or char_length(notes)>2000
    or condition_text not in ('Ativo','Reserva','Não se aplica') then
    raise exception 'Informe diagnóstico final, solução, testes, condição final e os limites válidos.';
  end if;
  select * into c from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if c.table_id is null or not coalesce(
    app.can_manage_module_table(c.table_id,'control','update'),false) then
    raise exception 'Sem permissão para resolver este chamado.';
  end if;
  if c.source_module='inventory' and condition_text not in ('Ativo','Reserva') then
    raise exception 'Para equipamento do Inventário, confirme a condição final como Ativo ou Reserva.';
  end if;
  select * into prior from public.control_case_resolutions where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.final_diagnosis<>diagnosis
      or prior.solution<>solution_text or prior.tests<>tests_text
      or prior.final_condition<>condition_text or prior.observations<>notes then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('id',prior.id,'caseId',p_case_id,
      'state','Resolvido','alreadyApplied',true);
  end if;
  if c.ticket_state in ('Resolvido','Concluído','Cancelado') then
    raise exception 'Chamado já resolvido ou encerrado; reabra manualmente antes de registrar nova resolução.';
  end if;
  insert into public.control_case_resolutions(case_id,request_id,final_diagnosis,
    solution,tests,final_condition,observations,actor_id)
  values(p_case_id,p_request_id,diagnosis,solution_text,tests_text,
    condition_text,notes,auth.uid()) returning id into resolution_id;
  transition_result:=public.transition_control_case(p_case_id,'Resolvido',
    left('Resolução registrada. Diagnóstico: '||diagnosis||' · Solução: '||solution_text,2000),
    p_request_id);
  update public.control_cases set solution=solution_text where id=p_case_id;
  return jsonb_build_object('id',resolution_id,'caseId',p_case_id,
    'state','Resolvido','alreadyApplied',false,'eventId',transition_result->'eventId');
end;
$$;
revoke all on function public.resolve_control_case(uuid,jsonb,uuid) from public,anon;
grant execute on function public.resolve_control_case(uuid,jsonb,uuid) to authenticated;

create function public.guard_control_case_resolution_before_completion()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.ticket_state='Concluído' and old.ticket_state is distinct from 'Concluído'
    and new.legacy_status is not distinct from old.legacy_status
    and not exists (select 1 from public.control_case_resolutions r where r.case_id=new.id) then
    raise exception 'Registre a resolução estruturada antes da conclusão formal.';
  end if;
  return new;
end;
$$;
create trigger zz_control_case_resolution_guard
  before update of ticket_state on public.control_cases
  for each row execute function public.guard_control_case_resolution_before_completion();

comment on table public.control_case_resolutions is
  'Registro imutável de diagnóstico final, solução, testes, condição confirmada e observações por ocorrência.';
comment on column public.control_case_resolutions.final_condition is
  'Condição técnica confirmada na resolução; registrar não altera automaticamente Inventário, PDV, localização ou movimentações.';
commit;
