-- ALDECKOT | Corrige o unico chamado ativo cruzado confirmado na auditoria.
-- Aplicar apos 083. A base deve corresponder a rechecagem de 17/10/2026;
-- caso contrario, a transacao falha sem gravar nada.
-- Os dois chamados concluidos sem TAG/serie ficam intactos e nao verificaveis.
begin;

lock table public.control_items, public.module_records, public.module_tables
  in share row exclusive mode;

do $$
declare
  linked_count integer;
  repaired_count integer;
  ticket public.control_items%rowtype;
  previous_computer public.module_records%rowtype;
  correct_computer public.module_records%rowtype;
begin
  select count(*) into linked_count
  from public.control_items where management_record_id is not null;
  if linked_count <> 3 then
    raise exception 'Auditoria desatualizada: esperados 3 chamados vinculados, encontrados %.', linked_count;
  end if;

  if exists (
    select 1 from public.control_items
    where id = 'd144b81f-c8b4-4f3c-bc78-c99002a2250e'::uuid
  ) then
    raise exception 'O chamado do Caixa 05 reapareceu. Execute novamente a auditoria.';
  end if;

  if (
    select count(*) from public.control_items item
    where (item.id = 'bbb11d0a-c535-4df8-ba80-9971749cf2ec'::uuid
        and item.management_record_id = 'f99c884e-e40b-4d75-a054-66f636100f8e'::uuid)
       or (item.id = 'f825d8d4-68ff-47fc-9988-b08664bbdad2'::uuid
        and item.management_record_id = 'ef66540f-536f-458d-9651-6cac90841a08'::uuid)
  ) <> 2 or exists (
    select 1 from public.control_items item
    where item.id in (
      'bbb11d0a-c535-4df8-ba80-9971749cf2ec'::uuid,
      'f825d8d4-68ff-47fc-9988-b08664bbdad2'::uuid
    ) and (item.status is distinct from 'Manutenção concluída'
      or nullif(btrim(coalesce(item.tag, '')), '') is not null
      or nullif(btrim(coalesce(item.serial, '')), '') is not null)
  ) then
    raise exception 'Os dois chamados historicos sem identidade mudaram. Nada foi alterado.';
  end if;

  select item.* into ticket
  from public.control_items item
  join public.module_tables table_row
    on table_row.id = item.table_id and table_row.module = 'control'
  where item.id = '3e172c59-6e19-40a0-a3b0-d4f16d0d287b'::uuid;
  if not found
    or ticket.management_record_id is distinct from
      '820b2a99-a966-4f18-bd7a-21660e9803b7'::uuid
    or ticket.status is distinct from 'Em manutenção'
    or ticket.tag is distinct from 'AJPCCX10'
    or ticket.serial is distinct from '688BE5D4-76BD-4EC5-9CF9-942063E6054B' then
    raise exception 'O chamado ativo do Caixa 10 diverge da auditoria. Nada foi alterado.';
  end if;

  select record_row.* into previous_computer
  from public.module_records record_row
  join public.module_tables table_row
    on table_row.id = record_row.table_id and table_row.module = 'management'
  where record_row.id = ticket.management_record_id;
  if not found or not app.management_identity_matches(previous_computer.payload,
    'AJPCCX15', 'EEE07CC7-EBBF-4F12-B36C-C52E3CD267AD') then
    raise exception 'O registro atualmente vinculado nao e mais o Caixa 15.';
  end if;

  select record_row.* into correct_computer
  from public.module_records record_row
  join public.module_tables table_row
    on table_row.id = record_row.table_id and table_row.module = 'management'
  where record_row.id = '10f244e6-9257-4b53-b7e1-26a9589a6fcd'::uuid;
  if not found
    or not app.management_identity_matches(correct_computer.payload, ticket.tag, ticket.serial)
    or (select count(*)
        from public.module_records candidate
        join public.module_tables candidate_table on candidate_table.id = candidate.table_id
        where candidate_table.module = 'management'
          and app.management_identity_matches(candidate.payload, ticket.tag, ticket.serial)) <> 1 then
    raise exception 'A identidade do Caixa 10 nao e unica e confirmada. Nada foi alterado.';
  end if;

  update public.control_items
  set management_record_id = correct_computer.id
  where id = ticket.id
    and management_record_id = previous_computer.id;
  get diagnostics repaired_count = row_count;
  if repaired_count <> 1 then
    raise exception 'Esperada uma correcao de vinculo, efetuadas %; transacao cancelada.', repaired_count;
  end if;

  if exists (
    select 1
    from public.control_items item
    left join public.module_records record_row on record_row.id = item.management_record_id
    left join public.module_tables table_row on table_row.id = record_row.table_id
    where item.management_record_id is not null
      and item.status in ('Em manutenção', 'Aguardando avaliação')
      and (table_row.module is distinct from 'management'
        or not app.management_identity_matches(record_row.payload, item.tag, item.serial))
  ) then
    raise exception 'Ainda existe chamado ativo com identidade divergente; transacao cancelada.';
  end if;
end;
$$;

-- Novos chamados e reaberturas exigem identidade comprovada. Os dois chamados
-- antigos concluidos, sem TAG nem serie, so podem permanecer como estao;
-- nao se inventa uma identidade retroativa para o historico.
create or replace function app.guard_control_management_identity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  computer_payload jsonb;
begin
  if new.management_record_id is null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.id = new.id
      and old.management_record_id is not distinct from new.management_record_id
      and old.status is not distinct from new.status
      and new.status = 'Manutenção concluída'
      and nullif(btrim(coalesce(old.tag, '')), '') is null
      and nullif(btrim(coalesce(old.serial, '')), '') is null
      and nullif(btrim(coalesce(new.tag, '')), '') is null
      and nullif(btrim(coalesce(new.serial, '')), '') is null then
      return new;
    end if;
  end if;
  select record_row.payload into computer_payload
  from public.module_records record_row
  join public.module_tables table_row on table_row.id = record_row.table_id
  where record_row.id = new.management_record_id
    and table_row.module = 'management';
  if not found
    or not app.management_identity_matches(computer_payload, new.tag, new.serial) then
    raise exception 'O chamado nao corresponde a TAG e serie do computador vinculado.';
  end if;
  return new;
end;
$$;

drop trigger if exists control_management_identity_guard on public.control_items;
create trigger control_management_identity_guard
  before insert or update of management_record_id, tag, serial, status
  on public.control_items
  for each row execute function app.guard_control_management_identity();

create or replace function app.guard_management_control_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.control_items
    where management_record_id = new.id
  ) then return new; end if;

  if not exists (
    select 1 from public.module_tables
    where id = new.table_id and module = 'management'
  ) or exists (
    select 1 from public.control_items item
    where item.management_record_id = new.id
      and not (item.status = 'Manutenção concluída'
        and nullif(btrim(coalesce(item.tag, '')), '') is null
        and nullif(btrim(coalesce(item.serial, '')), '') is null)
      and not app.management_identity_matches(new.payload, item.tag, item.serial)
  ) then
    raise exception 'O computador possui chamado vinculado; preserve sua identidade ou reconcilie o chamado.';
  end if;
  return new;
end;
$$;

drop trigger if exists management_control_identity_guard on public.module_records;
create trigger management_control_identity_guard
  before update of table_id, payload
  on public.module_records
  for each row execute function app.guard_management_control_identity();

-- Gestao TI e a autoridade pelo status do PC; abrir/editar chamado nao pode
-- converter Defeito em Manutencao. A conclusao coordenada (073) permanece.
create or replace function app.sync_management_status_from_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  return new;
end;
$$;

commit;
