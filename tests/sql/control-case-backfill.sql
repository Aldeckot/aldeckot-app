do $$
begin
  if not exists (select 1 from public.control_cases where id =
      '00000000-0000-4000-8000-000000000021' and control_item_id = id
      and source_module = 'control' and source_id = id
      and ticket_state = 'Em manutenção' and not requires_review) then
    raise exception 'Migration 095 did not preserve the fictional legacy ticket';
  end if;
  if (select count(*) from public.control_case_transitions where case_id =
      '00000000-0000-4000-8000-000000000021' and source = 'backfill') <> 1 then
    raise exception 'Migration 095 did not record exactly one backfill transition';
  end if;
end $$;
