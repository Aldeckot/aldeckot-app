import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const window = {};
vm.runInNewContext(readFileSync(new URL('../equipment-cleaning.js', import.meta.url), 'utf8'), { window });
const { canonicalType, groupAlerts } = window.AldeckotEquipmentCleaning;

const alerts = [
  { source_module: 'management', source_id: 'position', equipment_id: 'pc', position_id: 'position',
    equipment: 'Computador de teste', tag: 'PC1', pdv: 'PDV 3',
    last_performed_at: '2026-09-30T14:00:00Z', due_on: '2026-11-30', overdue: false },
  { source_module: 'inventory', source_id: 'printer', table_id: 'printers', equipment_id: 'printer',
    position_id: 'position', equipment: 'Impressora de teste', serial: 'SR1', pdv: 'PDV 3',
    last_performed_at: '2026-10-15T14:00:00Z', due_on: '2026-11-15', overdue: true }
];

test('os tipos de limpeza são distintos da situação física e aceitam a grafia legada', () => {
  assert.equal(canonicalType('Não Realizada'), 'Não realizada');
  assert.equal(canonicalType('Regular'), 'Regular');
  assert.equal(canonicalType('Alta'), '');
  assert.equal(canonicalType('Média'), '');
  assert.equal(canonicalType('Em uso'), '');
});

test('o sino agrupa computador e periférico por PDV, com datas e severidade individual', () => {
  const notices = groupAlerts(alerts);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, 'Alta');
  assert.equal(notices[0].targetUrl, 'management.html?item=position');
  assert.match(notices[0].description, /Impressora de teste · Série SR1 · última limpeza 15\/10\/2026 · venceu em 15\/11\/2026/);
  assert.match(notices[0].description, /Computador de teste · TAG PC1 · última limpeza 30\/09\/2026 · vence em 30\/11\/2026/);
  assert.equal(notices[0].acknowledgeable, false);
  const remaining = groupAlerts(alerts.slice(0, 1));
  assert.equal(remaining[0].stateKey, notices[0].stateKey);
  assert.equal(remaining[0].level, 'Média');
  assert.doesNotMatch(remaining[0].description, /Impressora/);
});

test('o Inventário aponta para a ficha do periférico e o aviso segue uma transferência', () => {
  const notices = groupAlerts(alerts, 'inventory');
  assert.equal(notices[0].targetUrl, 'inventory.html?table=printers&item=printer');
  assert.doesNotMatch(notices[0].description, /Computador/);
  const transferred = groupAlerts([alerts[0], { ...alerts[1], pdv: 'PDV 4', position_id: 'other' }], 'management');
  assert.equal(transferred.length, 2);
  assert.equal(transferred.find(row => row.urgent).targetUrl, 'management.html?item=other');
});
