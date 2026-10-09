import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { timeline, supplyEntry, movementEntry } = require(resolve(root, 'supplies-log.js'));

test('logs de edição resumem campos legíveis sem expor snapshots técnicos', () => {
  const row = {
    id: 'one', action: 'Item editado', created_at: '2026-10-08T12:00:00Z', actor_name: 'Ricardo',
    old_value: JSON.stringify({ id: 'technical-id', name: 'Balanças', minimum_stock: 2, image_path: 'private/old.png' }),
    new_value: JSON.stringify({ id: 'technical-id', name: 'Balanças', minimum_stock: 4, image_path: 'private/new.png' })
  };
  const entry = supplyEntry(row);
  assert.equal(entry.message, 'Estoque mínimo: 2 → 4');
  assert.equal(entry.actor, 'Ricardo');
  assert.doesNotMatch(JSON.stringify(entry), /technical-id|private\/|\"minimum_stock\"/);
});

test('edição apenas de imagem não duplica o evento próprio da imagem', () => {
  assert.equal(supplyEntry({ action: 'Item editado', old_value: '{"image_path":"a.png"}', new_value: '{"image_path":"b.png"}' }), null);
});

test('histórico reúne logs das unidades reais do Inventário em ordem cronológica', () => {
  const units = [{ id: 'unit-1', variant_id: 'variant-1', tag: 'TAG 123', brand: 'Toledo', model: '8217' }];
  const rows = timeline(
    [{ id: 'supply-1', action: 'Mínimo alterado', created_at: '2026-10-08T09:00:00Z', new_value: '3' }],
    [
      { id: 'inventory-1', inventory_item_id: 'unit-1', message: 'Local alterado.', created_at: '2026-10-08T10:00:00Z' },
      { id: 'other', inventory_item_id: 'unrelated', message: 'Outro equipamento', created_at: '2026-10-08T11:00:00Z' }
    ], units
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.source), ['Inventário', 'Suprimentos']);
  assert.equal(rows[0].title, 'TAG 123');
  assert.equal(rows[0].variant_id, 'variant-1');
});

test('log da unidade local herda somente sua variação real quando o evento não a repete', () => {
  const rows = timeline([
    { id: 'edit', supply_unit_id: 'unit-blue', action: 'Unidade editada', created_at: '2026-10-09T10:00:00Z' },
    { id: 'base', supply_unit_id: 'unit-base', action: 'Unidade criada', created_at: '2026-10-08T10:00:00Z' },
    { id: 'parent', action: 'Item editado', created_at: '2026-10-07T10:00:00Z' }
  ], [], [
    { id: 'unit-blue', variant_id: 'blue' }, { id: 'unit-base', variant_id: null }
  ]);
  assert.equal(rows.find(row => row.id === 'edit').variant_id, 'blue');
  assert.equal(rows.find(row => row.id === 'base').variant_id, null);
  assert.equal(rows.find(row => row.id === 'base').supply_unit_id, 'unit-base');
  assert.equal(rows.find(row => row.id === 'parent').supply_unit_id, null);
});

test('movimentação de quantidade conserva a identidade da variação no histórico filtrado', () => {
  const entry = movementEntry({ id: 'move', variant_id: 'blue', type: 'Saída', quantity: 2,
    previous_stock: 6, new_stock: 4, reason: 'Consumo', created_at: '2026-10-09T11:00:00Z' });
  assert.equal(entry.variant_id, 'blue');
  assert.equal(entry.title, 'Saída de estoque');
  assert.match(entry.message, /2 unidade\(s\) · 6 → 4 disponíveis/);
  assert.equal(entry.context, 'Consumo');
});

test('a tela carrega o histórico compartilhado e não sombreia o histórico do navegador', () => {
  const ui = readFileSync(resolve(root, 'supplies.js'), 'utf8');
  const api = readFileSync(resolve(root, 'supplies-api.js'), 'utf8');
  assert.match(ui, /supplyHistory\.timeline/);
  assert.match(ui, /api\.inventoryGroupHistory\(item\.inventory_group\.units\.map/);
  assert.doesNotMatch(ui, /const history = window\.AldeckotSupplyHistory/);
  assert.match(api, /from\('inventory_item_logs'\)/);
  assert.match(api, /'inventory_item_logs'\]/);
});
