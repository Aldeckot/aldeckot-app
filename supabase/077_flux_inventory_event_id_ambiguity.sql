-- ALDECKOT | Corrige a variável de evento do gatilho patrimonial do Flux.
-- A coluna event_id foi acrescentada em 063; o gatilho redefinido em 072
-- manteve uma variável homônima, tornando "where id = event_id" ambíguo.
-- Não altera dados nem reconcilia movimentações antigas.
begin;

create or replace function app.sync_flux_maintenance_to_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
declare item public.inventory_items%rowtype; matching_count integer;
  previous_event public.equipment_sync_events%rowtype; v_sync_event_id uuid;
  control_changed boolean := false;
begin
  if new.source_module = 'management' then
    if exists (select 1 from public.equipment_sync_events
      where source_module = 'flux' and source_id = new.id and event_type = 'maintenance') then
      raise exception 'A origem de uma manutenção já processada no Inventário não pode ser alterada.';
    end if;
    if new.reason = 'Manutenção' and new.movement = 'Envio' then
      perform app.process_flux_management_maintenance(new.id);
    elsif exists (select 1 from public.equipment_events
      where source_module = 'flux' and source_event_key = 'management-maintenance:' || new.id::text) then
      raise exception 'A movimentação de manutenção da Gestão TI já foi processada e não pode trocar de finalidade.';
    end if;
    return new;
  end if;
  if exists (select 1 from public.equipment_events
    where source_module = 'flux' and source_event_key = 'management-maintenance:' || new.id::text) then
    raise exception 'A origem de uma manutenção já processada na Gestão TI não pode ser alterada.';
  end if;
  -- Caminho patrimonial da migração 061 preservado sem mudanças de regra.
  select * into previous_event from public.equipment_sync_events
    where source_module = 'flux' and source_id = new.id and event_type = 'maintenance';
  if previous_event.id is not null then
    if lower(btrim(new.tag)) <> lower(btrim(previous_event.tag)) or new.reason <> 'Manutenção' then
      raise exception 'Movimentação de manutenção já processada para a TAG %. Altere o patrimônio no Inventário.', previous_event.tag;
    end if;
    return new;
  end if;
  if new.reason <> 'Manutenção' or new.movement <> 'Envio' then return new; end if;
  if nullif(btrim(new.tag),'') is null or btrim(new.tag) in ('-','***') then
    raise exception 'Informe uma TAG real do equipamento para manutenção.';
  end if;
  select count(*) into matching_count from public.inventory_items
    where lower(btrim(tag)) = lower(btrim(new.tag));
  if matching_count = 0 then
    if new.source_module = 'inventory' then
      raise exception 'Equipamento TAG % não localizado no Inventário. Evento não processado.', new.tag;
    end if;
    raise exception 'Equipamento TAG % sem origem válida para manutenção. Pesquise e selecione um item do Inventário ou da Gestão TI.', new.tag;
  elsif matching_count > 1 then
    raise exception 'TAG % corresponde a mais de um equipamento no Inventário. Corrija a duplicidade antes de salvar.', new.tag;
  end if;
  select * into item from public.inventory_items
    where lower(btrim(tag)) = lower(btrim(new.tag)) for update;
  if item.status = 'Inativo' then
    raise exception 'Equipamento TAG % está Inativo no Inventário. Reative-o na fonte antes de abrir manutenção.', item.tag;
  end if;
  insert into public.equipment_sync_events
    (source_module, source_id, event_type, equipment_id, tag, old_status, new_status, effect_applied, actor_id)
  values ('flux', new.id, 'maintenance', item.id, item.tag, item.status, 'Manutenção',
    item.status is distinct from 'Manutenção', auth.uid())
  on conflict (source_module, source_id, event_type) do nothing returning id into v_sync_event_id;
  if v_sync_event_id is null then return new; end if;
  if item.status is distinct from 'Manutenção' then
    update public.inventory_items set status = 'Manutenção' where id = item.id;
    insert into public.inventory_item_logs
      (inventory_item_id, action, message, source_module, source_log_id)
    values (item.id, 'update', left(format(
      'Flux: %s -> Manutenção. TAG: %s. Destino: %s. Movimentação: %s.',
      item.status, item.tag, new.destination_company, new.id), 500), 'flux', new.id)
    on conflict (inventory_item_id, source_module, source_log_id)
      where source_module is not null and source_log_id is not null do nothing;
  end if;
  control_changed := app.sync_inventory_maintenance_to_control(item.id);
  if control_changed then
    update public.equipment_sync_events set effect_applied = true
      where public.equipment_sync_events.id = v_sync_event_id;
  end if;
  if item.status = 'Manutenção' and not control_changed then return new; end if;
  insert into public.sync_events (module, operation, details)
  values ('inventory', 'update', jsonb_build_object(
    'eventId', v_sync_event_id, 'sourceModule', 'flux', 'sourceId', new.id,
    'itemId', item.id, 'tableId', item.table_id, 'tag', item.tag,
    'oldStatus', item.status, 'status', 'Manutenção', 'controlChanged', control_changed,
    'description', format('Flux: %s enviado para manutenção.', item.tag),
    'targetUrl', format('inventory.html?table=%s&item=%s', item.table_id, item.id)));
  return new;
end; $$;

revoke all on function app.sync_flux_maintenance_to_inventory() from public, anon, authenticated;
commit;
