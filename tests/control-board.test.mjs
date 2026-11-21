import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const board = require('../control-board.js');

test('classificação legada só usa correspondências inequívocas e mantém limpeza separada', () => {
  assert.equal(board.statusFor({ status: 'Manutenção concluída' }), 'Concluído');
  assert.equal(board.statusFor({ status: 'Em uso' }), 'Em uso');
  for (const status of ['Aguardando avaliação', 'Verificação concluída', 'Em sala', 'Cancelado']) {
    assert.equal(board.statusFor({ status }), '');
    assert.equal(board.situationFor({ status, situation: 'Preventiva' }), '');
  }
  const item = { status: 'Manutenção concluída', operationalStatus: 'Em uso', operationalSituation: 'Aguardando peça' };
  assert.equal(board.statusFor(item), 'Em uso');
  assert.equal(board.situationFor(item), 'Aguardando peça');
});

test('busca e filtros operacionais não usam limpeza como Situação', () => {
  const item = { equipment: 'Balança', serial: 'S2309', status: 'Em manutenção', situation: 'Regular' };
  assert.equal(board.matches(item, { query: 'balanca', status: 'Em manutenção', situation: '__missing__' }), true);
  assert.equal(board.matches(item, { query: 'S2309', situation: 'Regular' }), false);
  assert.equal(board.matches({ ...item, operationalSituation: 'Aguardando peça' },
    { status: 'Em manutenção', situation: 'Aguardando peça' }), true);
  assert.equal(board.matches(item, { query: 'não localizado' }), false);
});

test('períodos são ordenados pela data do nome e os gráficos representam situação ausente', () => {
  const periods = board.periods([{ name: 'Setembro 2026' }, { name: 'ABRIL 2026' }, { name: 'OUTUBRO / 2026' }]);
  assert.deepEqual(periods.map(table => table.name), ['OUTUBRO / 2026', 'Setembro 2026', 'ABRIL 2026']);
  const sidebar = board.sidebar([
    { status: 'Em manutenção' },
    { status: 'Em manutenção', operationalSituation: 'Aguardando peça' }
  ], true);
  assert.match(sidebar, /2 registros por situação/);
  assert.match(sidebar, /Aguardando peça<b>1<\/b>/);
  assert.match(sidebar, /Sem situação definida<b>1<\/b>/);
  assert.deepEqual(board.statusCounts([
    { status: 'Em manutenção' }, { status: 'Manutenção concluída' }, { status: 'Em sala' }
  ]), { 'Em manutenção': 1, 'Concluído': 1, 'Em uso': 0, 'Descartado': 0, 'Status a revisar': 1 });
  assert.equal((sidebar.match(/data-inv-action=/g) || []).length, 4);
});
