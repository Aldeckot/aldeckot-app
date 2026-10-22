-- Impede que uma chamada direta da RPC use como substituto um PC já
-- instalado em outro PDV. Não altera dados ou eventos existentes.
begin;

do $$
begin
  if to_regprocedure('public.management_move_computer(uuid,jsonb)') is null then
    raise exception 'A migração 088 deve estar instalada antes da 089.';
  end if;
  if to_regprocedure('public.management_move_computer_core(uuid,jsonb)') is not null then
    raise exception 'A função interna de movimentação já existe; verifique a 089 antes de reaplicar.';
  end if;
end;
$$;

alter function public.management_move_computer(uuid, jsonb)
  rename to management_move_computer_core;

-- A implementação original permanece privada. Somente a função pública
-- abaixo pode chamá-la com as novas validações.
revoke all on function public.management_move_computer_core(uuid, jsonb)
  from public, authenticated;

create function public.management_move_computer(
  p_operation_id uuid, p_plan jsonb
) returns jsonb language plpgsql security definer
  set search_path = public, app, pg_temp as $$
declare
  mode_name text := p_plan ->> 'mode';
  source_id uuid := nullif(p_plan ->> 'sourceId', '')::uuid;
  target_id uuid := nullif(p_plan ->> 'targetId', '')::uuid;
  outgoing_id uuid := nullif(p_plan ->> 'outgoingDestinationId', '')::uuid;
  incoming_status text := btrim(coalesce(p_plan ->> 'incomingStatus', ''));
  source_row public.module_records%rowtype;
  target_row public.module_records%rowtype;
  locked_row record;
begin
  -- O núcleo continua responsável pela validação estrutural e idempotência.
  if p_operation_id is null or p_plan is null
    or jsonb_typeof(p_plan) <> 'object' then
    return public.management_move_computer_core(p_operation_id, p_plan);
  end if;

  -- Mesma trava da 088: um reenvio aguarda o primeiro commit antes de
  -- consultar o evento já aplicado. O núcleo confere se o plano é idêntico.
  perform pg_advisory_xact_lock(89188, hashtext(p_operation_id::text));
  if exists (
    select 1 from public.equipment_events e
    where e.source_module = 'management'
      and e.source_event_key = p_operation_id::text
  ) then
    return public.management_move_computer_core(p_operation_id, p_plan);
  end if;

  -- A 088 bloqueia as posições na ordem de UUID. Preservar a mesma ordem
  -- para revalidar o estado atual sem introduzir impasses concorrentes.
  for locked_row in
    select r.id from public.module_records r
    where r.id = any(array[source_id, target_id, outgoing_id])
    order by r.id for update
  loop null; end loop;

  select r.* into source_row from public.module_records r
  join public.module_tables t on t.id = r.table_id
  where r.id = source_id and t.module = 'management';
  if target_id is not null then
    select r.* into target_row from public.module_records r
    where r.id = target_id and r.table_id = source_row.table_id;
  end if;

  if mode_name in ('replace-other', 'be-replaced')
    and source_row.payload ->> 'terminal' ~* '^PDV[[:space:]]+[0-9]+$' then
    raise exception 'O substituto já ocupa outro PDV. Escolha um computador disponível.';
  end if;
  if mode_name in ('replace-other', 'be-replaced')
    and coalesce(source_row.payload ->> 'status', '') not in ('Ativo', 'Reserva') then
    raise exception 'O substituto não está disponível para instalação no PDV.';
  end if;
  if target_row.payload ->> 'terminal' ~* '^PDV[[:space:]]+[0-9]+$'
    and incoming_status <> 'Ativo' then
    raise exception 'O computador instalado no PDV deve terminar como Ativo.';
  end if;

  return public.management_move_computer_core(p_operation_id, p_plan);
end;
$$;

revoke all on function public.management_move_computer(uuid, jsonb) from public;
grant execute on function public.management_move_computer(uuid, jsonb)
  to authenticated;

notify pgrst, 'reload schema';

commit;
