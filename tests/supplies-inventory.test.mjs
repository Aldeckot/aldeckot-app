import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { alias, groupInventory, project } = require('../supplies-inventory.js');
const tables = [
  { id: 'table-a', module: 'inventory', name: 'IMPRESSORAS 🖨️' },
  { id: 'table-b', module: 'inventory', name: 'Impressoras' },
  { id: 'other', module: 'control', name: 'Impressoras' }
];
const inventory = [
  { id: 'a', table_id: 'table-a', equipment: 'Impressora', brand: 'Epson', model: 'TM-T20X', tag: 'IMPR001', status: 'Ativo', location: 'Caixa 01' },
  { id: 'b', table_id: 'table-b', equipment: 'Impressora', brand: ' epson ', model: 'tm-t20x ', tag: 'IMPR002', status: 'Reserva', location: 'CPD' },
  { id: 'c', table_id: 'table-a', equipment: 'Impressora', brand: 'Epson', model: 'TM-T20III', tag: 'IMPR003', status: 'Manutenção' },
  { id: 'd', table_id: 'table-a', equipment: 'Impressora', brand: 'Outra', model: 'TM-T20X', tag: 'IMPR004', status: 'Ativo' },
  { id: 'ignored', table_id: 'other', equipment: 'Impressora', status: 'Reserva' }
];

test('agrupamento usa IDs físicos e não duplica tabela, unidade ou modelo', () => {
  const group = groupInventory(tables, [...inventory, inventory[0]])[0];
  assert.equal(group.total, 4);
  assert.equal(group.units.length, 4);
  assert.equal(group.variants.length, 3);
  assert.deepEqual(group.variants.map(row => row.total).sort(), [1, 1, 2]);
  assert.equal(group.variants.find(row => row.total === 2).reserve, 1);
  assert.equal(group.units.find(row => row.id === 'b').tag, 'IMPR002');
  assert.equal(group.units.find(row => row.id === 'a').location, 'Caixa 01');
});

test('unidade mais recente e grupo espelhado preservam a data de atividade', () => {
  const dated = inventory.map((row, index) => ({ ...row,
    updated_at: `2026-10-0${index + 1}T10:00:00Z` }));
  const group = groupInventory(tables, dated)[0];
  assert.equal(group.units[0].id, 'd');
  assert.equal(group.variants.find(row => row.total === 2).units[0].id, 'b');
  const projected = project([], [group])[0];
  assert.equal(projected.activity_at, dated[3].updated_at);
});

test('Estoque e Indicador vêm apenas dos status reais; sincronizar novamente é idempotente', () => {
  const manual = [{ id: 'metadata', name: 'impressora', tracking_type: 'quantity', available_stock: 0,
    total_units: 0, minimum_stock: 2, image_path: 'metadata/photo.webp' }];
  const first = project(manual, groupInventory(tables, inventory));
  const second = project(manual, groupInventory(tables, inventory));
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].manual_id, 'metadata');
  assert.equal(first[0].image_path, 'metadata/photo.webp');
  assert.equal(first[0].available_stock, 1);
  assert.equal(first[0].active_count, 2);
  assert.equal(first[0].stock_status, 'Normal', 'mínimo legado sem modelo não é aplicado arbitrariamente');
  const changed = inventory.map(row => row.id === 'a' ? { ...row, status: 'Reserva' } : row);
  const after = project(manual, groupInventory(tables, changed))[0];
  assert.equal(after.available_stock, 2);
  assert.equal(after.active_count, 1);
  assert.equal(after.stock_status, 'Normal');
  assert.equal(after.inventory_group.units.find(row => row.id === 'a').tag, 'IMPR001');
  const restored = changed.map(row => row.id === 'b' ? { ...row, status: 'Ativo' } : row);
  const afterReturn = project(manual, groupInventory(tables, restored))[0];
  assert.equal(afterReturn.available_stock, 1);
  assert.equal(afterReturn.active_count, 2);
});

test('não absorve cadastro manual com estoque independente', () => {
  const manual = [{ id: 'standalone', name: 'impressora', tracking_type: 'quantity', available_stock: 4,
    total_units: 0, minimum_stock: 1 }];
  const rows = project(manual, groupInventory(tables, inventory));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].id, 'standalone');
});

test('cadastro manual reconhece o nome singular ou plural de um tipo já integrado', () => {
  assert.equal(alias('Impressora'), alias('IMPRESSORAS'));
  const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
  assert.match(ui, /inventoryCatalog\.alias\(row\.name\) === inventoryCatalog\.alias\(data\.get\('name'\)\)/);
});

test('chave persistente recupera metadados sem depender do nome visível', () => {
  const manual = [{ id: 'linked', name: 'Nome personalizado', inventory_group_key: 'impressoras',
    tracking_type: 'unit', available_stock: 0, total_units: 0, minimum_stock: 2, image_path: 'linked/photo.webp', inactive: true }];
  const [row] = project(manual, groupInventory(tables, inventory));
  assert.equal(row.id, 'linked');
  assert.equal(row.image_path, 'linked/photo.webp');
  assert.equal(row.inventory_group.variants.length, 3);
  assert.equal(row.inactive, false, 'o status operacional vem sempre do Inventário');
});

test('formulário de variação inicia oculto e o mínimo mantém a visualização própria', () => {
  const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
  assert.match(ui, /variantFormOpen: false/);
  assert.match(ui, /canEdit\(\) && state\.variantFormOpen/);
  assert.match(ui, /action === 'variant-cancel'.*state\.variantFormOpen = false/);
  assert.match(ui, /action === 'below-minimum'.*belowMinimumDialog\(\)/);
});

test('migração de substituição preserva IDs físicos e usa operação transacional', () => {
  const sql = readFileSync(new URL('../supabase/060_inventory_replacements.sql', import.meta.url), 'utf8');
  assert.match(sql, /create unique index if not exists supplies_inventory_group_key_unique/);
  assert.match(sql, /references public\.inventory_items\(id\) on delete set null/);
  assert.match(sql, /create or replace function public\.inventory_replace_equipment/);
  assert.match(sql, /order by id for update/);
  assert.match(sql, /insert into public\.inventory_item_logs/);
  assert.doesNotMatch(sql, /insert into public\.inventory_items/i);
});

test('Reserva, Manutenção e Inativo alteram apenas a disponibilidade projetada', () => {
  const five = Array.from({ length: 5 }, (_, index) => ({
    id: `unit-${index}`, table_id: 'table-b', equipment: 'Impressora', tag: `IMPR ${index + 1}`,
    model: 'TM-T20X', status: 'Reserva'
  }));
  const base = project([], groupInventory(tables, five))[0];
  assert.equal(base.total_units, 5);
  assert.equal(base.available_stock, 5);
  const changed = five.map((row, index) => index === 2 ? { ...row, status: 'Manutenção' } : row);
  const maintenance = project([], groupInventory(tables, changed))[0];
  assert.equal(maintenance.total_units, 5);
  assert.equal(maintenance.available_stock, 4);
  assert.equal(maintenance.inventory_group.maintenance, 1);
  const retired = changed.map((row, index) => index === 3 ? { ...row, status: 'Inativo' } : row);
  const inactive = project([], groupInventory(tables, retired))[0];
  assert.equal(inactive.total_units, 5);
  assert.equal(inactive.available_stock, 3);
  assert.equal(inactive.inventory_group.inactive, 1);
  assert.equal(inactive.inventory_group.variants[0].inactive, 1);
  assert.equal(inactive.inventory_group.variants[0].maintenance, 1);
  assert.equal(inactive.inventory_group.units.find(row => row.id === 'unit-3').tag, 'IMPR 4');
  const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
  assert.match(ui, /<span>Inativos<\/span>/);
  assert.match(ui, /<span>Em manutenção<\/span>/);
});

test('migração 061 protege a origem, variações e eventos do Flux no banco', () => {
  const sql = readFileSync(new URL('../supabase/061_integrated_inventory_supplies.sql', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
  assert.match(sql, /create trigger inventory_supply_catalog_read_only/);
  assert.match(sql, /Itens sincronizados do Inventário permitem editar somente a imagem/);
  assert.match(sql, /create or replace function public\.supply_set_variant_active/);
  assert.match(sql, /create trigger flux_maintenance_inventory_sync/);
  assert.match(sql, /control_changed := app\.sync_inventory_maintenance_to_control\(item\.id\)/);
  assert.match(sql, /unique \(source_module, source_id, event_type\)/);
  assert.match(sql, /Equipamento TAG % não localizado no Inventário/);
  assert.match(sql, /where s\.deleted_at is null/);
  assert.match(ui, /Sincronizado do Inventário\. TAG, modelo, status, quantidade e localização são somente leitura/);
  assert.match(ui, /variantActiveDialog/);
  assert.doesNotMatch(ui, /data-sp-action="image-supply"|data-sp-action="image-variant"/);
});

test('ações novas aguardam confirmação real da migração no banco', () => {
  const api = readFileSync(new URL('../supplies-api.js', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
  const inventoryUi = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
  assert.match(api, /from\('equipment_sync_events'\)\.select\('id'\)\.limit\(1\)/);
  assert.match(api, /return Array\.isArray\(result\.data\)/);
  assert.match(ui, /state\.integrationReady === false/);
  assert.match(ui, /state\.integrationReady \? '<button data-sp-action="delete"/);
  assert.match(ui, /state\.integrationReady \? `<button data-sp-action="variant-active"/);
  assert.match(inventoryUi, /statuses\[3\] = inventoryIntegrationReady \? 'Inativo' : 'Troca'/);
});

test('substituição patrimonial é executada na fonte Inventário, não em Suprimentos', () => {
  const inventoryUi = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
  const suppliesUi = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
  assert.match(inventoryUi, /data-inv-replace-form/);
  assert.match(inventoryUi, /<option value="" selected disabled>Selecione o substituto<\/option>/);
  assert.match(inventoryUi, /<option value="" selected disabled>Selecione o status<\/option>/);
  assert.match(inventoryUi, /moduleApi\(\)\.replaceEquipment/);
  assert.match(api, /client\.rpc\('inventory_replace_equipment', values\)/);
  assert.doesNotMatch(suppliesUi, /inventory-replace|inventoryReplaceDialog/);
});
