import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Banco PostgreSQL descartável com as mesmas 78 ligações exigidas pela 086.
// Nenhuma conexão externa é criada.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migration = name => readFileSync(resolve(root, 'supabase', name), 'utf8');
const source039 = migration('039_fix_inventory_management_peripheral_sync_owner.sql');
const syncStart = source039.indexOf('create or replace function app.sync_inventory_peripherals_to_management()');
assert.ok(syncStart > 0);
const syncFunction = source039.slice(syncStart, source039.indexOf('$$;', syncStart) + 3);
const source079 = migration('079_inventory_branches.sql');
const swapStart = source079.indexOf('create or replace function public.inventory_swap_locations(');
assert.ok(swapStart > 0);
const swapFunction = source079.slice(swapStart, source079.indexOf('$$;', swapStart) + 3);
const source061 = migration('061_integrated_inventory_supplies.sql');
const replacementStart = source061.indexOf('create or replace function public.inventory_replace_equipment(');
assert.ok(replacementStart > 0);
const replacementFunction = source061.slice(replacementStart, source061.indexOf('$$;', replacementStart) + 3);
const db = new PGlite();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const managementTable = '10000000-0000-4000-8000-000000000001';
const inventoryTable = '20000000-0000-4000-8000-000000000001';
const positionId = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const itemId = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const pdv = n => 'PDV ' + String(n).padStart(2, '0');
const pc = n => 'Caixa ' + String(n).padStart(2, '0');

try {
  await db.exec(`
    create schema app; create schema auth; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select '90000000-0000-4000-8000-000000000001'::uuid $$;
    create table public.module_tables (id uuid primary key, module text not null);
    create table public.module_records (
      id uuid primary key, table_id uuid not null references public.module_tables(id),
      payload jsonb not null
    );
    create table public.inventory_items (
      id uuid primary key, table_id uuid not null, equipment text not null,
      model text not null default '', brand text not null default '',
      serial text not null default '', tag text not null,
      sector text not null default '', location text,
      status text not null, situation text not null default 'Normal',
      cleaning_type text not null default 'Não realizada',
      notes text not null default '', branch_id uuid, position integer not null default 0,
      updated_at timestamptz not null default now()
    );
    create table public.inventory_item_logs (
      id uuid primary key default gen_random_uuid(), inventory_item_id uuid not null,
      action text not null, message text not null, event_id uuid
    );
    create table public.equipment_events (
      id uuid primary key, source_module text not null, source_event_key text not null,
      source_id uuid, inventory_item_id uuid, action text not null,
      previous_status text, new_status text, previous_location text, new_location text,
      origin_location text, destination_location text, reason text,
      affected_modules jsonb, processing_result jsonb, metadata jsonb, actor_id uuid,
      created_at timestamptz not null default now(),
      unique(source_module, source_event_key)
    );
    create table public.equipment_event_effects (
      event_id uuid not null, module text not null, status text not null,
      attempts integer not null, processed_at timestamptz,
      primary key (event_id, module)
    );
    create function app.inventory_tag_peripheral_type(p_tag text)
      returns text language sql immutable as $$
      select case when upper(p_tag) like 'IMPR%' then 'Impressora' end $$;
    create function app.management_peripheral_tag_is_valid(p_type text, p_tag text)
      returns boolean language sql immutable as $$ select true $$;
    create function app.can_manage_module_table(p_table_id uuid, p_module text, p_operation text)
      returns boolean language sql stable as $$ select true $$;
    create function app.can_manage_module(p_module text, p_operation text)
      returns boolean language sql stable as $$ select true $$;
    create table public.inventory_branch_events (
      id uuid primary key default gen_random_uuid(), table_id uuid not null,
      item_id uuid, operation text not null, details jsonb not null default '{}'::jsonb,
      correlation_id uuid not null default gen_random_uuid()
    );
    create unique index inventory_branch_events_operation_item_uidx
      on public.inventory_branch_events(correlation_id,item_id) where item_id is not null;
    create table public.inventory_replacements (
      id uuid primary key default gen_random_uuid(),
      removed_item_id uuid, installed_item_id uuid,
      removed_identity uuid not null, installed_identity uuid not null,
      removed_tag text not null, installed_tag text not null,
      previous_location text not null, removed_location text not null,
      removed_status text not null, reason text not null, actor_id uuid
    );
    create function public.management_movement_history(
      p_computer_id uuid default null, p_position_id uuid default null
    ) returns table (
      event_id uuid, occurred_at timestamptz, action text, reason text,
      metadata jsonb, processing_result jsonb
    ) language sql as $$
      select e.id, e.created_at, e.action, e.reason, e.metadata, e.processing_result
      from public.equipment_events e where false $$;
  `);
  await db.query('insert into public.module_tables values ($1::uuid,$2),($3::uuid,$4)',
    [managementTable, 'management', inventoryTable, 'inventory']);

  let serial = 0;
  for (let n = 1; n <= 14; n += 1) {
    const peripherals = [];
    for (let count = n <= 8 ? 6 : 5; count > 0; count -= 1) {
      serial += 1;
      const id = itemId(serial);
      const tag = 'IMPR' + String(serial).padStart(3, '0');
      peripherals.push({ id: 'peripheral-' + serial, type: 'Impressora',
        status: tag, sourceModule: 'inventory', sourceItemId: id });
      await db.query(`insert into public.inventory_items
        (id,table_id,equipment,serial,tag,status,location)
        values ($1::uuid,$2::uuid,$3,$4,$5,'Ativo',$6)`,
      [id, inventoryTable, 'Impressora ' + serial, 'SERIAL-' + serial, tag, pc(n)]);
    }
    await db.query(`insert into public.module_records(id,table_id,payload)
      values ($1::uuid,$2::uuid,$3::jsonb)`,
    [positionId(n), managementTable,
      JSON.stringify({ terminal: pdv(n), equipment: pc(n), peripherals })]);
  }
  assert.equal(serial, 78);
  await db.exec(syncFunction);
  await db.exec(swapFunction);
  await db.exec(replacementFunction);
  await db.exec(`create trigger inventory_peripheral_management_sync
    after insert or update of tag, location on public.inventory_items
    for each row execute function app.sync_inventory_peripherals_to_management()`);

  await db.exec(migration('086_inventory_pdv_location_sync.sql'));
  assert.equal((await one("select count(*)::integer as n from public.inventory_items where location like 'PDV %'")).n, 78);
  await db.exec(migration('090_inventory_pdv_movement_history.sql'));
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 0,
    'A correção da 086 não cria movimentos retroativos');
  const preflightSql = readFileSync(resolve(root, 'docs/aldeckot-090-replacement-preflight.sql'), 'utf8');
  const preflight = await one(preflightSql);
  assert.equal(preflight.replacement_preflight_report.migration_090_installed, true);
  assert.equal(preflight.replacement_preflight_report.replacement_function_exists, true);
  const schemaSql = readFileSync(resolve(root, 'docs/aldeckot-090-schema-preflight.sql'), 'utf8');
  const schema = (await one(schemaSql)).schema_report;
  assert.deepEqual(schema.missing_or_changed_columns, []);
  assert.deepEqual(schema.missing_functions, []);
  assert.deepEqual(schema.missing_or_disabled_triggers, [
    { table: 'public.inventory_items', trigger: 'inventory_items_set_updated_at' }
  ], 'O esquema sintético omite apenas o gatilho de versão da 001');
  const legacyAuditSql = readFileSync(resolve(root, 'docs/aldeckot-090-legacy-rpc-audit.sql'), 'utf8');
  const legacyAudit = (await one(legacyAuditSql)).legacy_rpc_report;
  assert.equal(legacyAudit.legacy_rpc_exists, true);
  assert.equal(legacyAudit.database_routine_references.some(
    reference => reference.function === 'inventory_swap_locations_with_reason'), true);

  const moving = itemId(1);
  const version = (await one('select updated_at from public.inventory_items where id=$1', [moving])).updated_at;
  const operation = '50000000-0000-4000-8000-000000000001';
  await db.query(`select public.inventory_save_pdv_peripheral(
    $1::uuid,$2::jsonb,$3::timestamptz,$4,$5::uuid)`,
  [moving, JSON.stringify({ location: pdv(5) }), version,
    'Mudança confirmada pelo responsável', operation]);
  const origin = await one('select payload from public.module_records where id=$1', [positionId(1)]);
  const destination = await one('select payload from public.module_records where id=$1', [positionId(5)]);
  assert.equal(origin.payload.peripherals.some(p => p.sourceItemId === moving), false);
  assert.equal(destination.payload.peripherals.some(p => p.sourceItemId === moving), true);
  assert.equal((await one('select location from public.inventory_items where id=$1', [moving])).location, pdv(5));
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where p.value ->> 'sourceItemId' = $1`, [moving])).n, 1);
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n, 1);
  assert.equal((await one('select count(*)::integer as n from public.inventory_item_logs where event_id=$1',
    [operation])).n, 1);
  for (const number of [1, 5]) {
    const rows = (await db.query('select * from public.management_movement_history(null,$1::uuid)',
      [positionId(number)])).rows;
    assert.deepEqual(rows.map(row => row.event_id), [operation]);
  }

  const legacySwapId = '50000000-0000-4000-8000-000000000009';
  const beforeLegacySwap = await one(`select
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_item_logs) as logs,
    (select count(*)::integer from public.inventory_branch_events) as branch_events`);
  await assert.rejects(db.query(`select public.inventory_swap_locations(
    $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7)`,
  [itemId(2), itemId(7), legacySwapId, '', pdv(1), '', pdv(2)]),
  /Informe o motivo da movimentação física/,
  'A assinatura antiga não informa motivo e deve ser bloqueada para PDVs');
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(2)])).location, pdv(1));
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(7)])).location, pdv(2));
  for (const [item, position] of [[itemId(2), positionId(1)], [itemId(7), positionId(2)]]) {
    assert.equal((await one(`select count(*)::integer as n from public.module_records r
      cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
      where r.id=$1 and p.value ->> 'sourceItemId' = $2`, [position, item])).n, 1,
    'A chamada antiga recusada não altera os vínculos dos PDVs');
  }
  assert.deepEqual(await one(`select
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_item_logs) as logs,
    (select count(*)::integer from public.inventory_branch_events) as branch_events`), beforeLegacySwap,
  'A chamada legada rejeitada não pode deixar eventos ou logs parciais');

  for (const [number, location] of [[81, 'Sala CPD'], [82, 'Matriz']]) {
    await db.query(`insert into public.inventory_items
      (id,table_id,equipment,serial,tag,status,location)
      values ($1::uuid,$2::uuid,$3,$4,$5,'Reserva',$6)`,
    [itemId(number), inventoryTable, 'Impressora ' + number,
      'SERIAL-' + number, 'IMPR' + number, location]);
  }
  const legacyOutsidePdv = '50000000-0000-4000-8000-000000000010';
  await db.query(`select public.inventory_swap_locations(
    $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7)`,
  [itemId(81), itemId(82), legacyOutsidePdv, '', 'Sala CPD', '', 'Matriz']);
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(81)])).location, 'Matriz');
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(82)])).location, 'Sala CPD');
  assert.equal((await one('select count(*)::integer as n from public.equipment_events')).n,
    beforeLegacySwap.events, 'Permuta fora de PDV não cria movimentação física de posição');

  const swapId = '50000000-0000-4000-8000-000000000002';
  const swapArgs = [itemId(2), itemId(7), swapId, '', pdv(1), '', pdv(2),
    'Permuta solicitada para a manutenção dos periféricos'];
  const swap = args => db.query(`select public.inventory_swap_locations_with_reason(
    $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`, args);
  await swap(swapArgs);
  await swap(swapArgs);
  await assert.rejects(swap([...swapArgs.slice(0, 7), 'Outro motivo diferente']),
    /Identificador de permuta já usado/);
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(2)])).location, pdv(2));
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(7)])).location, pdv(1));
  const swapEvents = (await db.query(`select id, inventory_item_id, metadata
    from public.equipment_events where metadata ->> 'operationId' = $1 order by inventory_item_id`,
  [swapId])).rows;
  assert.equal(swapEvents.length, 2, 'Cada periférico mantém seu evento único');
  assert.deepEqual(swapEvents.map(row => row.inventory_item_id), [itemId(2), itemId(7)]);
  assert.notEqual(swapEvents[0].id, swapEvents[1].id);
  const branchEvents = (await db.query(`select item_id, details
    from public.inventory_branch_events where correlation_id=$1 order by item_id`,
  [swapId])).rows;
  assert.equal(branchEvents.length, 2);
  for (let index = 0; index < 2; index += 1) {
    assert.equal(branchEvents[index].details.reason, swapArgs[7]);
    assert.equal(branchEvents[index].details.movementEventId, swapEvents[index].id);
    assert.equal((await one(`select count(*)::integer as n from public.inventory_item_logs
      where inventory_item_id=$1 and event_id=$2`,
    [branchEvents[index].item_id, swapEvents[index].id])).n, 1,
    'O log da permuta e o evento devem permanecer ligados, sem duplicação');
  }
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where p.value ->> 'sourceItemId' in ($1,$2)`, [itemId(2), itemId(7)])).n, 2);
  assert.equal(swapEvents[0].metadata.peripheral.serial, 'SERIAL-2');

  await db.exec(`create function app.reject_second_swap_leg() returns trigger language plpgsql as $$
    begin
      if new.id = '30000000-0000-4000-8000-000000000008'::uuid then
        raise exception 'falha simulada na segunda etapa';
      end if;
      return new;
    end $$;
    create trigger zz_reject_second_swap_leg after update of location on public.inventory_items
      for each row execute function app.reject_second_swap_leg()`);
  const failedOperation = '50000000-0000-4000-8000-000000000003';
  await assert.rejects(swap([itemId(3), itemId(8), failedOperation, '', pdv(1), '', pdv(2),
    'Permuta simulada que deve ser revertida']), /falha simulada na segunda etapa/);
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(3)])).location, pdv(1));
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(8)])).location, pdv(2));
  assert.equal((await one(`select count(*)::integer as n from public.equipment_events
    where metadata ->> 'operationId' = $1`, [failedOperation])).n, 0);
  assert.equal((await one(`select count(*)::integer as n from public.inventory_branch_events
    where correlation_id = $1`, [failedOperation])).n, 0);
  assert.equal((await one(`select count(*)::integer as n from public.inventory_item_logs
    where message like $1`, ['Permuta ' + failedOperation + ':%'])).n, 0);

  const reserve = itemId(79);
  await db.query(`insert into public.inventory_items
    (id,table_id,equipment,serial,tag,status,location)
    values ($1::uuid,$2::uuid,'Impressora reserva','SERIAL-79','IMPR079','Reserva','Sala CPD')`,
  [reserve, inventoryTable]);
  const replacement = await one(`select public.inventory_replace_equipment(
    $1::uuid,$2::uuid,'Defeito','Sala CPD',$3) as id`,
  [itemId(4), reserve, 'Falha da impressora instalada no PDV']);
  assert.ok(replacement.id);
  const replacementEvents = (await db.query(`select inventory_item_id,id from public.equipment_events
    where metadata ->> 'operationId' = $1 order by inventory_item_id`, [replacement.id])).rows;
  assert.equal(replacementEvents.length, 2);
  assert.deepEqual(replacementEvents.map(row => row.inventory_item_id), [itemId(4), reserve]);
  for (const event of replacementEvents) {
    assert.equal((await one(`select count(*)::integer as n from public.inventory_item_logs
      where inventory_item_id=$1 and event_id=$2`, [event.inventory_item_id, event.id])).n, 1);
  }
  assert.equal((await one(`select count(*)::integer as n from public.inventory_item_logs
    where inventory_item_id in ($1,$2) and event_id is null`, [itemId(4), reserve])).n, 1,
  'Somente o log histórico da correção 086 permanece sem event_id');
  assert.equal((await one('select status from public.inventory_items where id=$1', [itemId(4)])).status, 'Defeito');
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(4)])).location, 'Sala CPD');
  assert.equal((await one('select status from public.inventory_items where id=$1', [reserve])).status, 'Ativo');
  assert.equal((await one('select location from public.inventory_items where id=$1', [reserve])).location, pdv(1));
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where p.value ->> 'sourceItemId' = $1 and r.id=$2`, [reserve, positionId(1)])).n, 1);
  const reserveFailure = itemId(80);
  await db.query(`insert into public.inventory_items
    (id,table_id,equipment,serial,tag,status,location)
    values ($1::uuid,$2::uuid,'Outra reserva','SERIAL-80','IMPR080','Reserva','Sala CPD')`,
  [reserveFailure, inventoryTable]);
  await db.exec(`create function app.reject_replacement_leg() returns trigger language plpgsql as $$
    begin
      if new.id = '30000000-0000-4000-8000-000000000080'::uuid then
        raise exception 'falha simulada na instalação';
      end if;
      return new;
    end $$;
    create trigger zz_reject_replacement_leg after update of location on public.inventory_items
      for each row execute function app.reject_replacement_leg()`);
  const before = await one(`select
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_replacements) as replacements,
    (select count(*)::integer from public.inventory_item_logs) as logs`);
  await assert.rejects(db.query(`select public.inventory_replace_equipment(
    $1::uuid,$2::uuid,'Defeito','Sala CPD',$3)`,
  [itemId(5), reserveFailure, 'Falha que deve desfazer a substituição']), /falha simulada na instalação/);
  assert.equal((await one('select status from public.inventory_items where id=$1', [itemId(5)])).status, 'Ativo');
  assert.equal((await one('select location from public.inventory_items where id=$1', [itemId(5)])).location, pdv(1));
  assert.equal((await one('select status from public.inventory_items where id=$1', [reserveFailure])).status, 'Reserva');
  assert.equal((await one('select location from public.inventory_items where id=$1', [reserveFailure])).location, 'Sala CPD');
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where p.value ->> 'sourceItemId' = $1 and r.id=$2`, [itemId(5), positionId(1)])).n, 1);
  assert.deepEqual(await one(`select
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_replacements) as replacements,
    (select count(*)::integer from public.inventory_item_logs) as logs`), before);
  const pdvMonitor = itemId(181);
  const storeMonitor = itemId(182);
  await db.query(`insert into public.module_records(id,table_id,payload)
    values ($1::uuid,$2::uuid,$3::jsonb)`,
  [positionId(99), managementTable,
    JSON.stringify({ terminal: 'TERM EST 02', equipment: 'ESTOQUE 02', peripherals: [] })]);
  await db.query(`insert into public.inventory_items
    (id,table_id,equipment,tag,status,location)
    values ($1::uuid,$2::uuid,'Monitor PDV','AJMON007','Ativo',$3),
      ($4::uuid,$2::uuid,'Monitor estoque','AJMON008','Ativo','ESTOQUE 02')`,
  [pdvMonitor, inventoryTable, pdv(2), storeMonitor]);
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where p.value ->> 'sourceItemId' in ($1,$2)`, [pdvMonitor, storeMonitor])).n, 0);
  const monitorPreflight = await one(readFileSync(
    resolve(root, 'docs/aldeckot-091-monitor-preflight.sql'), 'utf8'));
  assert.equal(monitorPreflight.monitor_report.ajmon_items, 2);
  assert.equal(monitorPreflight.monitor_report.unlinked_with_unique_destination, 2);
  assert.deepEqual(monitorPreflight.monitor_report.ambiguous_or_duplicate, []);
  await db.exec(migration('091_management_monitor_ajmon_assignment.sql'));
  assert.equal((await one(`select app.inventory_tag_peripheral_type('AJMON007') as type`)).type, 'Monitor');
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where r.id=$1 and p.value ->> 'sourceItemId'=$2`,
  [positionId(2), pdvMonitor])).n, 1, 'AJMON por terminal fica no PDV');
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where r.id=$1 and p.value ->> 'sourceItemId'=$2`,
  [positionId(99), storeMonitor])).n, 1, 'AJMON por nome do PC fica na posição física');
  await db.query(`update public.module_records
    set payload=jsonb_set(payload,'{equipment}','"Outro PC"'::jsonb)
    where id=$1`, [positionId(99)]);
  await db.query(`insert into public.module_records(id,table_id,payload)
    values ($1::uuid,$2::uuid,$3::jsonb)`,
  [positionId(100), managementTable,
    JSON.stringify({ terminal: 'TERM EST 03', equipment: 'ESTOQUE 02', peripherals: [] })]);
  await db.query(`update public.inventory_items set tag='AJMON009' where id=$1`, [storeMonitor]);
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where r.id=$1 and p.value ->> 'sourceItemId'=$2
      and p.value ->> 'status'='AJMON009'`,
  [positionId(99), storeMonitor])).n, 1,
  'Mesmo após troca de PC e TAG, monitor permanece na posição de instalação');
  assert.equal((await one(`select count(*)::integer as n from public.module_records r
    cross join lateral jsonb_array_elements(r.payload -> 'peripherals') p
    where r.id=$1 and p.value ->> 'sourceItemId'=$2`,
  [positionId(100), storeMonitor])).n, 0, 'Monitor não segue o nome do PC');
  await db.query(`insert into public.module_records(id,table_id,payload)
    values ($1::uuid,$2::uuid,$3::jsonb)`,
  [positionId(101), managementTable,
    JSON.stringify({ terminal: 'TERM EST 04', equipment: 'ESTOQUE 02', peripherals: [] })]);
  await assert.rejects(db.query(`insert into public.inventory_items
    (id,table_id,equipment,tag,status,location)
    values ($1::uuid,$2::uuid,'Monitor ambíguo','AJMON010','Ativo','ESTOQUE 02')`,
  [itemId(183), inventoryTable]), /mais de uma posição/);
  assert.equal((await one('select count(*)::integer as n from public.inventory_items where id=$1',
    [itemId(183)])).n, 0, 'Destino ambíguo não cria o item parcialmente');
  await db.query(`insert into public.module_records(id,table_id,payload)
    values ($1::uuid,$2::uuid,$3::jsonb)`,
  [positionId(102), managementTable,
    JSON.stringify({ terminal: 'TERM LEG 01', equipment: 'LEG PC',
      peripherals: [{ type: 'Monitor', status: 'MON999' }] })]);
  await assert.rejects(db.query(`insert into public.inventory_items
    (id,table_id,equipment,tag,status,location)
    values ($1::uuid,$2::uuid,'Monitor novo','AJMON011','Ativo','LEG PC')`,
  [itemId(184), inventoryTable]), /conflita com monitor legado/);
  assert.equal((await one(`select payload -> 'peripherals' -> 0 ->> 'status' as tag
    from public.module_records where id=$1`, [positionId(102)])).tag, 'MON999',
  'Monitor legado não é sobrescrito por associação AJMON');

  // 092: pré-condição protege vínculos reais; não tenta reparar dados por suposição.
  const cpdAudit = () => one(readFileSync(
    resolve(root, 'docs/aldeckot-092-cpd-assignment-audit.sql'), 'utf8'));
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3)',
    [positionId(103), managementTable, JSON.stringify({ terminal: 'LEGADO CPD',
      equipment: 'PC legado', peripherals: [{ type: 'Impressora', status: 'IMPR82',
        sourceModule: 'inventory', sourceItemId: itemId(82) }] })]);
  assert.equal((await cpdAudit()).assignment_report.cpd_conflicts.length, 1);
  await assert.rejects(db.exec(migration('092_inventory_cpd_unassigned.sql')),
    /Há equipamentos em Sala CPD ainda associados/);
  await db.exec('rollback');
  assert.equal((await one("select to_regprocedure('app.inventory_location_is_unassigned(text)') as fn")).fn,
    null, 'Falha da migração também desfaz a criação da regra');
  assert.equal((await one("select jsonb_array_length(payload->'peripherals') as n from public.module_records where id=$1",
    [positionId(103)])).n, 1, 'Pré-condição não remove associação existente');
  await db.query('delete from public.module_records where id=$1', [positionId(103)]);
  const snapshot = await one(`select
    (select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i) as inventory,
    (select jsonb_agg(to_jsonb(r) order by id) from public.module_records r) as positions,
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_item_logs) as logs`);
  await db.exec(migration('092_inventory_cpd_unassigned.sql'));
  assert.deepEqual(await one(`select
    (select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i) as inventory,
    (select jsonb_agg(to_jsonb(r) order by id) from public.module_records r) as positions,
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_item_logs) as logs`), snapshot,
    '092 instala regras sem alterar equipamentos, posições ou históricos');
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3),($4,$2,$5)',
    [positionId(104), managementTable, JSON.stringify({ terminal: 'Sala CPD', equipment: 'Sala CPD', peripherals: [] }),
      positionId(105), JSON.stringify({ terminal: 'BANCADA TESTE', equipment: 'PC TESTE', peripherals: [] })]);
  const allTypes = [['Impressora','IMPR901'],['Leitor','EAN901'],['Gaveta','GVT901'],
    ['Pin Pad','PP901'],['Balança','BAL901'],['Monitor','AJMON901'],['Teclado','TEC901'],
    ['Equipamento especial','ESPECIAL901'],['Equipamento sem TAG','']];
  const linkedCount = async id => (await one(`select count(*)::integer as n
    from public.module_records r cross join lateral jsonb_array_elements(r.payload->'peripherals') p
    where p.value->>'sourceItemId'=$1`, [id])).n;
  for (const [index, [type, tag]] of allTypes.entries()) {
    const id = itemId(900 + index);
    await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,status,location)
      values($1,$2,$3,$4,'Defeito','  sAlA   CPD  ')`, [id,inventoryTable,type,tag]);
    assert.equal(await linkedCount(id), 0, type + ' em CPD não se liga por nome coincidente');
    const entry = { type, status: tag, sourceModule: 'inventory', sourceItemId: id };
    const attach = value => db.query(`update public.module_records
      set payload=jsonb_set(payload,'{peripherals}',jsonb_build_array($2::jsonb)) where id=$1`,
      [positionId(105), JSON.stringify(value)]);
    await assert.rejects(attach(entry), /Sala CPD não pode ser associado/,
      type + ' não aceita vínculo manual por ID');
    if (tag) await assert.rejects(attach({ type, status: tag }), /Sala CPD não pode ser associado/,
      type + ' não aceita contorno por TAG legada');
    if (tag) await assert.rejects(attach({ type, tag: '', status: tag }), /Sala CPD não pode ser associado/,
      type + ' valida TAG legada mesmo quando o campo tag está vazio');
    await db.query("update public.inventory_items set location='BANCADA TESTE' where id=$1", [id]);
    if (index >= 7) await attach(entry); // vínculos legados de tipos sem classificação por prefixo
    assert.equal(await linkedCount(id), 1);
    await db.query("update public.inventory_items set location='Sala CPD' where id=$1", [id]);
    assert.equal(await linkedCount(id), 0, type + ' retorna ao CPD sem vínculo');
    assert.deepEqual(await one('select tag,status,location from public.inventory_items where id=$1', [id]),
      { tag, status: 'Defeito', location: 'Sala CPD' }, 'Desassociar não muda status nem identidade');
  }
  // A retirada de um PDV conserva motivo, evento e históricos da 090.
  const cpdMovementId = '50000000-0000-4000-8000-000000000092';
  const cpdVersion = (await one('select updated_at from public.inventory_items where id=$1', [pdvMonitor])).updated_at;
  const cpdArgs = [pdvMonitor, JSON.stringify({ location: 'Sala CPD' }), cpdVersion,
    'Monitor retirado do PDV para guarda no CPD', cpdMovementId];
  const moveToCpd = () => db.query(`select public.inventory_save_pdv_peripheral(
    $1::uuid,$2::jsonb,$3::timestamptz,$4,$5::uuid)`, cpdArgs);
  await moveToCpd();
  await moveToCpd();
  assert.equal(await linkedCount(pdvMonitor), 0);
  assert.equal((await one('select count(*)::integer as n from public.equipment_events where id=$1',
    [cpdMovementId])).n, 1, 'Reenvio da retirada não duplica eventos');
  assert.equal((await one('select count(*)::integer as n from public.inventory_item_logs where event_id=$1',
    [cpdMovementId])).n, 1);
  assert.equal(await linkedCount(storeMonitor), 1, 'Outro monitor permanece na posição física');
  const cpdReport = (await cpdAudit()).assignment_report;
  assert.deepEqual(cpdReport.cpd_conflicts, []);
  assert.equal(cpdReport.cpd_guard_installed, true);
  assert.equal(cpdReport.cpd_rule_function_installed, true);
  assert.equal(cpdReport.unlinked_monitors.some(item =>
    item.tag === 'AJMON901' && item.intentionally_unassigned), true);


  // 093: aliases de local não movem computadores nem fazem o periférico segui-los.
  const aliasesSql = migration('093_inventory_installation_location_aliases.sql');
  await db.query("update public.module_records set payload=jsonb_set(payload,'{equipment}',to_jsonb(id::text)) where id in ($1,$2)",
    [positionId(100),positionId(101)]);
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3),($4,$2,$5),($6,$2,$7)',
    [positionId(106),managementTable,JSON.stringify({terminal:'ESTOQUE 02',equipment:'',peripherals:[]}),
      positionId(107),JSON.stringify({terminal:'ESTOQUE 03',equipment:'',peripherals:[]}),
      positionId(108),JSON.stringify({terminal:'Matriz',equipment:'',peripherals:[]})]);
  for (const n of [20,21]) await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,status,location)
    values($1,$2,'Monitor',$3,'Ativo',$4)`,
    [itemId(1000+n),inventoryTable,'AJMON0'+n,n===20?'ESTOQUE02':'ESTOQUE03']);
  await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,status,location)
    values($1,$2,'Equipamento legado','ESPECIAL999','Defeito','Matriz')`,[itemId(1099),inventoryTable]);
  await db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals}',$2::jsonb) where id=$1",
    [positionId(108),JSON.stringify([{type:'Especial',status:'ESPECIAL999',sourceItemId:itemId(1099),sourceModule:'inventory'}])]);
  await assert.rejects(db.exec(aliasesSql),/Sala CPD\/Matriz ainda associados/);
  await db.exec('rollback');
  assert.equal((await one("select app.inventory_location_is_unassigned('Matriz') as value")).value,false,
    'Falha não instala metade da nova regra');
  await db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals}','[]'::jsonb) where id=$1",[positionId(108)]);
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3)',
    [positionId(109),managementTable,JSON.stringify({terminal:'ESTOQUE02',equipment:'',peripherals:[]})]);
  await assert.rejects(db.exec(aliasesSql),/ausente ou ambíguo/);
  await db.exec('rollback');
  assert.equal(await linkedCount(itemId(1020)),0,'Ambiguidade cancela reconciliação');
  await db.query('delete from public.module_records where id=$1',[positionId(109)]);
  const stableBefore = await one(`select
    (select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i) as inventory,
    (select jsonb_agg(jsonb_build_object('id',id,'payload',payload-'peripherals'-'lastActivity') order by id)
      from public.module_records) as computers,
    (select count(*)::integer from public.inventory_item_logs) as logs,
    (select count(*)::integer from public.equipment_events) as events`);
  await db.exec(aliasesSql);
  assert.equal(await linkedCount(itemId(1020)),1);
  assert.equal(await linkedCount(itemId(1021)),1);
  const stableAfter = await one(`select
    (select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i) as inventory,
    (select jsonb_agg(jsonb_build_object('id',id,'payload',payload-'peripherals'-'lastActivity') order by id)
      from public.module_records) as computers,
    (select count(*)::integer from public.inventory_item_logs) as logs,
    (select count(*)::integer from public.equipment_events) as events`);
  assert.deepEqual(stableAfter.inventory,stableBefore.inventory,'Não renomeia nem modifica itens');
  assert.deepEqual(stableAfter.computers,stableBefore.computers,'Não modifica ocupação ou históricos dos PCs');
  assert.equal(stableAfter.events,stableBefore.events,'Não inventa movimentação física');
  assert.equal(stableAfter.logs,stableBefore.logs+2,'Registra duas reconciliações cadastrais');
  await db.exec(aliasesSql);
  assert.equal((await one('select count(*)::integer as n from public.inventory_item_logs')).n,stableAfter.logs,
    'Reenvio não duplica logs ou vínculos');
  for (const [index,[type,tag]] of allTypes.entries()) {
    const id=itemId(1200+index), newTag=tag.replace('901','902');
    await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,status,location)
      values($1,$2,$3,$4,'Defeito','  MATRIZ  ')`,[id,inventoryTable,type,newTag]);
    assert.equal(await linkedCount(id),0,type+' em Matriz fica sem vínculo');
    const entry=JSON.stringify([{type,status:newTag,sourceItemId:id,sourceModule:'inventory'}]);
    await assert.rejects(db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals}',$2::jsonb) where id=$1",
      [positionId(105),entry]),/Sala CPD\/Matriz não pode ser associado/);
    await db.query("update public.inventory_items set location='BANCADA TESTE' where id=$1",[id]);
    if(index>=7) await db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals}',$2::jsonb) where id=$1",
      [positionId(105),entry]);
    assert.equal(await linkedCount(id),1);
    await db.query("update public.inventory_items set location='Matriz' where id=$1",[id]);
    assert.equal(await linkedCount(id),0,type+' desvinculado no retorno à Matriz');
    assert.equal((await one('select status from public.inventory_items where id=$1',[id])).status,'Defeito');
  }
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3)',
    [positionId(110),managementTable,JSON.stringify({terminal:'OUTRO LOCAL',equipment:'ESTOQUE02',peripherals:[]})]);
  await db.query("update public.inventory_items set location='ESTOQUE 02' where id=$1",[itemId(1020)]);
  assert.equal((await one(`select count(*)::integer as n from public.module_records r,
    lateral jsonb_array_elements(r.payload->'peripherals') p where r.id=$1 and p.value->>'sourceItemId'=$2`,
    [positionId(106),itemId(1020)])).n,1,'Mudar só espaço não faz monitor seguir nome de outro PC');
  await assert.rejects(db.query(`insert into public.inventory_items(id,table_id,equipment,tag,status,location)
    values($1,$2,'Monitor','AJMON040','Ativo','ESTOQUE02')`,[itemId(1040),inventoryTable]),/mais de uma posição/);
  const relationReport = (await one(readFileSync(
    resolve(root, 'docs/aldeckot-093-monitor-relation-audit.sql'), 'utf8'))).monitor_relation_report;
  assert.equal(relationReport.monitors.length,26);
  assert.equal(relationReport.cpd_matriz_rule_active,true);
  assert.equal(relationReport.location_key_function_installed,true);
  assert.deepEqual(relationReport.unassigned_conflicts,[]);
  assert.equal(relationReport.monitors.find(i=>i.tag==='AJMON020').inventory[0].linked_positions[0].terminal,'ESTOQUE 02');
  assert.equal(relationReport.monitors.find(i=>i.tag==='AJMON019').inventory_count,0,
    'Relatório sinaliza ausência sem criar equipamento');

  // Correção cadastral pontual autorizada, usando dados fictícios no banco isolado.
  const rhSql=readFileSync(resolve(root,'docs/aldeckot-ajmon024-rh-correction.sql'),'utf8');
  const rhMonitor='10947087-ef80-48e2-9474-1359e5cce8a5';
  const rhSource='29c59e81-30a8-4a58-b46c-94b2f90c8cac';
  const rhTarget='5bce380d-ff6a-494d-845d-52fae0dc7417';
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3),($4,$2,$5)',
    [rhSource,managementTable,JSON.stringify({terminal:'AUDITÓRIO',equipment:'',logs:[{text:'Histórico preservado'}],peripherals:[]}),
      rhTarget,JSON.stringify({terminal:'RH',equipment:'AJ RH',tag:'AJPCRH01',logs:[{text:'Histórico PC'}],
        peripherals:[{type:'Teclado',status:'TEC999',id:'teclado-preservado'}]})]);
  await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,serial,status,location)
    values($1,$2,'Monitor RH','AJMON024','SERIAL-PRESERVADO','Ativo','AUDITÓRIO')`,[rhMonitor,inventoryTable]);
  const rhSnapshot=()=>one(`select
    (select to_jsonb(i) from public.inventory_items i where id=$1) as item,
    (select jsonb_agg(to_jsonb(r) order by id) from public.module_records r where id in($2,$3)) as positions,
    (select count(*)::integer from public.inventory_item_logs where inventory_item_id=$1) as logs`,
    [rhMonitor,rhSource,rhTarget]);
  const rhBefore=await rhSnapshot();
  await db.exec(`create function app.fail_test_log() returns trigger language plpgsql as $$
    begin raise exception 'Falha simulada no log'; end $$;
    create trigger test_log_failure before insert on public.inventory_item_logs
    for each row execute function app.fail_test_log();`);
  await assert.rejects(db.exec(rhSql),/Falha simulada no log/);
  await db.exec('rollback');
  assert.deepEqual(await rhSnapshot(),rhBefore,'Falha no log desfaz local e ambos os vínculos');
  await db.exec('drop trigger test_log_failure on public.inventory_item_logs');
  await db.query("update public.module_records set payload=jsonb_set(payload,'{tag}','\"OUTRO-PC\"'::jsonb) where id=$1",[rhTarget]);
  await assert.rejects(db.exec(rhSql),/PC do RH mudaram/);
  await db.exec('rollback');
  await db.query("update public.module_records set payload=jsonb_set(payload,'{tag}','\"AJPCRH01\"'::jsonb) where id=$1",[rhTarget]);
  await db.exec(rhSql);
  const rhAfter=await rhSnapshot();
  assert.equal(rhAfter.item.location,'RH');
  assert.equal(rhAfter.item.status,'Ativo');
  assert.equal(rhAfter.item.serial,'SERIAL-PRESERVADO');
  assert.equal(rhAfter.logs,rhBefore.logs+1);
  assert.equal(await linkedCount(rhMonitor),1);
  assert.deepEqual(rhAfter.positions.find(r=>r.id===rhTarget).payload.peripherals[0],
    {type:'Teclado',status:'TEC999',id:'teclado-preservado'});
  assert.deepEqual(rhAfter.positions.map(r=>r.payload.logs),rhBefore.positions.map(r=>r.payload.logs));
  await db.exec(rhSql);
  assert.deepEqual(await rhSnapshot(),rhAfter,'Reenvio da correção não duplica histórico nem vínculo');

  const mon19Sql=readFileSync(resolve(root,'docs/aldeckot-mon0-ajmon019-repair.sql'),'utf8');
  const mon19Id='c5c96233-c834-4397-81db-341dece769a0';
  const stockId='c4a736eb-96da-4455-8845-bf6304f214d3';
  const duplicateEntryIds=[
    'inventory-peripheral-c5c96233-c834-4397-81db-341dece769a0-monitor',
    'inventory-peripheral-c2b17e61-771c-47f9-9fa2-e54a0040ce03',
    'inventory-peripheral-96eef490-d29a-4df1-81be-5242db9fc71b',
    'inventory-peripheral-c5c96233-c834-4397-81db-341dece769a0'];
  const duplicateEntries=duplicateEntryIds.map(id=>({
    id,type:'Monitor',status:'MON0',sourceItemId:mon19Id,sourceModule:'inventory'}));
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3)',
    [stockId,managementTable,JSON.stringify({terminal:'ESTOQUE 01',equipment:'ESTOQUE01',tag:'AJPCEST01',
      logs:[{text:'Histórico do PC preservado'}],peripherals:[]})]);
  await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,serial,status,location)
    values($1,$2,'Monitor existente','MON0','SERIE-ORIGINAL','Ativo','ESTOQUE01')`,[mon19Id,inventoryTable]);
  const originalPeripherals=[{id:'teclado-intacto',type:'Teclado',status:'TEC456'},
    ...duplicateEntries,{id:'impressora-intacta',type:'Impressora',status:'IMPR456'}];
  await db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals}',$2::jsonb) where id=$1",
    [stockId,JSON.stringify(originalPeripherals)]);
  const mon19Snapshot=()=>one(`select
    (select jsonb_agg(to_jsonb(i) order by id) from public.inventory_items i) as inventory,
    (select jsonb_agg(to_jsonb(r) order by id) from public.module_records r) as records,
    (select count(*)::integer from public.equipment_events) as events,
    (select count(*)::integer from public.inventory_item_logs) as logs`);
  const stockBefore=await mon19Snapshot();
  await db.query(`insert into public.inventory_items(id,table_id,equipment,tag,status,location)
    values($1,$2,'Outro monitor','AJMON019','Reserva','Sala CPD')`,[itemId(1999),inventoryTable]);
  await assert.rejects(db.exec(mon19Sql),/AJMON019 já pertence/);
  await db.exec('rollback');
  await db.query('delete from public.inventory_items where id=$1',[itemId(1999)]);
  await db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals,1,observacao}','\"Não descartar\"'::jsonb) where id=$1",[stockId]);
  await assert.rejects(db.exec(mon19Sql),/conteúdo das entradas mudou/);
  await db.exec('rollback');
  await db.query("update public.module_records set payload=jsonb_set(payload,'{peripherals}',$2::jsonb) where id=$1",
    [stockId,JSON.stringify(originalPeripherals)]);
  await db.query('insert into public.module_records(id,table_id,payload) values($1,$2,$3)',
    [positionId(111),managementTable,JSON.stringify({terminal:'POSIÇÃO CONFLITANTE',peripherals:[duplicateEntries[0]]})]);
  await assert.rejects(db.exec(mon19Sql),/quatro associações auditadas/);
  await db.exec('rollback');
  await db.query('delete from public.module_records where id=$1',[positionId(111)]);
  await db.exec(`create trigger test_log_failure before insert on public.inventory_item_logs
    for each row execute function app.fail_test_log();`);
  await assert.rejects(db.exec(mon19Sql),/Falha simulada no log/);
  await db.exec('rollback');
  assert.deepEqual(await mon19Snapshot(),stockBefore,'Falha restaura as quatro entradas, TAG e eventos');
  await db.exec('drop trigger test_log_failure on public.inventory_item_logs');
  await db.exec(mon19Sql);
  assert.equal(await linkedCount(mon19Id),1);
  const stockAfter=await mon19Snapshot();
  const monitorAfter=stockAfter.inventory.find(i=>i.id===mon19Id);
  assert.equal(monitorAfter.tag,'AJMON019');
  assert.equal(monitorAfter.serial,'SERIE-ORIGINAL');
  assert.equal(monitorAfter.status,'Ativo');
  assert.equal(monitorAfter.location,'ESTOQUE01');
  assert.deepEqual(stockAfter.inventory.filter(i=>i.id!==mon19Id),
    stockBefore.inventory.filter(i=>i.id!==mon19Id),'Outros equipamentos não são modificados');
  const positionAfter=stockAfter.records.find(r=>r.id===stockId);
  assert.equal(positionAfter.payload.peripherals.length,3);
  assert.deepEqual(positionAfter.payload.peripherals.filter(p=>p.sourceItemId!==mon19Id),
    originalPeripherals.filter(p=>p.sourceItemId!==mon19Id),'Outros periféricos são preservados');
  assert.deepEqual(positionAfter.payload.logs,stockBefore.records.find(r=>r.id===stockId).payload.logs);
  assert.equal(stockAfter.events,stockBefore.events+1);
  assert.equal(stockAfter.logs,stockBefore.logs+1);
  const repairEvent=await one("select * from public.equipment_events where source_event_key='identity-repair:mon0-ajmon019-20261022'");
  assert.deepEqual(repairEvent.metadata.previousPeripherals,originalPeripherals,'Cópia recuperável de todas as entradas anteriores');
  assert.equal(repairEvent.metadata.physicalMovement,false);
  await db.exec(mon19Sql);
  assert.deepEqual(await mon19Snapshot(),stockAfter,'Reenvio não altera TAG, eventos nem histórico');
  console.log('✓ 086–093: aliases CPD/Matriz, nove tipos, espaços ESTOQUE, reconciliação, rollback e idempotência.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
