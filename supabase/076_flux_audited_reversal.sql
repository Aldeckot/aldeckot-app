-- ALDECKOT | Estorno auditável apenas de envios revisados e sem efeitos posteriores.
-- Aplicar após 075. Registros antigos e chamados preexistentes não são revertidos por inferência.
begin;

alter table public.control_items drop constraint if exists control_items_status_check;
alter table public.control_items add constraint control_items_status_check
  check (status in ('Em manutenção', 'Manutenção concluída', 'Aguardando avaliação',
    'Em uso', 'Em sala', 'Descartado', 'Cancelado'));
alter table public.flux_reviewed_movements
  add column if not exists reversal_request_id uuid unique;

create or replace function app.guard_reversed_flux_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.flux_reviewed_movements
    where flux_item_id = old.id and reversed_event_id is not null) then
    raise exception 'Movimentação estornada é histórica e não pode ser alterada ou excluída.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists reversed_flux_movement_guard on public.flux_items;
create trigger reversed_flux_movement_guard
  before update or delete on public.flux_items
  for each row execute function app.guard_reversed_flux_movement();

create or replace function app.guard_cancelled_control_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Cancelado' then
      raise exception 'Um chamado novo não pode iniciar como Cancelado.';
    end if;
    return new;
  end if;
  if (new.status = 'Cancelado' or old.status = 'Cancelado') and
     old.status is distinct from new.status and
     coalesce(current_setting('app.control_completion_event', true), '') = '' then
    raise exception 'O cancelamento auditável do chamado deve ocorrer pelo estorno no Flux.';
  end if;
  return new;
end; $$;
drop trigger if exists cancelled_control_status_guard on public.control_items;
create trigger cancelled_control_status_guard
  before insert or update of status on public.control_items
  for each row execute function app.guard_cancelled_control_status();

create or replace function public.flux_preview_reversal(p_flux_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  receipt public.flux_reviewed_movements%rowtype;
  movement public.flux_items%rowtype;
  ticket public.control_items%rowtype;
  current_status text;
  current_updated timestamptz;
  current_tag text;
  current_serial text;
  origin_table uuid;
  actor_name text;
begin
  if auth.uid() is null or p_flux_item_id is null or
     not coalesce(app.can_manage_module('flux', 'update'), false) then
    raise exception 'Sem permissão para consultar o estorno.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id;
  if not found then return jsonb_build_object('eligible', false, 'reason', 'Movimentação não encontrada.'); end if;
  if not coalesce(app.can_manage_module_table(movement.table_id, 'flux', 'update'), false) then
    raise exception 'Sem permissão para estornar esta movimentação.';
  end if;
  select * into receipt from public.flux_reviewed_movements
    where flux_item_id = p_flux_item_id and is_creation
    order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('eligible', false,
      'reason', 'Este registro não possui revisão de criação; não é seguro inferir o estado anterior.');
  end if;
  if receipt.reversed_event_id is not null then
    return jsonb_build_object('eligible', false, 'reason', 'Movimentação já estornada.');
  end if;
  if movement.movement <> 'Envio' or movement.reason <> 'Manutenção' or
     receipt.source_module not in ('inventory', 'management') or
     receipt.source_status_before is null or
     receipt.source_status_before = 'Manutenção' or
     receipt.control_preexisting or receipt.control_item_id is null then
    return jsonb_build_object('eligible', false,
      'reason', 'Somente envio novo para manutenção, com origem e chamado criados nesta operação, admite estorno automático.');
  end if;
  if movement.updated_at is distinct from receipt.flux_updated_at_after or
     movement.source_module is distinct from receipt.source_module or
     movement.source_record_id is distinct from receipt.source_record_id then
    return jsonb_build_object('eligible', false,
      'reason', 'A movimentação foi alterada depois do envio. Revise o histórico antes de corrigir manualmente.');
  end if;
  if receipt.source_module = 'inventory' then
    select table_id, status, updated_at, tag, serial
      into origin_table, current_status, current_updated, current_tag, current_serial
      from public.inventory_items where id = receipt.source_record_id;
  else
    select r.table_id, r.payload->>'status', r.updated_at,
      r.payload->>'tag', coalesce(r.payload->>'serial', r.payload->>'numeroSerie')
      into origin_table, current_status, current_updated, current_tag, current_serial
      from public.module_records r join public.module_tables t on t.id = r.table_id
      where r.id = receipt.source_record_id and t.module = 'management';
  end if;
  if origin_table is null or current_status is distinct from 'Manutenção' or
     current_updated is distinct from receipt.source_updated_at_after or
     lower(btrim(coalesce(current_tag, ''))) is distinct from lower(btrim(movement.tag)) or
     lower(btrim(coalesce(current_serial, ''))) is distinct from lower(btrim(movement.serial)) then
    return jsonb_build_object('eligible', false,
      'reason', 'O equipamento mudou após o envio. Não é seguro restaurar o status automaticamente.');
  end if;
  select * into ticket from public.control_items where id = receipt.control_item_id;
  if not found or ticket.status <> 'Em manutenção' or
     ticket.updated_at is distinct from receipt.control_updated_at_after or
     (receipt.source_module = 'inventory' and ticket.inventory_item_id is distinct from receipt.source_record_id) or
     (receipt.source_module = 'management' and ticket.management_record_id is distinct from receipt.source_record_id) then
    return jsonb_build_object('eligible', false,
      'reason', 'O chamado mudou após o envio. Não é seguro cancelá-lo automaticamente.');
  end if;
  if not coalesce(app.can_manage_module_table(origin_table, receipt.source_module, 'update'), false) or
     not coalesce(app.can_manage_module_table(ticket.table_id, 'control', 'update'), false) then
    return jsonb_build_object('eligible', false,
      'reason', 'Sem permissão para restaurar o equipamento e cancelar o chamado.');
  end if;
  if exists (select 1 from public.flux_items f where f.id <> movement.id
      and f.source_module = receipt.source_module and f.source_record_id = receipt.source_record_id
      and f.created_at > receipt.created_at) or
     exists (select 1 from public.flux_item_logs l
       where l.flux_item_id = movement.id and l.created_at > receipt.created_at) or
     exists (select 1 from public.control_item_logs l
       where l.control_item_id = ticket.id and l.created_at > receipt.created_at) or
     (receipt.source_module = 'inventory' and exists (
       select 1 from public.inventory_item_logs l
       where l.inventory_item_id = receipt.source_record_id and l.created_at > receipt.created_at)) then
    return jsonb_build_object('eligible', false,
      'reason', 'Há movimentações ou registros posteriores. O estorno automático foi bloqueado para preservar o histórico.');
  end if;
  select nullif(btrim(display_name), '') into actor_name
    from public.profiles where id = receipt.actor_id;
  return jsonb_build_object('eligible', true,
    'token', md5(receipt.request_id::text || ':' || movement.updated_at::text || ':' ||
      current_updated::text || ':' || ticket.updated_at::text),
    'equipment', movement.equipment, 'tag', movement.tag, 'serial', movement.serial,
    'movement', movement.movement || ' para ' || movement.reason,
    'createdAt', movement.created_at, 'actorName', coalesce(actor_name, 'Usuário autenticado'),
    'sourceModule', receipt.source_module, 'originalEventId', receipt.event_id,
    'currentStatus', current_status, 'restoredStatus', receipt.source_status_before,
    'controlItemId', ticket.id, 'consequence', 'Restaurar o status anterior e cancelar o chamado, preservando ambos os históricos.');
end; $$;

create or replace function public.flux_reverse_movement(
  p_flux_item_id uuid, p_review_token text, p_request_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  receipt public.flux_reviewed_movements%rowtype;
  movement public.flux_items%rowtype;
  ticket public.control_items%rowtype;
  preview jsonb;
  reversal_event_id uuid;
  log_text text;
  computer_payload jsonb;
  source_table uuid;
begin
  if auth.uid() is null or p_request_id is null or
     nullif(btrim(coalesce(p_reason, '')), '') is null or
     char_length(btrim(p_reason)) > 500 then
    raise exception 'Informe um motivo de estorno de até 500 caracteres.';
  end if;
  select * into receipt from public.flux_reviewed_movements
    where flux_item_id = p_flux_item_id and is_creation
    order by created_at desc limit 1 for update;
  if not found then raise exception 'Movimentação sem registro de revisão; estorno automático indisponível.'; end if;
  if receipt.reversed_event_id is not null then
    if receipt.reversal_request_id = p_request_id then
      return jsonb_build_object('status', 'already-applied', 'eventId', receipt.reversed_event_id);
    end if;
    raise exception 'Esta movimentação já foi estornada.';
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if receipt.source_module = 'inventory' then
    perform 1 from public.inventory_items where id = receipt.source_record_id for update;
  elsif receipt.source_module = 'management' then
    perform 1 from public.module_records where id = receipt.source_record_id for update;
  end if;
  select * into ticket from public.control_items where id = receipt.control_item_id for update;
  preview := public.flux_preview_reversal(p_flux_item_id);
  if preview->>'eligible' is distinct from 'true' or
     preview->>'token' is distinct from p_review_token then
    raise exception 'O estado mudou desde a revisão. Nenhuma alteração foi feita. %',
      coalesce(preview->>'reason', 'Revise o estorno novamente.');
  end if;
  select table_id into source_table from public.module_tables
    where id = case when receipt.source_module = 'inventory'
      then (select table_id from public.inventory_items where id = receipt.source_record_id)
      else (select table_id from public.module_records where id = receipt.source_record_id) end;
  if not coalesce(app.can_manage_module_table(movement.table_id, 'flux', 'update'), false) or
     not coalesce(app.can_manage_module_table(source_table, receipt.source_module, 'update'), false) or
     not coalesce(app.can_manage_module_table(ticket.table_id, 'control', 'update'), false) then
    raise exception 'Sem permissão para estornar nos módulos envolvidos.';
  end if;
  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     previous_status, new_status, reason, affected_modules, metadata, actor_id)
    values ('flux', 'reversal:' || receipt.request_id::text, movement.id,
      movement.inventory_item_id, 'Estorno de movimentação', 'Manutenção',
      receipt.source_status_before, btrim(p_reason),
      jsonb_build_array('flux', receipt.source_module, 'control'),
      jsonb_build_object('originalEventId', receipt.event_id,
        'originalRequestId', receipt.request_id, 'controlItemId', ticket.id,
        'sourceModule', receipt.source_module, 'sourceRecordId', receipt.source_record_id), auth.uid())
    returning id into reversal_event_id;
  log_text := left(format(
    'ESTORNO DE MOVIMENTAÇÃO. Flux: %s. Evento original: %s. Evento de estorno: %s. Motivo: %s. Solicitado por: %s. Status: Manutenção → %s. Chamado: Cancelado.',
    movement.id, receipt.event_id, reversal_event_id, btrim(p_reason), auth.uid(),
    receipt.source_status_before), 500);
  perform set_config('app.control_completion_event', reversal_event_id::text, true);
  perform set_config('app.control_completion_skip_log_copy', 'on', true);
  if receipt.source_module = 'inventory' then
    update public.inventory_items set status = receipt.source_status_before
      where id = receipt.source_record_id;
    insert into public.inventory_item_logs
      (inventory_item_id, action, message, source_module, source_log_id, event_id)
      values (receipt.source_record_id, 'update', log_text, 'flux', reversal_event_id,
        reversal_event_id);
  else
    select payload into computer_payload from public.module_records
      where id = receipt.source_record_id;
    update public.module_records set payload = jsonb_set(
      jsonb_set(jsonb_set(computer_payload, '{status}', to_jsonb(receipt.source_status_before), true),
        '{logs}', (case when jsonb_typeof(computer_payload->'logs') = 'array'
          then computer_payload->'logs' else '[]'::jsonb end) ||
          jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text,
            'at', now(), 'text', log_text, 'sourceModule', 'flux',
            'sourceId', movement.id::text, 'eventId', reversal_event_id::text)), true),
      '{lastActivity}', to_jsonb(log_text), true)
      where id = receipt.source_record_id;
  end if;
  update public.control_items set status = 'Cancelado' where id = ticket.id;
  insert into public.control_item_logs (control_item_id, action, message, event_id)
    values (ticket.id, 'update', log_text, reversal_event_id);
  insert into public.flux_item_logs (flux_item_id, action, message, event_id)
    values (movement.id, 'restore', log_text, reversal_event_id);
  update public.flux_reviewed_movements
    set reversed_event_id = reversal_event_id, reversal_request_id = p_request_id
    where request_id = receipt.request_id;
  insert into public.equipment_event_effects (event_id, module, status, attempts, processed_at)
    values (reversal_event_id, 'flux', 'applied', 1, now()),
           (reversal_event_id, receipt.source_module, 'applied', 1, now()),
           (reversal_event_id, 'control', 'applied', 1, now());
  update public.equipment_events set processing_result = jsonb_build_object(
    'status', 'applied', 'fluxItemId', movement.id, 'controlItemId', ticket.id,
    'restoredStatus', receipt.source_status_before)
    where id = reversal_event_id;
  insert into public.sync_events (module, operation, details, event_id)
    values ('flux', 'restore', jsonb_build_object('itemId', movement.id,
        'description', log_text), reversal_event_id),
      (receipt.source_module, 'update', jsonb_build_object('itemId', receipt.source_record_id,
        'status', receipt.source_status_before, 'description', log_text), reversal_event_id),
      ('control', 'update', jsonb_build_object('itemId', ticket.id,
        'status', 'Cancelado', 'description', log_text), reversal_event_id);
  perform set_config('app.control_completion_skip_log_copy', '', true);
  perform set_config('app.control_completion_event', '', true);
  return jsonb_build_object('status', 'applied', 'eventId', reversal_event_id,
    'restoredStatus', receipt.source_status_before);
end; $$;

revoke all on function public.flux_preview_reversal(uuid) from public, anon;
grant execute on function public.flux_preview_reversal(uuid) to authenticated;
revoke all on function public.flux_reverse_movement(uuid, text, uuid, text) from public, anon;
grant execute on function public.flux_reverse_movement(uuid, text, uuid, text) to authenticated;
commit;
