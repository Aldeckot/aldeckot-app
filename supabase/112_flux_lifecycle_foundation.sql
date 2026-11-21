-- ALDECKOT | Ciclos físicos do Flux. Aplicar após 111, primeiro em testes.
-- Não reconcilia nem altera a identidade de movimentações antigas.
begin;

alter table public.flux_items alter column received_date drop not null;
alter table public.flux_items drop constraint if exists flux_items_tag_check;
alter table public.flux_items add constraint flux_items_tag_check
  check (char_length(btrim(tag)) <= 160);
alter table public.flux_items drop constraint if exists flux_items_receiver_responsible_check;
alter table public.flux_items add constraint flux_items_receiver_responsible_check
  check (char_length(btrim(receiver_responsible)) <= 160);

alter table public.flux_items
  add column if not exists equipment_uid uuid default gen_random_uuid(),
  add column if not exists return_of uuid references public.flux_items(id) on delete restrict,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by text,
  add column if not exists delivery_carrier text,
  add column if not exists delivery_note text;
create unique index if not exists flux_one_return_per_send_idx
  on public.flux_items(return_of) where return_of is not null;
create index if not exists flux_equipment_uid_idx
  on public.flux_items(equipment_uid) where equipment_uid is not null;
alter table public.flux_items add constraint flux_return_is_entry_check
  check (return_of is null or movement = 'Recebimento');

create or replace function app.assign_flux_equipment_uid()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  existing_uid uuid;
  matching_count integer;
begin
  if new.return_of is not null then
    select equipment_uid into existing_uid from public.flux_items where id = new.return_of;
    if not found then raise exception 'Envio de origem não encontrado.'; end if;
    new.equipment_uid := coalesce(existing_uid, gen_random_uuid());
    return new;
  end if;
  if new.source_module is not null then
    if new.source_module = 'flux' then
      select equipment_uid into existing_uid from public.flux_items where id = new.source_record_id;
    else
      select count(distinct equipment_uid) into matching_count
        from public.flux_items
        where source_module = new.source_module and source_record_id = new.source_record_id
          and equipment_uid is not null;
      if matching_count > 1 then
        raise exception 'Identidade Flux ambígua para esta origem. Regularize antes de continuar.';
      end if;
      select equipment_uid into existing_uid from public.flux_items
        where source_module = new.source_module and source_record_id = new.source_record_id
          and equipment_uid is not null limit 1;
    end if;
    new.equipment_uid := coalesce(existing_uid, new.equipment_uid, gen_random_uuid());
    return new;
  end if;
  if new.movement = 'Envio' then
    if nullif(btrim(new.serial), '') is null then
      raise exception 'Número de série real é obrigatório para um equipamento novo.';
    end if;
    if exists (select 1 from public.inventory_items i where lower(btrim(i.serial)) = lower(btrim(new.serial))) or
       exists (select 1 from public.module_records r join public.module_tables t on t.id = r.table_id
         where t.module = 'management' and
           lower(btrim(coalesce(r.payload->>'serial', r.payload->>'numeroSerie', ''))) = lower(btrim(new.serial))) or
       exists (select 1 from public.flux_items f where lower(btrim(f.serial)) = lower(btrim(new.serial))) then
      raise exception 'Esta série já consta no sistema. Selecione o equipamento existente ou regularize a identidade.';
    end if;
  end if;
  new.equipment_uid := coalesce(new.equipment_uid, gen_random_uuid());
  return new;
end; $$;
create trigger flux_equipment_uid_on_insert before insert on public.flux_items
  for each row execute function app.assign_flux_equipment_uid();

create table public.flux_lifecycle_actions (
  request_id uuid primary key,
  flux_item_id uuid not null references public.flux_items(id) on delete restrict,
  kind text not null check (kind in ('delivery', 'return')),
  payload_hash text not null,
  linked_item_id uuid references public.flux_items(id) on delete restrict,
  event_id uuid not null references public.equipment_events(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(flux_item_id, kind)
);
create index flux_lifecycle_actions_event_idx on public.flux_lifecycle_actions(event_id);
alter table public.flux_lifecycle_actions enable row level security;
revoke all on public.flux_lifecycle_actions from public, anon, authenticated;
grant select on public.flux_lifecycle_actions to authenticated;
create policy "Contas ativas leem eventos do Flux" on public.flux_lifecycle_actions
  for select to authenticated using (app.has_active_account());

create or replace function public.flux_confirm_delivery(
  p_flux_item_id uuid, p_expected_updated_at timestamptz,
  p_request_id uuid, p_delivered_at timestamptz, p_received_by text,
  p_carrier text, p_notes text
) returns public.flux_items language plpgsql security definer set search_path = public as $$
declare
  movement public.flux_items%rowtype;
  prior public.flux_lifecycle_actions%rowtype;
  event_key uuid;
  payload_digest text;
  previous_status text;
begin
  if auth.uid() is null or p_flux_item_id is null or p_request_id is null or
     p_expected_updated_at is null or p_delivered_at is null or
     nullif(btrim(coalesce(p_received_by, '')), '') is null then
    raise exception 'Informe a movimentação, data e responsável pela entrega.';
  end if;
  if char_length(btrim(p_received_by)) > 160 or
     char_length(coalesce(p_carrier, '')) > 160 or
     char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'Dados de entrega ultrapassam o limite permitido.';
  end if;
  payload_digest := md5(concat_ws('|', p_flux_item_id, p_expected_updated_at,
    p_delivered_at, btrim(p_received_by), btrim(coalesce(p_carrier, '')),
    btrim(coalesce(p_notes, ''))));
  select * into prior from public.flux_lifecycle_actions where request_id = p_request_id;
  if found then
    if prior.kind <> 'delivery' or prior.flux_item_id <> p_flux_item_id or
       prior.payload_hash <> payload_digest or prior.actor_id <> auth.uid() then
      raise exception 'Esta confirmação já foi utilizada com outros dados.';
    end if;
    select * into movement from public.flux_items where id = prior.flux_item_id;
    return movement;
  end if;
  select * into movement from public.flux_items where id = p_flux_item_id for update;
  if not found or movement.movement <> 'Envio' then
    raise exception 'Envio não encontrado.';
  end if;
  if not coalesce(app.can_manage_module_table(movement.table_id, 'flux', 'update'), false) then
    raise exception 'Sem permissão para confirmar a entrega.';
  end if;
  if movement.updated_at is distinct from p_expected_updated_at then
    raise exception 'O envio mudou desde a prévia. Atualize e revise novamente.';
  end if;
  if movement.status not in ('Pendente', 'Em Trânsito') or
     exists (select 1 from public.flux_lifecycle_actions
       where flux_item_id = p_flux_item_id and kind = 'delivery') then
    raise exception 'A entrega já foi confirmada ou este envio não está pendente.';
  end if;
  if (p_delivered_at at time zone 'America/Sao_Paulo')::date < movement.send_date then
    raise exception 'A entrega não pode anteceder a data de envio.';
  end if;
  previous_status := movement.status;
  update public.flux_items set status = 'Entregue', delivered_at = p_delivered_at,
    delivered_by = btrim(p_received_by), delivery_carrier = btrim(coalesce(p_carrier, '')),
    delivery_note = btrim(coalesce(p_notes, ''))
    where id = movement.id returning * into movement;
  insert into public.equipment_events
    (source_module, source_event_key, source_id, inventory_item_id, action,
     previous_status, new_status, origin_location, destination_location,
     reason, affected_modules, metadata, actor_id)
  values ('flux', 'delivery:' || p_request_id::text, movement.id,
    movement.inventory_item_id, 'Entrega confirmada', previous_status, 'Entregue',
    movement.sender_company, movement.destination_company, movement.reason,
    '["flux"]'::jsonb,
    jsonb_build_object('fluxItemId', movement.id, 'equipmentUid', movement.equipment_uid,
      'deliveredAt', p_delivered_at, 'receivedBy', btrim(p_received_by),
      'carrier', btrim(coalesce(p_carrier, '')), 'notes', btrim(coalesce(p_notes, ''))),
    auth.uid()) returning id into event_key;
  insert into public.flux_item_logs(flux_item_id, action, message, event_id)
    values (movement.id, 'update',
      left('Entrega confirmada por ' || btrim(p_received_by) ||
        case when nullif(btrim(coalesce(p_carrier, '')), '') is null then ''
          else ' via ' || btrim(p_carrier) end || '.', 500), event_key);
  insert into public.flux_lifecycle_actions
    (request_id, flux_item_id, kind, payload_hash, event_id, actor_id)
    values (p_request_id, movement.id, 'delivery', payload_digest, event_key, auth.uid());
  return movement;
end; $$;

revoke all on function public.flux_confirm_delivery(uuid,timestamptz,uuid,timestamptz,text,text,text)
  from public, anon;
grant execute on function public.flux_confirm_delivery(uuid,timestamptz,uuid,timestamptz,text,text,text)
  to authenticated;

commit;
