import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = require('../home-operational-model.js');
test('recentes usam registros atuais, ordenados por alteração, sem copiar eventos antigos ou excluídos', () => {
  const source = { inventory: [
    { id: 'first', equipment: 'Zebra', updatedAt: '2026-10-10T12:00:00Z', status: 'Ativo' },
    { id: 'last', equipment: 'Impressora', updatedAt: '2026-10-20T12:00:00Z', status: 'Ativo' }
  ], management: [], control: [], flux: [], nfe: [], events: [
    { id: 'deleted', sourceId: 'removed', action: 'delete', createdAt: '2026-10-21T12:00:00Z' }
  ], effects: [], backups: [], stock: [] };
  const result = build(source, new Date('2026-10-22T12:00:00Z'));
  assert.deepEqual(result.sets.recent.map(row => row.id), ['last', 'first']);
  assert.match(result.sets.recent[0].targetUrl, /inventory\.html\?item=last/);
  assert.equal(result.sets.activities.length, 0);
});
