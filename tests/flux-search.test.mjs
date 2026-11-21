import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { prepare } = createRequire(import.meta.url)('../flux-search.js');
const row = (module, id, tag, serial, extra = {}) => ({ module, id, tag, serial, equipment: 'Impressora', ...extra });

test('busca prioriza correspondência exata e a origem Inventário', () => {
  const results = prepare([
    row('flux', 'f1', 'IMP040', 'S40'),
    row('control', 'c1', 'IMP04', 'S4'),
    row('inventory', 'i1', 'IMP04', 'S4')
  ], ' imp04 ');
  assert.deepEqual(results.map(item => item.id), ['i1', 'f1']);
  assert.equal(results[0].inventoryItemId, 'i1');
});

test('TAG igual com séries diferentes nunca é mesclada', () => {
  const results = prepare([row('inventory', 'i1', 'IMP04', 'S1'), row('inventory', 'i2', 'IMP04', 'S2')], 'IMP04');
  assert.equal(results.length, 2);
  assert.ok(results.every(item => item.duplicateTag));
});

test('duas identidades na mesma origem são preservadas mesmo com TAG e série iguais', () => {
  const results = prepare([row('inventory', 'i1', 'IMP04', 'S1'), row('inventory', 'i2', 'IMP04', 'S1')], 'IMP04');
  assert.deepEqual(results.map(item => item.id), ['i1', 'i2']);
});

test('TAG sem série não vira chave canônica entre módulos', () => {
  const results = prepare([row('management', 'm1', 'IMP04', ''), row('control', 'c1', 'IMP04', '')], 'IMP04');
  assert.equal(results.length, 2);
});

test('eventos explícitos do Inventário viram um resultado mesmo com TAG histórica diferente', () => {
  const results = prepare([
    row('flux', 'f1', 'IMP04', 'S1', { metadata: { inventoryItemId: 'i1' } }),
    row('control', 'c1', 'IMP04', 'S1', { metadata: { inventoryItemId: 'i1' } }),
    row('inventory', 'i1', 'IMP99', 'S1')
  ], 'S1');
  assert.deepEqual(results.map(item => [item.id, item.inventoryItemId]), [['i1', 'i1']]);
});

test('TAG e série iguais não fundem IDs explícitos de equipamentos diferentes', () => {
  const results = prepare([
    row('control', 'c1', 'IMP04', 'S1', { metadata: { inventoryItemId: 'i2' } }),
    row('inventory', 'i1', 'IMP04', 'S1'),
    row('flux', 'f1', 'IMP04', 'S1')
  ], 'IMP04');
  assert.deepEqual(results.map(item => item.id), ['i1', 'c1', 'f1']);
  assert.ok(results.every(item => item.duplicateTag));
});

test('ciclos do mesmo equipamento e espelhos do mesmo computador são agrupados por seus próprios IDs', () => {
  const records = [
    row('management', 'm1', '', 'S1', { metadata: { computerId: 'pc1' } }),
    row('control', 'c1', '', 'S1', { metadata: { computerId: 'pc1' } }),
    row('flux', 'f1', '', 'S2', { metadata: { equipmentUid: 'physical1' } }),
    row('flux', 'f2', '', 'S2', { metadata: { equipmentUid: 'physical1' } }),
    row('flux', 'f3', '', 'S2', { metadata: { equipmentUid: 'physical2' } })
  ];
  assert.deepEqual(prepare(records, 'S2').map(item => item.id), ['f1', 'f3', 'm1']);
});
