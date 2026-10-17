import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const catalog = require('../supplies-inventory.js');
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('Suprimentos preserva status de cada equipamento compartilhado do Inventário', () => {
  const groups = catalog.groupInventory([{ id: 'monitors', module: 'inventory', name: 'MONITORES' }], [
    { id: 'one', table_id: 'monitors', equipment: 'VISORAJ', tag: 'MON001', status: 'Ativo' },
    { id: 'two', table_id: 'monitors', equipment: 'VISORAJ', tag: 'MON002', status: 'Reserva' }
  ]);
  assert.deepEqual(groups[0].units.map(unit => unit.status), ['Ativo', 'Reserva']);
  const projected = catalog.project([], groups);
  assert.deepEqual(projected[0].inventory_group.units.map(unit => unit.status), ['Ativo', 'Reserva']);
  const ui = read('supplies.js');
  assert.match(ui, /originEquipmentFor\(unit\)\?\.status/);
  assert.match(ui, /<th>Status do estoque<\/th><th>Status do equipamento<\/th>/);
  assert.match(ui, /\$\{img\(row\.image_path\)\}/);
});

test('status próprio de Suprimentos é independente do estoque e exige migração 083', () => {
  const sql = read('supabase/083_supply_equipment_status.sql');
  const api = read('supplies-api.js');
  const ui = read('supplies.js');
  assert.match(sql, /add column if not exists equipment_status text not null default 'Ativo'/);
  assert.match(sql, /inventory_group_key is null and deleted_at is null/);
  assert.match(sql, /app\.can_manage_module\('supplies', 'update'\)/);
  assert.match(api, /select\('id,equipment_status'\)/);
  assert.match(api, /setEquipmentStatus: \(id, status\) => rpc\('supply_set_equipment_status'/);
  assert.match(ui, /name="equipment_status"/);
  assert.match(ui, /Aguardando migração 083/);
});

test('fotos e ações seguem os detalhes, com imagem do PC editada apenas no formulário', () => {
  const inventory = read('inventory.js');
  const management = read('management.js');
  const actions = read('action-menus.js');
  assert.match(inventory, /top\.className = 'inv-source-layout'/);
  assert.doesNotMatch(inventory.split('function inventoryRowMarkup(table, item) {')[1]?.split('function inventoryTableMarkup(table, visible) {')[0], /data-inv-image-key/);
  assert.match(management, /if \(state\.modal\?\.type !== 'details' \|\| !item\?\.imagePath\) return/);
  assert.match(management, /if \(state\.modal\?\.type === 'edit'\) mountComputerImageEditor\(activeItem\(\)\)/);
  assert.match(actions, /\.nfe-modal-actions/);
  assert.match(actions, /\.management-log-actions/);
  assert.match(actions, /\.sp-compat-card \.sp-card-actions/);
});
