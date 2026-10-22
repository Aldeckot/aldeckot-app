-- ALDECKOT | Identidade estavel do computador, separada da posicao fisica.
-- RASCUNHO: nao aplicar em producao ate substituir a restauracao de backup
-- que hoje apaga/reinsere posicoes e a RPC antiga de transferencia.
-- Aplicar apos 086 somente em homologacao. Nao movimenta PCs, perifericos,
-- chamados ou historicos. A transferencia legada e bloqueada.
begin;

lock table public.module_records, public.module_tables in share row exclusive mode;

do $$
declare
  position_count integer;
  computer_count integer;
begin
  select count(*), count(*) filter (
    where nullif(btrim(coalesce(r.payload ->> 'equipment', '')), '') is not null
  ) into position_count, computer_count
  from public.module_records r
  join public.module_tables t on t.id = r.table_id
  where t.module = 'management';
  if position_count <> 33 or computer_count <> 20 then
    raise exception 'Gestao TI mudou desde a auditoria: % posicoes e % computadores. Nenhuma alteracao aplicada.',
      position_count, computer_count;
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.module_records'::regclass
      and tgname = 'module_records_set_updated_at' and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.module_records'::regclass
      and tgname = 'management_pdv_peripheral_location_guard' and tgenabled <> 'D'
  ) then
    raise exception 'Gatilhos anteriores ausentes ou desativados. Nenhuma alteracao aplicada.';
  end if;
  if exists (
    select 1 from public.control_items c
    join public.module_records r on r.id = c.management_record_id
    join public.module_tables t on t.id = r.table_id
    where t.module = 'management'
      and (nullif(btrim(coalesce(c.tag, '')), '') is not null
        or nullif(btrim(coalesce(c.serial, '')), '') is not null)
      and not app.management_identity_matches(r.payload, c.tag, c.serial)
  ) then
    raise exception 'Ha chamado do Controle TI com identidade divergente. Execute nova auditoria.';
  end if;
end;
$$;

alter table public.module_records
  add column management_computer_id uuid;

-- Para cada PC atual, o ID inicial e o ID do seu registro atual. Assim
-- nenhuma TAG, serie ou nome e usado para inferir ou duplicar identidade.
-- O carimbo de ultima alteracao nao deve fingir uma edicao feita pelo usuario.
alter table public.module_records disable trigger module_records_set_updated_at;
update public.module_records r
set management_computer_id = r.id
from public.module_tables t
where t.id = r.table_id and t.module = 'management'
  and nullif(btrim(coalesce(r.payload ->> 'equipment', '')), '') is not null;
alter table public.module_records enable trigger module_records_set_updated_at;

alter table public.module_records
  add constraint module_records_management_computer_id_unique
  unique (management_computer_id) deferrable initially deferred;

create or replace function app.guard_management_computer_identity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_management boolean;
  was_management boolean := false;
  has_computer boolean;
  had_computer boolean := false;
  movement_allowed boolean :=
    current_setting('app.management_movement_in_progress', true) = 'on';
begin
  select t.module = 'management' into is_management
  from public.module_tables t where t.id = new.table_id;
  if tg_op = 'UPDATE' then
    select t.module = 'management' into was_management
    from public.module_tables t where t.id = old.table_id;
    had_computer := nullif(btrim(coalesce(old.payload ->> 'equipment', '')), '') is not null;
  end if;
  has_computer := nullif(btrim(coalesce(new.payload ->> 'equipment', '')), '') is not null;

  if current_setting('app.management_transfer_in_progress', true) = 'on' then
    raise exception 'Transferencia antiga desativada. Use a nova movimentacao de computadores.';
  end if;
  if movement_allowed then
    if (is_management and has_computer and new.management_computer_id is null)
      or ((not coalesce(is_management, false) or not has_computer)
        and new.management_computer_id is not null) then
      raise exception 'Identidade do computador nao corresponde a ocupacao da posicao.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and was_management is distinct from is_management
    and (had_computer or has_computer) then
    raise exception 'Computadores nao podem ser movidos entre modulos por edicao direta.';
  end if;
  if not coalesce(is_management, false) then
    if new.management_computer_id is not null then
      raise exception 'ID de computador exclusivo da Gestao TI.';
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.management_computer_id :=
      case when has_computer then gen_random_uuid() else null end;
    return new;
  end if;
  if had_computer then
    if not has_computer then
      raise exception 'Remocao de computador exige movimentacao com destino confirmado.';
    end if;
    if new.management_computer_id is distinct from old.management_computer_id
      or old.management_computer_id is null then
      raise exception 'A identidade do computador nao pode mudar por edicao direta.';
    end if;
  elsif has_computer then
    new.management_computer_id := gen_random_uuid();
  else
    new.management_computer_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists management_computer_identity_guard on public.module_records;
create trigger management_computer_identity_guard
  before insert or update of table_id, payload, management_computer_id
  on public.module_records
  for each row execute function app.guard_management_computer_identity();

-- A restauracao legada apaga e reinsere as posicoes em chamadas separadas.
-- Ela nao pode destruir uma identidade ou um PDV enquanto falta uma RPC
-- transacional de restauracao que preserve os IDs e vinculos externos.
create or replace function app.guard_management_position_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.module_tables t
    where t.id = old.table_id and t.module = 'management')
    and (old.management_computer_id is not null
      or btrim(coalesce(old.payload ->> 'terminal', '')) ~* '^PDV[[:space:]]+[0-9]+$') then
    raise exception 'Esta posicao possui identidade de PC ou PDV. Use uma restauracao transacional verificada.';
  end if;
  return old;
end;
$$;

drop trigger if exists management_position_delete_guard on public.module_records;
create trigger management_position_delete_guard
  before delete on public.module_records
  for each row execute function app.guard_management_position_delete();

do $$
begin
  if (select count(*) from public.module_records r
    join public.module_tables t on t.id = r.table_id
    where t.module = 'management'
      and r.management_computer_id is not null) <> 20
    or exists (
      select 1 from public.module_records r
      join public.module_tables t on t.id = r.table_id
      where t.module = 'management'
        and ((nullif(btrim(coalesce(r.payload ->> 'equipment', '')), '') is null)
          is distinct from (r.management_computer_id is null))
    ) then
    raise exception 'A atribuicao de identidade dos computadores falhou; transacao cancelada.';
  end if;
end;
$$;

commit;
