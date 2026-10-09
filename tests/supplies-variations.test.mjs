import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { groupInventory, project } = require('../supplies-inventory.js');
const { decorateLocal, alerts, health, orderItems, unitsForVariant } = require('../supplies-variations.js');

const tables = [{ id: 'table', module: 'inventory', name: 'Balanças' }];
const units = [
  { id: 'a', table_id: 'table', brand: 'Toledo', model: '8217', status: 'Reserva' },
  { id: 'b', table_id: 'table', brand: 'Toledo', model: '8217', status: 'Ativo' },
  { id: 'c', table_id: 'table', brand: 'Toledo', model: '9094', status: 'Reserva' },
  { id: 'd', table_id: 'table', brand: 'Toledo', model: '9094', status: 'Reserva' }
];
const manual = [{ id: 'parent', name: 'Balanças', inventory_group_key: 'balanças',
  available_stock: 0, total_units: 0, minimum_stock: 9, image_path: 'parent/image.webp' }];

test('modelos mantêm UUID, imagem individual ou herdada e mínimos após nova sincronização', () => {
  const group = groupInventory(tables, units)[0];
  const saved = group.variants.map((row, index) => ({ id: `variant-${index}`, supply_id: 'parent',
    inventory_variant_key: row.key, minimum_stock: index === 0 ? 3 : 0,
    image_path: index === 0 ? 'variant/photo.webp' : null }));
  const first = project(manual, [group], saved)[0];
  const second = project(manual, groupInventory(tables, units), saved)[0];
  assert.equal(first.minimum_stock, 3);
  assert.deepEqual(first, second);
  assert.equal(first.inventory_group.variants[0].id, 'variant-0');
  assert.equal(first.inventory_group.variants[0].image_path, 'variant/photo.webp');
  assert.equal(first.inventory_group.variants[1].image_path || first.image_path, 'parent/image.webp');
  assert.equal(first.inventory_group.units.find(row => row.id === 'a').variant_id, 'variant-0');
  assert.equal(first.stock_status, 'Estoque baixo');
  assert.equal(alerts([first]).length, 1);
  assert.equal(alerts([first])[0].missing, 2);
  const changed = units.map(row => row.id === 'a' ? { ...row, status: 'Ativo' } : row);
  const after = project(manual, groupInventory(tables, changed), saved)[0];
  assert.equal(after.available_stock, 2);
  assert.equal(after.active_count, 2);
  assert.equal(after.total_units, 4);
  assert.equal(alerts([after])[0].missing, 3);
  const restored = project(manual, groupInventory(tables, units), [{ ...saved[0], image_path: null }, saved[1]])[0];
  assert.equal(restored.inventory_group.variants[0].image_path || restored.image_path, 'parent/image.webp');
});

test('alertas são por modelo, ignoram mínimo zero, igualdade e modelo inativo', () => {
  const item = { source: 'inventory', id: 'item', name: 'Impressoras', available_stock: 15,
    minimum_stock: 10, inventory_group: { variants: [
      { id: 'a', name: 'MP-4200', brand: 'Bematech', model: 'MP-4200', reserve: 0, minimum_stock: 4 },
      { id: 'b', name: 'TM-T20', brand: 'Epson', model: 'TM-T20', reserve: 2, minimum_stock: 2 },
      { id: 'c', name: 'Outro', reserve: 0, minimum_stock: 0 },
      { id: 'd', name: 'Antigo', reserve: 0, minimum_stock: 8, disabled: true }
    ] } };
  assert.deepEqual(alerts([item]).map(row => row.variantId), ['a']);
  assert.equal(alerts([item])[0].missing, 4);
});

test('cores de cada variação distinguem margem, limite e ruptura sem falso alerta para mínimo zero', () => {
  const tones = [5, 4, 3, 2, 1, 0].map(reserve => health({ reserve, minimum_stock: 3 }).tone);
  assert.deepEqual(tones, ['healthy', 'one-above', 'at-minimum', 'below', 'below', 'below']);
  assert.equal(health({ reserve: 0, minimum_stock: 0 }).tone, 'unconfigured');
  assert.equal(health({ reserve: 5, minimum_stock: 0 }).tone, 'unconfigured');
});

test('suprimento local soma mínimos sem duplicar saldo legado e preserva inativos', () => {
  const item = { id: 'local', name: 'Cabos', tracking_type: 'quantity', quantity_stock: 2,
    minimum_stock: 3, available_stock: 6, inactive: false };
  const variants = [
    { id: 'v1', supply_id: 'local', name: 'USB-C', quantity_stock: 4, minimum_stock: 5, inactive: false },
    { id: 'v2', supply_id: 'local', name: 'Obsoleto', quantity_stock: 9, minimum_stock: 20, inactive: true }
  ];
  const decorated = decorateLocal(item, variants, []);
  assert.equal(decorated.minimum_stock, 8);
  assert.equal(decorated.variation_rows.length, 3);
  assert.equal(decorated.stock_status, 'Estoque baixo');
  assert.equal(alerts([decorated]).length, 2);
  assert.deepEqual(alerts([decorated]).map(row => row.missing), [1, 1]);
  const fromNewView = decorateLocal({ ...item, minimum_stock: 8, base_minimum_stock: 3 }, variants, []);
  assert.equal(fromNewView.minimum_stock, 8, 'não soma novamente o mínimo já consolidado pela view');
});

test('variações próprias exibem marca e modelo individuais sem herdar a marca do pai', () => {
  const item = { id: 'paint', name: 'Tinta', brand: 'Marca do produto', tracking_type: 'quantity',
    quantity_stock: 0, minimum_stock: 0, available_stock: 6, inactive: false };
  const variants = [
    { id: 'blue', supply_id: 'paint', name: '544', brand: 'Epson', model: '544',
      description: 'Azul', quantity_stock: 4, minimum_stock: 5 },
    { id: 'yellow', supply_id: 'paint', name: '544', brand: 'Outra marca', model: '544',
      description: 'Amarelo', quantity_stock: 2, minimum_stock: 2 }
  ];
  const decorated = decorateLocal(item, variants, []);
  assert.equal(decorated.variation_rows.length, 2);
  assert.deepEqual(decorated.variation_rows.map(row => [row.brand, row.model]),
    [['Epson', '544'], ['Outra marca', '544']]);
  assert.equal(alerts([decorated])[0].brand, 'Epson');
  assert.equal(alerts([decorated])[0].missing, 1);
});

test('migração 067 reusa identidade e rejeita colisões de edição sem mesclar histórico', () => {
  const sql = readFileSync(new URL('../supabase/067_supply_local_variant_identity.sql', import.meta.url), 'utf8');
  assert.match(sql, /supply_variants_local_identity_unique/);
  assert.match(sql, /existing_id is not null and p_id is null then/);
  assert.match(sql, /if existing_inactive then raise exception/);
  assert.match(sql, /return existing_id;/);
  assert.match(sql, /saldos e históricos não serão mesclados automaticamente/);
  assert.match(sql, /inventory_group_key is not null/);
  assert.doesNotMatch(sql, /update public\.supply_units/i);
  assert.doesNotMatch(sql, /update public\.supply_movements/i);
});

test('edição de variação ou unidade coloca o item próprio no topo sem alterar IDs e saldos', () => {
  const item = { id: 'item', name: 'Cabos', tracking_type: 'unit', updated_at: '2026-10-01T10:00:00Z',
    available_stock: 1, minimum_stock: 0, quantity_stock: 0 };
  const variants = [{ id: 'v1', supply_id: 'item', name: 'USB-C', quantity_stock: 0,
    updated_at: '2026-10-04T10:00:00Z' }];
  const units = [{ id: 'u1', supply_id: 'item', variant_id: 'v1', status: 'Em estoque',
    updated_at: '2026-10-08T10:00:00Z' }];
  const decorated = decorateLocal(item, variants, units);
  assert.equal(decorated.activity_at, units[0].updated_at);
  assert.equal(decorated.variation_rows[0].reserve, 1);
  assert.deepEqual(orderItems([{ id: 'old', name: 'Outros', updated_at: '2026-10-07T10:00:00Z' }, decorated])
    .map(row => row.id), ['item', 'old']);
});

test('unidades rastreáveis ficam na variação correta, inclusive saída e base, mantendo a ordem de atualização', () => {
  const rows = [
    { id: 'recent', variant_id: 'blue', status: 'Em estoque', updated_at: '2026-10-09' },
    { id: 'base', variant_id: null, status: 'Em estoque', updated_at: '2026-10-08' },
    { id: 'exited', variant_id: 'blue', status: 'Em estoque', exited_at: '2026-10-07', updated_at: '2026-10-07' },
    { id: 'other', variant_id: 'red', status: 'Instalado', updated_at: '2026-10-06' }
  ];
  assert.deepEqual(unitsForVariant(rows, { id: 'blue' }).map(row => row.id), ['recent', 'exited']);
  assert.deepEqual(unitsForVariant(rows, { id: 'base:item', base: true }).map(row => row.id), ['base']);
  assert.deepEqual(unitsForVariant(rows, null).map(row => row.id), rows.map(row => row.id));
  assert.deepEqual(rows.map(row => row.id), ['recent', 'base', 'exited', 'other'], 'não reordena nem altera a origem');
});

test('migração 064 protege escrita, vincula modelos e audita mínimo e imagem', () => {
  const sql = readFileSync(new URL('../supabase/064_supply_variant_metadata.sql', import.meta.url), 'utf8');
  assert.match(sql, /supply_variants_inventory_key_unique/);
  assert.match(sql, /app\.guard_inventory_supply_variant/);
  assert.match(sql, /app\.is_admin\(\)/);
  assert.match(sql, /supply_ensure_inventory_variants_batch/);
  assert.match(sql, /supply_set_inventory_variant_minimum/);
  assert.match(sql, /supply_logs\(supply_id,variant_id,action/);
  assert.doesNotMatch(sql, /insert into public\.inventory_items/i);
});
