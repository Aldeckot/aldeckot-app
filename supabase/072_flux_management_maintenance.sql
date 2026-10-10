-- ALDECKOT | Envio Flux -> Gestão TI -> Controle TI.
-- Aplicar após 068 (e 063/044). Não reconcilia movimentações antigas.
begin;

create or replace function app.process_flux_management_maintenance(p_flux_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  computer public.module_records%rowtype;
  prior_event public.equipment_events%rowtype;
  maintenance_event_id uuid;
  control_item record;
  control_matches integer;
  old_status text;
  log_text text;
  control_log_text text;
  current_month text;
begin
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if not found or movement.source_module is distinct from 'management' or
     movement.source_record_id is null or movement.reason <> 'Manutenção' or
     movement.movement <> 'Envio' then
    raise exception 'Selecione um computador válido da Gestão TI para o envio de manutenção.';
  end if;

  select * into prior_event from public.equipment_events
    where source_module = 'flux' and source_event_key = 'management-maintenance:' || movement.id::text;
  if found then
    if prior_event.metadata->>'managementRecordId' is distinct from movement.source_record_id::text or
       prior_event.metadata->>'tag' is distinct from movement.tag or
       prior_event.metadata->>'serial' is distinct from movement.serial or
       not exists (select 1 from public.equipment_event_effects
         where event_id = prior_event.id and module = 'control' and status = 'applied') then
      raise exception 'A manutenção já foi processada com outra identidade ou está incompleta. Revise o evento %.', prior_event.id;
    end if;
    return;
  end if;

  select r.* into computer from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where r.id = movement.source_record_id for update of r;
  if not found then
    raise exception 'Computador de origem não encontrado na Gestão TI. Pesquise e selecione novamente.';
  end if;
  if lower(btrim(coalesce(computer.payload->>'tag', ''))) <> lower(btrim(movement.tag)) or
     lower(btrim(coalesce(computer.payload->>'serial', computer.payload->>'numeroSerie', ''))) <>
       lower(btrim(movement.serial)) then
    raise exception 'A TAG ou série do computador mudou na Gestão TI. Pesquise e selecione novamente.';
  end if;
  if btrim(movement.tag) in ('', '-', '***') or btrim(movement.serial) in ('', '-', '***') then
    raise exception 'Informe TAG e número de série reais do computador para manutenção.';
  end if;
  if exists (select 1 from public.module_records r
    join public.module_tables t on t.id = r.table_id and t.module = 'management'
    where r.id <> computer.id and
      (lower(btrim(coalesce(r.payload->>'tag', ''))) = lower(btrim(movement.tag)) or
       lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) =
         lower(btrim(movement.serial)))) then
    raise exception 'TAG ou série também identifica outro computador da Gestão TI. Corrija a duplicidade antes de salvar.';
  end if;
  if lower(btrim(coalesce(computer.payload->>'status', ''))) = 'inativo' then
    raise exception 'Computador inativo na Gestão TI. Reative-o na origem antes de abrir manutenção.';
  end if;

  current_month := app.current_control_maintenance_table_name();
  if not exists (select 1 from public.module_tables
    where module = 'control' and lower(btrim(name)) = lower(current_month)) then
    raise exception 'Crie a tabela % no Controle TI antes de enviar o computador para manutenção.', current_month;
  end if;

  -- A rotina existente reutiliza chamados por identidade. Recuse identidades
  -- conflitantes antes dela para não vincular outro computador por TAG/série.
  select count(*) into control_matches from public.control_items c
    where c.management_record_id = computer.id or
      lower(btrim(coalesce(c.tag, ''))) = lower(btrim(movement.tag)) or
      lower(btrim(coalesce(c.serial, ''))) = lower(btrim(movement.serial));
  if control_matches > 1 then
    raise exception 'TAG e série apontam para chamados diferentes no Controle TI. Corrija o vínculo antes de salvar.';
  end if;
  select id, management_record_id, tag, serial into control_item
    from public.control_items c where c.management_record_id = computer.id or
      lower(btrim(coalesce(c.tag, ''))) = lower(btrim(movement.tag)) or
      lower(btrim(coalesce(c.serial, ''))) = lower(btrim(movement.serial))
    limit 1 for update;
  if control_item.id is not null and
    (control_item.management_record_id is not null and control_item.management_record_id <> computer.id or
     lower(btrim(coalesce(control_item.tag, ''))) not in ('', '-', '***', lower(btrim(movement.tag))) or
     lower(btrim(coalesce(control_item.serial, ''))) not in ('', '-', '***', lower(btrim(movement.serial)))) then
    raise exception 'O chamado existente pertence a outra identidade no Controle TI. Corrija o vínculo antes de salvar.';
  end if;

  old_status := coalesce(computer.payload->>'status', 'Não informado');
  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     previous_status, new_status, origin_location, destination_location, reason,
     affected_modules, processing_result, metadata, actor_id)
  values ('flux', 'management-maintenance:' || movement.id::text, movement.id,
    movement.inventory_item_id, 'Envio para manutenção', old_status, 'Manutenção',
    movement.sender_company, movement.destination_company, movement.reason,
    '["flux","management","control"]'::jsonb, '{}'::jsonb,
    jsonb_build_object('fluxItemId', movement.id, 'managementRecordId', computer.id,
      'tag', movement.tag, 'serial', movement.serial, 'sendDate', movement.send_date,
      'senderResponsible', movement.sender_responsible), auth.uid())
  returning id into maintenance_event_id;

  log_text := left(format(
    'MOVIMENTAÇÃO — ENVIO PARA MANUTENÇÃO' || E'\n' ||
    'Equipamento: %s' || E'\n' || 'TAG: %s' || E'\n' || 'Número de série: %s' || E'\n' ||
    'Módulo de origem: Gestão TI' || E'\n' || 'Status anterior: %s' || E'\n' ||
    'Novo status: Manutenção' || E'\n' || 'Origem da operação: Flux' || E'\n' ||
    'Destino: %s' || E'\n' || 'Responsável: %s' || E'\n' ||
    'Data de envio: %s' || E'\n' || 'Motivo: %s' || E'\n' ||
    'Movimentação: %s' || E'\n' || 'Evento: %s',
    movement.equipment, movement.tag, movement.serial, old_status,
    movement.destination_company, movement.sender_responsible, movement.send_date,
    movement.reason, movement.id, maintenance_event_id), 500);

  -- O UPDATE aciona a sincronização Gestão TI -> Controle TI já instalada.
  -- A chamada explícita cobre status que já era Manutenção sem criar duplicatas.
  update public.module_records set payload = jsonb_set(
    jsonb_set(jsonb_set(computer.payload, '{status}', '"Manutenção"'::jsonb, true),
      '{logs}', coalesce(case when jsonb_typeof(computer.payload->'logs') = 'array'
        then computer.payload->'logs' else '[]'::jsonb end, '[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text,
          'at', now(), 'text', log_text, 'sourceModule', 'flux',
          'sourceId', movement.id::text, 'eventId', maintenance_event_id::text)), true),
    '{lastActivity}', to_jsonb(log_text), true)
    where id = computer.id;
  perform app.sync_management_record_to_control(computer.id,
    (select payload from public.module_records where id = computer.id));

  select c.id, c.table_id, c.status into control_item from public.control_items c
    join public.module_tables t on t.id = c.table_id and t.module = 'control'
    where c.management_record_id = computer.id for update of c;
  if control_item.id is null or control_item.status <> 'Em manutenção' or
    not exists (select 1 from public.module_tables t where t.id = control_item.table_id
      and lower(btrim(t.name)) = lower(current_month)) then
    raise exception 'O chamado do Controle TI não foi confirmado. Nenhuma alteração da movimentação será mantida.';
  end if;

  -- A função existente de logs é compatível com instalações que ainda usam owner_id.
  control_log_text := log_text;
  perform app.add_management_control_log(control_item.id, 'update', control_log_text);
  update public.control_item_logs set event_id = maintenance_event_id
    where control_item_id = control_item.id and message = control_log_text and event_id is null;
  insert into public.flux_item_logs (flux_item_id, action, message, event_id)
    values (movement.id, 'create', log_text, maintenance_event_id);
  insert into public.equipment_event_effects (event_id, module, status, attempts, processed_at)
    values (maintenance_event_id, 'flux', 'applied', 1, now()),
           (maintenance_event_id, 'management', 'applied', 1, now()),
           (maintenance_event_id, 'control', 'applied', 1, now());
  update public.equipment_events set processing_result = jsonb_build_object(
    'managementRecordId', computer.id, 'controlItemId', control_item.id,
    'status', 'applied') where id = maintenance_event_id;
  insert into public.sync_events (module, operation, details, event_id)
    values ('management', 'update', jsonb_build_object('sourceModule', 'flux',
      'sourceId', movement.id, 'itemId', computer.id, 'tag', movement.tag,
      'status', 'Manutenção', 'controlItemId', control_item.id,
      'description', format('Flux: %s enviado para manutenção.', movement.tag)),
      maintenance_event_id);
end; $$;

create or replace function app.sync_flux_maintenance_to_inventory() returns trigger
language plpgsql security definer set search_path = public as $$
declare item public.inventory_items%rowtype; matching_count integer;
  previous_event public.equipment_sync_events%rowtype; event_id uuid; control_changed boolean := false;
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
  on conflict (source_module, source_id, event_type) do nothing returning id into event_id;
  if event_id is null then return new; end if;
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
    update public.equipment_sync_events set effect_applied = true where id = event_id;
  end if;
  if item.status = 'Manutenção' and not control_changed then return new; end if;
  insert into public.sync_events (module, operation, details)
  values ('inventory', 'update', jsonb_build_object(
    'eventId', event_id, 'sourceModule', 'flux', 'sourceId', new.id,
    'itemId', item.id, 'tableId', item.table_id, 'tag', item.tag,
    'oldStatus', item.status, 'status', 'Manutenção', 'controlChanged', control_changed,
    'description', format('Flux: %s enviado para manutenção.', item.tag),
    'targetUrl', format('inventory.html?table=%s&item=%s', item.table_id, item.id)));
  return new;
end; $$;

drop trigger if exists flux_maintenance_inventory_sync on public.flux_items;
create trigger flux_maintenance_inventory_sync
  after insert or update of tag, serial, reason, movement, status,
    source_module, source_record_id, inventory_item_id on public.flux_items
  for each row execute function app.sync_flux_maintenance_to_inventory();
revoke all on function app.process_flux_management_maintenance(uuid) from public, anon, authenticated;
revoke all on function app.sync_flux_maintenance_to_inventory() from public, anon, authenticated;
commit;
