import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const model = require('../home-operational-model.js');
const inventorySupplies = require('../supplies-inventory.js');
const variations = require('../supplies-variations.js');
const source = readFileSync(new URL('../home-data.js', import.meta.url), 'utf8');

function harness(count = 1) {
  const calls = [];
  const failures = new Set();
  const records = {
    module_tables: [{ id: 'inv', name: 'Monitores', module: 'inventory' }, { id: 'mgmt', name: 'Posições', module: 'management' }],
    inventory_items: Array.from({ length: count }, (_, index) => ({ id: 'inventory-' + index, table_id: 'inv',
      equipment: 'Monitor', status: 'Ativo', tag: 'AJMON' + index, created_at: '2026-10-01' })),
    module_records: [{ id: 'position', table_id: 'mgmt', management_computer_id: 'computer', equipment: 'PC',
      status: 'Ativo', registeredAt: '2026-08-01', created_at: '2026-10-01' }],
    control_items: [], flux_items: [], nfe_occurrences: [], equipment_events: [], equipment_event_effects: [],
    supply_stock_summary: [], supply_variants: [], supply_units: []
  };
  const client = { from(table) {
    const state = { table, filters: [], columns: '' };
    const chain = {
      select(columns) { state.columns = columns; return chain; },
      order() { return chain; },
      eq(field, value) { state.filters.push([field, value]); return chain; },
      in(field,values) { state.filters.push([field,values,'in']); return chain; },
      gte(field,value) { state.filters.push([field,value,'gte']); return chain; },
      lt(field,value) { state.filters.push([field,value,'lt']); return chain; }, or() { return chain; },
      limit(limit) { return chain.range(0, limit - 1); },
      range(from, to) {
        calls.push({ ...state, from, to });
        if (failures.has(table)) return Promise.resolve({ data: null, error: { code: 'test', message: 'Falha controlada' } });
        const rows = (records[table] || []).filter(row => state.filters.every(([field,value,op]) => op==='in' ? value.includes(row[field]) : op==='gte' ? row[field]>=value : op==='lt' ? row[field]<value : row[field] === value));
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      }
    };
    return chain;
  } };
  const window = { AldeckotSupabase: { init: async () => ({ client }) },
    AldeckotHomeModel: model, AldeckotInventorySupplies: inventorySupplies, AldeckotSupplyVariations: variations };
  runInNewContext(source, { window, console: { warn() {} }, Date, Map, Object, Array, Promise });
  return { window, calls, failures, records };
}
test('a Home usa projeções paginadas e nunca trunca a contagem na primeira página', async () => {
  const h = harness(501);
  const snapshot = await h.window.AldeckotHomeQueries.load();
  assert.equal(snapshot.inventory.length, 501);
  assert.equal(snapshot.management[0].computerId, 'computer');
  assert.equal(snapshot.management[0].createdAt, '2026-08-01');
  assert.deepEqual(h.calls.filter(call => call.table === 'inventory_items').map(call => call.from), [0, 500]);
  assert.ok(h.calls.every(call => !call.columns.includes('*')));
  const managementRead = h.calls.find(call => call.table === 'module_records').columns;
  assert.match(managementRead, /equipment:payload->>equipment/);
  assert.doesNotMatch(managementRead, /(?:^|,)payload(?:,|$)|logs|snapshot/);
});

test('calendário consulta meses históricos sem limitar os registros ao período dos indicadores', async () => {
  const h=harness();
  h.records.module_tables.push({id:'ctrl',name:'Chamados',module:'control'});
  h.records.nfe_occurrences.push({id:'old',nfe_number:'999',occurred_at:'2026-07-15T12:00:00-03:00'});
  h.records.control_items.push({id:'v',table_id:'ctrl',followup_kind:'verification',entry_date:'2026-07-15'});
  const snapshot=await h.window.AldeckotHomeQueries.load();
  assert.equal(snapshot.nfe.length,0);
  const month=await h.window.AldeckotHomeQueries.calendarMonth('2026-07');
  assert.equal(month.fiscal.length,1);
  assert.equal(month.fiscal[0].nfeNumber,'999');
  assert.equal(month.technical.length,1);
  assert.equal(month.maintenance.length,0);
  h.failures.add('nfe_occurrences');
  const unavailable=await h.window.AldeckotHomeQueries.calendarMonth('2026-07');
  assert.equal(unavailable.fiscal,null);
  assert.equal(unavailable.technical.length,1);
  await assert.rejects(h.window.AldeckotHomeQueries.calendarMonth('2026-13'),/Mês inválido/);
});
test('falha isolada mantém último conjunto válido e permite recuperação confirmada', async () => {
  const h = harness();
  let snapshot = await h.window.AldeckotHomeQueries.load();
  assert.equal(snapshot.inventory.length, 1);
  h.failures.add('inventory_items');
  snapshot = await h.window.AldeckotHomeQueries.load(['inventory']);
  assert.equal(snapshot.inventory.length, 1);
  assert.equal(snapshot.health.inventory.stale, true);
  assert.equal(snapshot.health.inventory.unavailable, false);
  h.failures.delete('inventory_items');
  h.records.inventory_items.push({ id: 'new', table_id: 'inv', equipment: 'Monitor', status: 'Reserva' });
  snapshot = await h.window.AldeckotHomeQueries.load(['inventory']);
  assert.equal(snapshot.inventory.length, 2);
  assert.equal(snapshot.health.inventory.stale, false);
});
test('primeira consulta com falha não se apresenta como uma coleção vazia confirmada', async () => {
  const h = harness();
  h.failures.add('control_items');
  const snapshot = await h.window.AldeckotHomeQueries.load();
  assert.equal(snapshot.control, undefined);
  assert.equal(snapshot.health.control.unavailable, true);
  assert.equal(model.build(snapshot).availability.tickets.available, false);
});
test('cliques concorrentes compartilham a leitura em andamento', async () => {
  const h = harness();
  const first = h.window.AldeckotHomeQueries.load();
  const second = h.window.AldeckotHomeQueries.load();
  assert.equal(first, second);
  await first;
  assert.equal(h.calls.filter(call => call.table === 'module_tables').length, 1);
});
test('consulta de atualização parcial não carrega os demais módulos', async () => {
  const h = harness();
  await h.window.AldeckotHomeQueries.load();
  h.calls.length = 0;
  await h.window.AldeckotHomeQueries.load(['control']);
  assert.deepEqual([...new Set(h.calls.map(call => call.table))], ['module_tables', 'control_items']);
});
