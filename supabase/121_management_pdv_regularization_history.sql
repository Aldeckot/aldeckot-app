-- Inclui correções cadastrais e regularizações após retorno no histórico do PDV.
-- Conserva a consulta por positionIds do evento original e não cria movimentos.
begin;

create or replace function public.management_movement_history(
  p_computer_id uuid default null, p_position_id uuid default null
) returns table (
  event_id uuid, occurred_at timestamptz, action text, reason text,
  metadata jsonb, processing_result jsonb
) language sql stable security invoker set search_path = public as $$
  select e.id, e.created_at, e.action, e.reason, e.metadata, e.processing_result
  from public.equipment_events e
  where (
    e.source_module = 'management'
    and ((p_computer_id is not null
      and e.metadata -> 'computerIds' @> jsonb_build_array(p_computer_id))
      or (p_position_id is not null
        and e.metadata -> 'positionIds' @> jsonb_build_array(p_position_id)))
  ) or (
    e.source_module = 'inventory'
    and e.action in ('peripheral-transfer', 'Correção cadastral de local',
      'Regularização após retorno')
    and p_position_id is not null
    and e.metadata -> 'positionIds' @> jsonb_build_array(p_position_id)
  )
  order by e.created_at desc, e.id desc limit 100;
$$;

revoke all on function public.management_movement_history(uuid, uuid) from public;
grant execute on function public.management_movement_history(uuid, uuid) to authenticated;

commit;
