import { createRequire } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { groups, historyEvents, filterHistory } = require('../flux-cycles.js');

const asset = { equipmentUid: 'equipment-1', equipment: 'Impressora de balcão',
  serial: 'S-01', senderCompany: 'Matriz', destinationCompany: 'Filial de ensaio' };
const tables = [
  { id: 'set', name: 'Setembro', items: [
    { ...asset, id: 's1', movement: 'Envio', status: 'Entregue', situation: 'Transferência',
      sendDate: '2026-09-04', deliveredAt: '2026-09-05T13:00:00Z' }
  ] },
  { id: 'out', name: 'Outubro', items: [
    { ...asset, id: 'r1', movement: 'Recebimento', status: 'Recebido', situation: 'Transferência',
      returnOf: 's1', receivedDate: '2026-10-02', receivedAt: '2026-10-02T17:00:00Z' },
    { ...asset, id: 's2', movement: 'Envio', status: 'Entregue', situation: 'Troca',
      sendDate: '2026-10-20', deliveredAt: '2026-10-21T13:00:00Z' }
  ] },
  { id: 'nov', name: 'Novembro', items: [
    { ...asset, id: 'r2', movement: 'Recebimento', status: 'Recebido', situation: 'Troca',
      returnOf: 's2', receivedDate: '2026-11-02', receivedAt: '2026-11-02T17:00:00Z' }
  ] }
];

test('cada período contém um cartão do equipamento com o ciclo correspondente', () => {
  for (const [month, latest, send, entry] of [
    ['set', 's1', 's1', 'r1'], ['out', 's2', 's2', 'r2'], ['nov', 'r2', 's2', 'r2']
  ]) {
    const result = groups(tables, month);
    assert.equal(result.length, 1);
    const [group] = result;
    assert.equal(group.latest.id, latest);
    assert.deepEqual([group.cycle.send.id, group.cycle.entry.id], [send, entry]);
    assert.deepEqual(group.cycles.map(cycle => [cycle.send.id, cycle.entry?.id]), [['s1', 'r1'], ['s2', 'r2']]);
  }
});

test('status e motivo filtram o mesmo registro do mês e atualizam o ciclo do cartão', () => {
  const [group] = groups(tables, 'out', { query: 'BALCAO', status: 'Recebido', situation: 'Transferência' });
  assert.equal(group.latest.id, 'r1');
  assert.equal(group.cycle.send.sendDate, '2026-09-04');
  assert.equal(group.cycle.entry.receivedDate, '2026-10-02');
  assert.deepEqual(groups(tables, 'out', { status: 'Recebido', situation: 'Troca' }), []);
  assert.deepEqual(groups(tables, 'set', { status: 'Recebido' }), []);
});

test('histórico apresenta os seis eventos e filtra cada retorno no mês certo', () => {
  const events = historyEvents(tables);
  assert.deepEqual(events.map(({ key, day }) => [key, day]), [
    ['r2:Retorno', '2026-11-02'],
    ['s2:Entrega', '2026-10-21'],
    ['s2:Saída', '2026-10-20'],
    ['r1:Retorno', '2026-10-02'],
    ['s1:Entrega', '2026-09-05'],
    ['s1:Saída', '2026-09-04']
  ]);
  assert.deepEqual(filterHistory(events, {
    query: 's-01', type: 'Retorno', month: '2026-10', from: '2026-10-02', to: '2026-10-02'
  }).map(event => event.key), ['r1:Retorno']);
  assert.deepEqual(filterHistory(events, { type: 'Retorno', month: '2026-11' })
    .map(event => event.item.returnOf), ['s2']);
});

test('histórico usa o dia local e ordena instantes com fusos diferentes pela hora real', () => {
  const rows = historyEvents([{ id: 'out', name: 'Outubro', items: [
    { ...asset, id: 'late', movement: 'Envio', sendDate: '2026-10-31', deliveredAt: '2026-11-01T01:40:00Z' },
    { ...asset, id: 'early', movement: 'Envio', sendDate: '2026-10-31', deliveredAt: '2026-10-31T22:10:00-03:00' }
  ] }]);
  assert.deepEqual(rows.map(event => event.key), ['late:Entrega', 'early:Entrega', 'early:Saída', 'late:Saída']);
  assert.equal(filterHistory(rows, { month: '2026-11', type: 'Entrega' }).length, 0);
});

test('TAG repetida não funde equipamentos com identidades diferentes', () => {
  const result = groups([{ id: 'nov', items: [
    { id: 'a', tag: 'IMP04', serial: 'A', inventoryItemId: 'ia', movement: 'Envio' },
    { id: 'b', tag: 'IMP04', serial: 'B', inventoryItemId: 'ib', movement: 'Envio' }
  ] }], 'nov');
  assert.equal(result.length, 2);
});

test('série ambígua com dois vínculos preserva o registro legado separado', () => {
  const result = groups([{ id: 'nov', items: [
    { id: 'a', serial: 'S', sourceModule: 'inventory', sourceRecordId: 'ia', movement: 'Envio' },
    { id: 'b', serial: 'S', sourceModule: 'management', sourceRecordId: 'mb', movement: 'Envio' },
    { id: 'legacy', serial: 'S', movement: 'Recebimento' }
  ] }], 'nov');
  assert.equal(result.length, 3);
});

test('série igual sem vínculo explícito não junta registros legados', () => {
  const result = groups([{ id: 'nov', items: [
    { id: 'old-1', serial: 'S', movement: 'Envio' },
    { id: 'old-2', serial: 'S', movement: 'Envio' }
  ] }], 'nov');
  assert.equal(result.length, 2);
});
