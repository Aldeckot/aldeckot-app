import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Instancia descartavel; nenhum cliente Supabase e nenhuma credencial remota.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
const migrationFunction = (file, name) => {
  const source = readFileSync(resolve(root, `supabase/${file}`), 'utf8');
  const start = source.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`Função ${name} ausente de ${file}`);
  const end = source.indexOf('$$;', start);
  if (end < 0) throw new Error(`Fim da função ${name} ausente de ${file}`);
  return source.slice(start, end + 3);
};
const ids = {
  table: '10000000-0000-4000-8000-000000000000',
  controlTable: '10000000-0000-4000-8000-000000000099',
  reserve: '10000000-0000-4000-8000-000000000001',
  pdv01: '10000000-0000-4000-8000-000000000002',
  pdv02: '10000000-0000-4000-8000-000000000003',
  monitor: '30000000-0000-4000-8000-000000000001',
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const movement = async (operationId, plan) =>
  (await one('select public.management_move_computer($1::uuid,$2::jsonb) as result',
    [operationId, JSON.stringify(plan)])).result;
const positions = async () => (await db.query(`select id, payload, management_computer_id,
  updated_at from public.module_records where table_id=$1 order by position`, [ids.table])).rows;

async function schema() {
  await db.exec(`
    create schema app; create schema auth; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select '90000000-0000-4000-8000-000000000001'::uuid $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values(auth.uid());
    create table public.module_tables (
      id uuid primary key, module text not null, name text not null,
      created_at timestamptz not null default now()
    );
    create table public.inventory_items (
      id uuid primary key, table_id uuid, tag text not null,
      serial text not null default '', status text not null default 'Ativo',
      location text not null
    );
    create table public.module_records (
      id uuid primary key default gen_random_uuid(),
      table_id uuid not null references public.module_tables(id),
      payload jsonb not null default '{}'::jsonb,
      position integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.control_items (
      id uuid primary key default gen_random_uuid(),
      table_id uuid not null references public.module_tables(id),
      management_record_id uuid references public.module_records(id),
      inventory_item_id uuid, supply_unit_id uuid,
      equipment text not null default '', model text not null default '',
      brand text not null default '', sector text not null default '',
      entry_date date, exit_date date, cleaning_type text not null default '',
      notes text not null default '', position integer not null default 0,
      tag text not null default '', serial text not null default '',
      status text not null default 'Em manutenção',
      updated_at timestamptz not null default now()
    );
    create unique index control_items_management_record_unique
      on public.control_items(management_record_id) where management_record_id is not null;
    create table public.equipment_events (
      id uuid primary key default gen_random_uuid(),
      source_module text not null,
      source_event_key text not null,
      source_id uuid,
      inventory_item_id uuid,
      action text not null,
      previous_status text, new_status text,
      previous_location text, new_location text,
      previous_assignment text, new_assignment text,
      origin_location text, destination_location text, reason text,
      affected_modules jsonb not null default '[]'::jsonb,
      processing_result jsonb not null default '{}'::jsonb,
      metadata jsonb not null default '{}'::jsonb,
      actor_id uuid references auth.users(id),
      created_at timestamptz not null default timezone('utc', now()),
      unique(source_module,source_event_key)
    );
    create table public.equipment_event_effects (
      id uuid primary key default gen_random_uuid(),
      event_id uuid not null references public.equipment_events(id),
      module text not null, status text not null, attempts integer not null default 0,
      processed_at timestamptz, metadata jsonb not null default '{}'::jsonb,
      unique(event_id,module)
    );
    create table public.control_item_logs (
      id uuid primary key default gen_random_uuid(),
      control_item_id uuid not null references public.control_items(id),
      action text not null, message text not null,
      event_id uuid references public.equipment_events(id)
    );
    create table public.inventory_item_logs (
      id uuid primary key default gen_random_uuid(),
      inventory_item_id uuid not null references public.inventory_items(id),
      action text not null, message text not null,
      event_id uuid references public.equipment_events(id)
    );
    create table public.sync_events (
      id uuid primary key default gen_random_uuid(),
      module text not null, operation text not null,
      details jsonb not null, event_id uuid references public.equipment_events(id)
    );
    create function app.is_admin() returns boolean language sql stable as $$ select true $$;
    create function app.can_manage_module_table(uuid,text,text)
      returns boolean language sql stable as $$ select true $$;
    create function app.resolve_inventory_item_id(uuid,text,text)
      returns uuid language sql stable as $$ select null::uuid $$;
    create function app.management_identity_matches(p_payload jsonb, p_tag text, p_serial text)
    returns boolean language sql immutable as $$
      select (nullif(btrim(coalesce(p_tag,'')),'') is not null
          or nullif(btrim(coalesce(p_serial,'')),'') is not null)
        and (nullif(btrim(coalesce(p_tag,'')),'') is null
          or lower(btrim(p_payload->>'tag')) = lower(btrim(p_tag)))
        and (nullif(btrim(coalesce(p_serial,'')),'') is null
          or lower(btrim(p_payload->>'serial')) = lower(btrim(p_serial)))
    $$;
    create function app.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at := clock_timestamp(); return new; end; $$;
    create trigger module_records_set_updated_at before update on public.module_records
      for each row execute function app.set_updated_at();
    create function app.guard_pdv_peripheral() returns trigger language plpgsql as $$
    declare peripheral jsonb;
    begin
      if tg_op='UPDATE' and old.payload->>'terminal' like 'PDV %'
        and (new.payload->>'terminal' is distinct from old.payload->>'terminal'
          or new.payload->'peripherals' is distinct from old.payload->'peripherals') then
        raise exception 'Periferico ou posicao do PDV alterado.';
      end if;
      if new.payload->>'terminal' like 'PDV %' then
        for peripheral in select value from jsonb_array_elements(new.payload->'peripherals') loop
          if not exists(select 1 from public.inventory_items i
            where i.id::text=peripheral->>'sourceItemId'
              and i.tag=peripheral->>'status'
              and i.location=new.payload->>'terminal') then
            raise exception 'Periferico inconsistente com Inventario.';
          end if;
        end loop;
      end if;
      return new;
    end; $$;
    create trigger management_pdv_peripheral_location_guard
      before insert or update of payload on public.module_records
      for each row execute function app.guard_pdv_peripheral();
    create function app.guard_management_control_identity() returns trigger language plpgsql as $$
    begin
      if exists(select 1 from public.control_items c where c.management_record_id=new.id
        and not (c.status='Manutenção concluída' and btrim(c.tag)='' and btrim(c.serial)='')
        and not app.management_identity_matches(new.payload,c.tag,c.serial)) then
        raise exception 'Chamado nao corresponde ao computador.';
      end if;
      return new;
    end; $$;
    create trigger management_control_identity_guard
      before update of payload on public.module_records
      for each row execute function app.guard_management_control_identity();
    create function app.guard_control_management_identity() returns trigger language plpgsql as $$
    declare p jsonb;
    begin
      if new.management_record_id is null then return new; end if;
      select payload into p from public.module_records where id=new.management_record_id;
      if not app.management_identity_matches(p,new.tag,new.serial)
        and not (new.status='Manutenção concluída' and btrim(new.tag)='' and btrim(new.serial)='') then
        raise exception 'Chamado cruzado com outro PC.';
      end if;
      return new;
    end; $$;
    create trigger control_management_identity_guard
      before insert or update of management_record_id,tag,serial,status on public.control_items
      for each row execute function app.guard_control_management_identity();
    create function app.sync_control_from_management() returns trigger language plpgsql as $$
    begin return new; end; $$;
    create trigger management_record_control_sync after insert or update on public.module_records
      for each row execute function app.sync_control_from_management();
    create function app.record_module_record_activity() returns trigger language plpgsql as $$
    begin return new; end; $$;
    create trigger management_record_activity after insert or update on public.module_records
      for each row execute function app.record_module_record_activity();
    create function app.sync_management_record_to_control(p_management_record_id uuid, p_payload jsonb)
    returns boolean language plpgsql as $$
    declare existing_id uuid; table_id uuid;
    begin
      if p_payload->>'status' not in ('Defeito','Manutenção') then return false; end if;
      if current_setting('app.test_control_failure',true)='on' then
        raise exception 'Falha simulada no Controle TI.';
      end if;
      select c.id into existing_id from public.control_items c
      where c.management_record_id=p_management_record_id or lower(c.tag)=lower(p_payload->>'tag')
      order by (c.management_record_id=p_management_record_id) desc limit 1 for update;
      if existing_id is not null then
        update public.control_items set management_record_id=p_management_record_id,
          status='Em manutenção' where control_items.id=existing_id;
        return true;
      end if;
      select t.id into table_id from public.module_tables t where t.module='control' limit 1;
      if table_id is null then return false; end if;
      insert into public.control_items(table_id,management_record_id,equipment,model,tag,serial,status)
      values(table_id,p_management_record_id,p_payload->>'equipment',coalesce(p_payload->>'model',''),
        coalesce(p_payload->>'tag',''),coalesce(p_payload->>'serial',''),'Em manutenção');
      return true;
    end; $$;
  `);
  await db.query('insert into public.module_tables(id,module,name) values($1,$2,$3),($4,$5,$6)',
    [ids.table, 'management', 'Infraestrutura ALDECKOT', ids.controlTable, 'control', 'OUTUBRO 2026']);
  await db.query('insert into public.inventory_items(id,tag,location) values($1,$2,$3)',
    [ids.monitor, 'MON001', 'PDV 01']);
  const records = [
    [ids.reserve, { terminal: 'RES 02', area: 'Frente de Loja', isFixed: true,
      peripherals: [], logs: [], equipment: 'Caixa 16', tag: 'CX016', serial: 'SER016',
      status: 'Reserva', location: 'Sala CPD' }],
    [ids.pdv01, { terminal: 'PDV 01', area: 'Frente de Loja', isFixed: true,
      peripherals: [{ sourceModule: 'inventory', sourceItemId: ids.monitor,
        status: 'MON001', type: 'monitor' }], logs: [],
      equipment: 'Caixa 01', tag: 'CX001', serial: 'SER001', status: 'Ativo', location: 'PDV 01' }],
    [ids.pdv02, { terminal: 'PDV 02', area: 'Frente de Loja', isFixed: true,
      peripherals: [], logs: [] }],
  ];
  for (let n = 4; n <= 33; n += 1) {
    records.push([`10000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      { terminal: n === 5 ? 'PDV 04' : n === 22 ? 'PDV 03' : `TESTE ${n}`,
        area: n === 4 || n === 5 || n === 22 ? 'Frente de Loja' : 'Laboratório', isFixed: true,
        peripherals: [], logs: [],
        ...(n <= 21 ? { equipment: `Computador fictício ${n}`, tag: `CX${n}`,
          serial: `SER${n}`, status: 'Ativo',
          location: n === 5 ? 'PDV 04' : `TESTE ${n}` } : {}) }]);
  }
  assert.equal(records.length, 33);
  assert.equal(records.filter(([, p]) => p.equipment).length, 20);
  for (const [index, [id, payload]] of records.entries()) {
    await db.query('insert into public.module_records(id,table_id,payload,position) values($1,$2,$3,$4)',
      [id, ids.table, JSON.stringify(payload), index + 1]);
  }
  // Excecao historica sem TAG/serie: preservada, mas nao pode ser reassociada.
  await db.query(`insert into public.control_items(
    table_id,management_record_id,equipment,status) values($1,$2,'Caixa 16','Manutenção concluída')`,
  [ids.controlTable, ids.reserve]);
}

async function main() {
  await schema();
  // Use the actual production functions, not lookalike implementations.
  for (const [file, name] of [
    ['038_inventory_management_peripheral_sync.sql', 'app.inventory_tag_peripheral_type'],
    ['062_status_identity_safety.sql', 'app.management_identity_matches'],
    ['043_fix_central_management_control_maintenance_sync.sql', 'app.add_management_control_log'],
    ['073_control_maintenance_completion.sql', 'app.management_requires_control'],
    ['073_control_maintenance_completion.sql', 'app.guard_linked_control_completion'],
    ['073_control_maintenance_completion.sql', 'public.complete_control_maintenance'],
    ['044_route_management_maintenance_to_current_month.sql', 'app.current_control_maintenance_table_name'],
    ['044_route_management_maintenance_to_current_month.sql', 'app.sync_management_record_to_control'],
    ['084_control_management_identity_repair.sql', 'app.guard_control_management_identity'],
    ['084_control_management_identity_repair.sql', 'app.guard_management_control_identity'],
    ['086_inventory_pdv_location_sync.sql', 'app.guard_management_pdv_peripheral_location'],
  ]) await db.exec(migrationFunction(file, name));
  await db.exec(`
    drop trigger management_record_control_sync on public.module_records;
    create trigger management_record_control_sync
      after insert or update of payload on public.module_records
      for each row
      when (coalesce(current_setting('app.control_completion_event',true),'')='')
      execute function app.sync_control_from_management();
    create trigger linked_control_completion_guard before update of status
      on public.control_items for each row
      execute function app.guard_linked_control_completion();
    drop trigger management_pdv_peripheral_location_guard on public.module_records;
    create trigger management_pdv_peripheral_location_guard
      before insert or update of table_id,payload on public.module_records
      for each row execute function app.guard_management_pdv_peripheral_location();
    create function app.fail_control_for_test() returns trigger language plpgsql as $$
    begin
      if current_setting('app.test_control_failure',true)='on' then
        raise exception 'Falha simulada no Controle TI.';
      end if;
      return new;
    end; $$;
    create trigger control_failure_for_test before insert or update on public.control_items
      for each row execute function app.fail_control_for_test();
    update public.module_tables set name=app.current_control_maintenance_table_name()
      where id='${ids.controlTable}';
  `);
  await db.exec(readFileSync(resolve(root, 'supabase/087_management_computer_identity.sql'), 'utf8'));
  await db.exec(readFileSync(resolve(root, 'supabase/088_management_movements.sql'), 'utf8'));
  await db.exec(readFileSync(resolve(root, 'supabase/089_management_movement_pdv_guard.sql'), 'utf8'));
  const before = await positions();
  const source = before.find(row => row.id === ids.reserve);
  const target = before.find(row => row.id === ids.pdv01);
  const otherPdv = before.find(row => row.payload.terminal === 'PDV 04');
  await assert.rejects(movement(null, {}), /operacao identificada e um plano valido/);
  await assert.rejects(movement(randomUUID(), { mode: 'invalid' }),
    /Modalidade, computador, motivo e confirmacao/);
  assert.deepEqual(await positions(), before);
  const forbiddenCrossPdv = {
    mode: 'be-replaced', sourceId: ids.pdv01, targetId: otherPdv.id,
    sourceUpdatedAt: target.updated_at, targetUpdatedAt: otherPdv.updated_at,
    incomingComputerId: target.management_computer_id,
    outgoingComputerId: otherPdv.management_computer_id,
    outgoingUnassigned: true,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 04',
    outgoingStatus: 'Reserva', outgoingLocation: 'Sala CPD',
    reason: 'Teste local: substituto já ocupa outro PDV',
    confirmedLocations: true
  };
  await assert.rejects(movement(randomUUID(), forbiddenCrossPdv),
    /substituto já ocupa outro PDV/);
  assert.deepEqual(await positions(), before);
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 0);
  assert.equal((await one('select count(*)::integer as n from public.equipment_event_effects')).n, 0);
  assert.equal((await one('select count(*)::integer as n from public.sync_events')).n, 0);
  assert.equal((await one('select count(*)::integer as n from public.control_item_logs')).n, 0);
  assert.equal((await one(`select has_function_privilege('authenticated',
    'public.management_move_computer_core(uuid,jsonb)', 'EXECUTE') as allowed`)).allowed, false);
  const operationId = randomUUID();
  const plan = {
    mode: 'replace-other', sourceId: ids.reserve, targetId: ids.pdv01,
    incomingComputerId: source.management_computer_id,
    outgoingComputerId: target.management_computer_id,
    sourceUpdatedAt: source.updated_at, targetUpdatedAt: target.updated_at,
    outgoingUnassigned: true,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 01',
    outgoingStatus: 'Defeito', outgoingLocation: 'Sala CPD',
    reason: 'Teste local: reserva substitui computador do PDV',
    confirmedLocations: true,
  };
  await assert.rejects(movement(randomUUID(), { ...plan, incomingStatus: 'Reserva' }),
    /instalado no PDV deve terminar como Ativo/);
  assert.deepEqual(await positions(), before);
  await assert.rejects(movement(randomUUID(), { ...plan, outgoingLocation: '' }),
    /destino fisico confirmados/);
  assert.deepEqual(await positions(), before);
  await db.query('update public.module_tables set name=$1 where id=$2',
    ['MÊS DE TESTE AUSENTE', ids.controlTable]);
  await assert.rejects(movement(randomUUID(), plan),
    /Chamado do computador retirado nao foi confirmado/);
  assert.deepEqual(await positions(), before,
    'sem tabela mensal do Controle TI a troca inteira deve ser revertida');
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 0);
  await db.query('update public.module_tables set name=app.current_control_maintenance_table_name() where id=$1',
    [ids.controlTable]);
  await db.query("select set_config('app.test_control_failure','on',false)");
  await assert.rejects(movement(randomUUID(), plan), /Falha simulada no Controle TI/);
  await db.query("select set_config('app.test_control_failure','off',false)");
  assert.deepEqual(await positions(), before, 'falha na integração transacional reverte os PCs');
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 0);
  assert.equal((await one('select count(*)::integer as n from public.equipment_event_effects')).n, 0);
  assert.equal((await one('select count(*)::integer as n from public.sync_events')).n, 0);
  assert.equal((await one('select count(*)::integer as n from public.control_item_logs')).n, 0);
  const result = await movement(operationId, plan);
  assert.equal(result.incomingComputerId, source.management_computer_id);
  assert.equal(result.outgoingComputerId, target.management_computer_id);
  const after = await positions();
  const pdv = after.find(row => row.id === ids.pdv01);
  const reserve = after.find(row => row.id === ids.reserve);
  const withdrawn = after.find(row => row.id === result.outgoingDestinationId);
  assert.equal(pdv.payload.equipment, 'Caixa 16');
  assert.equal(pdv.payload.status, 'Ativo');
  assert.equal(pdv.payload.location, 'PDV 01');
  assert.equal(withdrawn.payload.equipment, 'Caixa 01');
  assert.equal(withdrawn.payload.tag, 'CX001');
  assert.equal(withdrawn.payload.serial, 'SER001');
  assert.equal(withdrawn.payload.status, 'Defeito');
  assert.equal(withdrawn.payload.location, 'Sala CPD');
  assert.equal(reserve.management_computer_id, null);
  assert.deepEqual(pdv.payload.peripherals, target.payload.peripherals);
  assert.equal((await one('select location from public.inventory_items where id=$1', [ids.monitor])).location,
    'PDV 01');
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 1);
  assert.equal((await one('select count(*)::integer as n from public.control_items where status=$1',
    ['Em manutenção'])).n, 1);
  assert.equal((await one('select count(*)::integer as n from public.control_item_logs where event_id=$1',
    [operationId])).n, 1);
  assert.equal((await one('select count(*)::integer as n from public.sync_events where event_id=$1',
    [operationId])).n, 1);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [source.management_computer_id, null])).rows.length, 1);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [target.management_computer_id, null])).rows.length, 1);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [null, ids.pdv01])).rows.length, 1);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [null, ids.pdv02])).rows.length, 0);
  assert.equal((await one('select metadata from public.equipment_events where id=$1',
    [operationId])).metadata.unverifiableHistoricalTicketIds.length, 1);
  assert.deepEqual(await movement(operationId, plan), result);
  assert.deepEqual(await positions(), after);
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 1);
  const occupiedDirect = {
    mode: 'direct', sourceId: ids.pdv01, targetId: result.outgoingDestinationId,
    incomingComputerId: pdv.management_computer_id,
    sourceUpdatedAt: pdv.updated_at, targetUpdatedAt: withdrawn.updated_at,
    incomingStatus: 'Ativo', incomingLocation: 'Sala CPD',
    reason: 'Teste: destino ocupado', confirmedLocations: true,
  };
  await assert.rejects(movement(randomUUID(), occupiedDirect), /Destino ocupado/);
  assert.deepEqual(await positions(), after);
  const freePdv02 = after.find(row => row.id === ids.pdv02);
  const direct = { ...occupiedDirect, targetId: ids.pdv02,
    targetUpdatedAt: freePdv02.updated_at, incomingLocation: 'PDV 02',
    reason: 'Teste: mudança para PDV vazio' };
  await movement(randomUUID(), direct);
  const afterDirect = await positions();
  assert.equal(afterDirect.find(row => row.id === ids.pdv02).payload.equipment, 'Caixa 16');
  assert.equal(afterDirect.find(row => row.id === ids.pdv01).management_computer_id, null);
  assert.deepEqual(afterDirect.find(row => row.id === ids.pdv01).payload.peripherals,
    target.payload.peripherals);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [source.management_computer_id, null])).rows.length, 2);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [null, ids.pdv01])).rows.length, 2);
  const movedPdv02 = afterDirect.find(row => row.id === ids.pdv02);
  const emptyReserve = afterDirect.find(row => row.id === ids.reserve);
  await assert.rejects(movement(randomUUID(), { ...direct,
    sourceId: ids.pdv02, targetId: ids.reserve,
    sourceUpdatedAt: movedPdv02.updated_at, targetUpdatedAt: emptyReserve.updated_at,
    incomingStatus: 'Reserva', incomingLocation: 'Sala CPD' }),
  /chamado historico sem identidade comprovada/);
  assert.deepEqual(await positions(), afterDirect);
  const fourthPositionId = '10000000-0000-4000-8000-000000000004';
  const fourth = afterDirect.find(row => row.id === fourthPositionId);
  const reverseDirection = {
    mode: 'be-replaced', sourceId: fourthPositionId, targetId: ids.pdv02,
    sourceUpdatedAt: fourth.updated_at, targetUpdatedAt: movedPdv02.updated_at,
    incomingComputerId: fourth.management_computer_id,
    outgoingComputerId: movedPdv02.management_computer_id,
    outgoingUnassigned: true,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 02',
    outgoingStatus: 'Reserva', outgoingLocation: 'Sala CPD',
    reason: 'Teste: substituicao iniciada pelo computador do PDV',
    confirmedLocations: true,
  };
  const otherDirection = await movement(randomUUID(), reverseDirection);
  const afterOtherDirection = await positions();
  assert.equal(afterOtherDirection.find(row => row.id === ids.pdv02).payload.equipment,
    'Computador fictício 4');
  assert.equal(afterOtherDirection.find(row => row.id === otherDirection.outgoingDestinationId).payload.equipment,
    'Caixa 16');
  assert.equal(afterOtherDirection.find(row => row.id === otherDirection.outgoingDestinationId).payload.status,
    'Reserva');
  assert.equal(afterOtherDirection.find(row => row.id === fourthPositionId).management_computer_id, null);
  assert.equal((await one('select count(*)::integer as n from public.module_records where management_computer_id is not null')).n,
    20);
  assert.equal((await db.query('select * from public.management_movement_history($1,$2)',
    [null, ids.pdv02])).rows.length, 2);

  const raceSource = afterOtherDirection.find(row => row.id === ids.pdv02);
  const raceTarget = afterOtherDirection.find(row => row.id === ids.pdv01);
  const racePlan = {
    mode: 'direct', sourceId: ids.pdv02, targetId: ids.pdv01,
    sourceUpdatedAt: raceSource.updated_at, targetUpdatedAt: raceTarget.updated_at,
    incomingComputerId: raceSource.management_computer_id,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 01',
    reason: 'Teste: operadores concorrentes', confirmedLocations: true,
  };
  const race = await Promise.allSettled([
    movement(randomUUID(), racePlan), movement(randomUUID(), racePlan),
  ]);
  assert.equal(race.filter(entry => entry.status === 'fulfilled').length, 1);
  assert.equal(race.filter(entry => entry.status === 'rejected').length, 1);
  assert.match(race.find(entry => entry.status === 'rejected').reason.message, /Conflito/);
  const afterRace = await positions();
  assert.equal(afterRace.find(row => row.id === ids.pdv01).payload.equipment,
    'Computador fictício 4');
  assert.equal(afterRace.find(row => row.id === ids.pdv02).management_computer_id, null);
  assert.deepEqual(afterRace.find(row => row.id === ids.pdv01).payload.peripherals,
    target.payload.peripherals);
  assert.equal((await one('select count(*)::integer as n from public.module_records where management_computer_id is not null')).n,
    20);
  const defectTicket = await one(`select id from public.control_items
    where management_record_id=$1 and status='Em manutenção'`, [withdrawn.id]);
  assert.ok(defectTicket, 'o PC retirado deve ter um chamado aberto');
  const activateDirectly = `update public.module_records
    set payload=jsonb_set(payload,'{status}',to_jsonb('Ativo'::text)) where id=$1`;
  await assert.rejects(db.query(activateDirectly, [withdrawn.id]),
    /Conclua o chamado aberto no Controle TI/);
  await assert.rejects(db.query(`update public.module_records
    set payload=jsonb_set(payload,'{status}',to_jsonb('Reserva'::text)) where id=$1`,
  [withdrawn.id]), /Conclua o chamado aberto no Controle TI/);
  await db.query("select set_config('app.control_completion_event',$1,false)", [operationId]);
  try {
    await assert.rejects(db.query(activateDirectly, [withdrawn.id]),
      /Conclua o chamado aberto no Controle TI/);
  } finally {
    await db.query("select set_config('app.control_completion_event','',false)");
  }
  assert.equal((await one('select payload->>\'status\' as status from public.module_records where id=$1',
    [withdrawn.id])).status, 'Defeito');
  const defectNow = afterRace.find(row => row.id === withdrawn.id);
  const freePdv = afterRace.find(row => row.id === ids.pdv02);
  await assert.rejects(movement(randomUUID(), {
    mode: 'direct', sourceId: withdrawn.id, targetId: ids.pdv02,
    sourceUpdatedAt: defectNow.updated_at, targetUpdatedAt: freePdv.updated_at,
    incomingComputerId: defectNow.management_computer_id,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 02',
    reason: 'Teste: nao ativar PC com chamado aberto', confirmedLocations: true,
  }), /Conclua o chamado aberto no Controle TI/);
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 4);

  // A RPC real da 073 cria o evento, libera o PC e conclui o chamado na mesma
  // transacao; o gatilho da 088 deve aceitar apenas esse fluxo coordenado.
  await assert.rejects(db.query(`update public.control_items
    set status='Manutenção concluída' where id=$1`, [defectTicket.id]),
  /Escolha Ativo ou Reserva/);
  const completionId = randomUUID();
  await db.exec("set timezone to 'America/Sao_Paulo'");
  try {
    const completion = await one(`select public.complete_control_maintenance(
      $1::uuid,'Ativo',$2::uuid,'{}'::jsonb) as result`,
    [defectTicket.id, completionId]);
    assert.equal(completion.result.status, 'applied');
  } finally {
    await db.exec("set timezone to 'UTC'");
  }
  assert.equal((await one('select payload->>\'status\' as status from public.module_records where id=$1',
    [withdrawn.id])).status, 'Ativo');
  assert.equal((await one('select status from public.control_items where id=$1',
    [defectTicket.id])).status, 'Manutenção concluída');
  assert.equal((await one(`select count(*)::integer as n from public.equipment_events
    where source_module='control' and source_id=$1 and action='Manutenção concluída'`,
  [defectTicket.id])).n, 1);
  const repeatedCompletion = await one(`select public.complete_control_maintenance(
    $1::uuid,'Ativo',$2::uuid,'{}'::jsonb) as result`,
  [defectTicket.id, completionId]);
  assert.equal(repeatedCompletion.result.status, 'already-applied');
  assert.equal((await one(`select count(*)::integer as n from public.equipment_events
    where source_module='control' and source_id=$1 and action='Manutenção concluída'`,
  [defectTicket.id])).n, 1);
  await db.query(`update public.module_records
    set payload=jsonb_set(payload,'{status}',to_jsonb('Reserva'::text)) where id=$1`,
  [withdrawn.id]);
  assert.equal((await one('select payload->>\'status\' as status from public.module_records where id=$1',
    [withdrawn.id])).status, 'Reserva');
  const differentSource = (await positions()).find(row => row.id === ids.pdv01);
  const differentTargets = (await positions()).filter(row =>
    ['PDV 02', 'PDV 03'].includes(row.payload.terminal));
  assert.equal(differentTargets.length, 2);
  assert.ok(differentTargets.every(row => row.management_computer_id === null));
  const eventsBeforeDifferentTargets = (await one(`select count(*)::integer as n
    from public.equipment_events where source_module='management'`)).n;
  const syncBeforeDifferentTargets = (await one(`select count(*)::integer as n
    from public.sync_events where module='management'`)).n;
  const differentDestinationRace = await Promise.allSettled(differentTargets.map(destination =>
    movement(randomUUID(), {
      mode: 'direct', sourceId: ids.pdv01, targetId: destination.id,
      sourceUpdatedAt: differentSource.updated_at,
      targetUpdatedAt: destination.updated_at,
      incomingComputerId: differentSource.management_computer_id,
      incomingStatus: 'Ativo', incomingLocation: destination.payload.terminal,
      reason: 'Teste local: mesmo PC disputado por destinos diferentes',
      confirmedLocations: true,
    })));
  assert.equal(differentDestinationRace.filter(entry => entry.status === 'fulfilled').length, 1);
  assert.equal(differentDestinationRace.filter(entry => entry.status === 'rejected').length, 1);
  assert.match(differentDestinationRace.find(entry => entry.status === 'rejected').reason.message,
    /Conflito/);
  const afterDifferentDestinations = await positions();
  assert.equal(afterDifferentDestinations.find(row => row.id === ids.pdv01).management_computer_id,
    null);
  assert.equal(afterDifferentDestinations.filter(row =>
    differentTargets.some(destination => destination.id === row.id)
      && row.management_computer_id === differentSource.management_computer_id).length, 1);
  assert.equal((await one(`select count(*)::integer as n from public.equipment_events
    where source_module='management'`)).n, eventsBeforeDifferentTargets + 1);
  assert.equal((await one(`select count(*)::integer as n from public.sync_events
    where module='management'`)).n, syncBeforeDifferentTargets + 1);
  console.log('OK: migrações 087+088+089 e funções reais de Controle/PDV no PostgreSQL em memória;');
  console.log('    ambos os sentidos da troca, status, monitor, chamado, histórico, rollback,');
  console.log('    reenvio idempotente e conflito simultâneo sem ocupação duplicada.');
}

try {
  await main();
} catch (error) {
  console.error('Falha no teste da RPC local:', error.message, error.detail || '',
    error.where || '', error.stack || '');
  process.exitCode = 1;
} finally {
  await db.close();
}
