-- ALDECKOT | Etapa 10: reabertura manual de chamados resolvidos.
-- A conclusão é terminal; reabrir nunca é uma consequência de sincronização.
begin;

do $preflight$
begin
  if to_regclass('public.control_cases') is null
    or to_regclass('public.control_case_transitions') is null
    or to_regprocedure('public.transition_control_case(uuid,text,text,uuid)') is null then
    raise exception 'As migrações de chamados e transições devem estar aplicadas antes da 103.';
  end if;
end;
$preflight$;

create function public.reopen_control_case(
  p_case_id uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,app,pg_temp as $$
declare
  current_case public.control_cases%rowtype;
  prior public.control_case_transitions%rowtype;
  clean_reason text:=btrim(coalesce(p_reason,''));
  result jsonb;
begin
  if auth.uid() is null or not app.has_active_account()
    or p_case_id is null or p_request_id is null
    or char_length(clean_reason) not between 3 and 2000 then
    raise exception 'Conta ativa, chamado e motivo de reabertura (3 a 2000 caracteres) são necessários.';
  end if;
  select * into prior from public.control_case_transitions where request_id=p_request_id;
  if found then
    if prior.case_id<>p_case_id or prior.next_state<>'Em diagnóstico'
      or prior.reason<>clean_reason or prior.previous_state<>'Resolvido' then
      raise exception 'Identificador de operação já usado com outros dados.';
    end if;
    return jsonb_build_object('caseId',p_case_id,'state','Em diagnóstico',
      'eventId',prior.event_id,'reopened',true,'alreadyApplied',true);
  end if;
  select * into current_case from public.control_cases where id=p_case_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if current_case.ticket_state<>'Resolvido' then
    raise exception 'Somente um chamado resolvido pode ser reaberto; chamados concluídos ou cancelados não reabrem.';
  end if;
  if current_case.table_id is null or
    not coalesce(app.can_manage_module_table(current_case.table_id,'control','update'),false) then
    raise exception 'Sem permissão para reabrir este chamado.';
  end if;
  result:=public.transition_control_case(p_case_id,'Em diagnóstico',clean_reason,p_request_id);
  return result || jsonb_build_object('reopened',true,'state','Em diagnóstico');
end;
$$;
revoke all on function public.reopen_control_case(uuid,text,uuid) from public,anon;
grant execute on function public.reopen_control_case(uuid,text,uuid) to authenticated;

comment on function public.reopen_control_case(uuid,text,uuid) is
  'Ação manual e idempotente: reabre somente Resolvido para Em diagnóstico; preserva datas, motivo e trilha na transição. Concluído e Cancelado são terminais.';
commit;
