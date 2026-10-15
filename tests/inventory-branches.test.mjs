import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const branches = require('../inventory-branches.js');
const source = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/079_inventory_branches.sql', import.meta.url), 'utf8');

test('classificação exata por categoria, ignorando caixa, espaços e acentos', () => {
  assert.equal(branches.proposal(' Balanças ', ' BALANÇA   PDV '), 'Balanças de Checkout');
  assert.equal(branches.proposal('Balanças', 'Balança Prix'), 'Balanças de Setor');
  assert.equal(branches.proposal('Impressoras', 'impressora termica'), 'Impressoras de Checkout');
  assert.equal(branches.proposal('Impressoras', 'Impressora Térmica XL'), 'Impressoras de Setor');
  assert.equal(branches.proposal('Máquinas de Cartão', 'PIN PAD'), 'Pin Pads de PDV');
  assert.equal(branches.proposal('Máquinas de Cartão', 'Maquininha'), 'Maquininhas de Cartão');
});

test('não classifica categorias fora do escopo nem nomes vazios', () => {
  assert.equal(branches.proposal('Nobreaks', 'Balança PDV'), null);
  assert.equal(branches.proposal('Leitores', 'Pin Pad'), null);
  assert.equal(branches.proposal('Balanças', '  '), null);
});

test('escolha manual prevalece e contagens não duplicam IDs', () => {
  const table = { name: 'Balanças', branches: [
    { id: 'checkout', name: 'Balanças de Checkout' }, { id: 'setor', name: 'Balanças de Setor' }
  ], items: [
    { id: '1', tag: 'BAL001', equipment: 'Balança PDV', branchId: null },
    { id: '2', tag: 'BAL002', equipment: 'Balança PDV', branchId: 'setor' }
  ] };
  assert.equal(branches.branchFor(table, table.items[0]).id, 'checkout');
  assert.equal(branches.branchFor(table, table.items[1]).id, 'setor');
  table.branches[0].name = 'Checkout da Loja';
  table.branches[0].classificationKey = 'Balanças de Checkout';
  assert.equal(branches.branchFor(table, table.items[0]).id, 'checkout');
  table.name = 'Pesagem da Loja';
  assert.equal(branches.branchFor(table, table.items[0]).id, 'checkout');
  assert.equal(table.items.filter(item => branches.inBranch(table, item, 'checkout')).length, 1);
  assert.equal(table.items.filter(item => branches.inBranch(table, item, 'setor')).length, 1);
  const report = branches.simulation([table]);
  assert.equal(report.total, 2);
  assert.equal(report.rows[1].current, 'Balanças de Setor');
});

test('migração prepara vínculo sem atualizar equipamentos existentes', () => {
  assert.match(migration, /add column if not exists branch_id uuid/i);
  assert.match(migration, /on delete set null \(branch_id\)/i);
  assert.match(migration, /Realocar os equipamentos antes de excluir/i);
  assert.match(migration, /inventory_swap_locations/i);
  assert.doesNotMatch(migration, /update public\.inventory_items set branch_id/i);
  assert.match(source, /const scope = scopedItems\(table\)/);
  assert.match(source, /shown\.map\(item => inventoryRowMarkup\(table, item\)\)/);
});

test('079 funciona após a centralização sem owner_id nas categorias', () => {
  const centralized = readFileSync(new URL('../supabase/014_centralized_realtime.sql', import.meta.url), 'utf8');
  assert.match(centralized, /alter table public\.module_tables drop column if exists owner_id/i);
  assert.doesNotMatch(migration, /\bt\.owner_id\b/i);
  assert.doesNotMatch(migration, /inventory_branches\s*\([^;]*owner_id uuid/i);
  assert.match(migration, /alter table public\.inventory_branches alter column owner_id drop not null/i);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/m);
});

test('categoria mostra cinco equipamentos distintos pela alteração real mais recente', () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    id: String(index + 1),
    updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
    logs: []
  }));
  rows[0].logs.push({ createdAt: '2026-10-14T14:00:00Z' });
  rows.push({ ...rows[0], updatedAt: '2026-10-01T12:00:00Z', logs: [] });
  const latest = branches.latestEquipment(rows);
  assert.equal(latest.length, 5);
  assert.equal(new Set(latest.map(item => item.id)).size, 5);
  assert.equal(latest[0].id, '1');
  assert.deepEqual(latest.map(item => item.id), ['1', '7', '6', '5', '4']);
  assert.equal(branches.lastChangedAt({ updatedAt: '', logs: [{ at: 'ontem' }] }), 0);
});

test('categoria e ramificações não herdam o limite de cinco recentes', () => {
  assert.doesNotMatch(source, /recentMode \? branchModel\.latestEquipment\(matched\) : matched/);
  assert.match(source, /const results = matched;/);
  assert.match(source, /moduleApi\(\)\.categoryPage\(categoryFilters\(\)\)/);
  assert.match(source, /data-inv-branch-home/);
  assert.match(source, /inv-equipment-detail-dialog/);
  assert.match(source, /data-inv-image-key/);
});
