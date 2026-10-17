import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const branches = require('../inventory-branches.js');
const view = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
const globalStyles = readFileSync(new URL('../inventory-global.css', import.meta.url), 'utf8');
const client = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/080_inventory_global_sharing.sql', import.meta.url), 'utf8');
const branchSql = readFileSync(new URL('../supabase/081_inventory_branch_pagination.sql', import.meta.url), 'utf8');

test('categoria aparece nos detalhes do equipamento, mas não nas tabelas', () => {
  assert.doesNotMatch(view, /<th>CATEGORIA<\/th>/);
  const row = view.split('function inventoryRowMarkup(table, item) {')[1]?.split('function inventoryTableMarkup(table, visible) {')[0];
  assert.ok(row);
  assert.doesNotMatch(row, /inventory-category-name|inventory-branch-name/);
  assert.match(view, /field\('Categoria', table\?\.name\)/);
  assert.match(view, /colspan="10" class="inventory-empty-row">Nenhum equipamento nesta categoria/);
  assert.doesNotMatch(row, /inventory-image-cell|data-inv-image-key/);
});

test('um equipamento compartilhado usa o mesmo ID e estado nas duas ramificações', () => {
  const table = { name: 'Balanças', branches: [
    { id: 'principal', name: 'Checkout' },
    { id: 'extra', name: 'Setor' }
  ] };
  const item = { id: 'BAL05', branchId: 'principal', sharedBranchIds: ['extra', 'extra'],
    status: 'Manutenção' };
  assert.deepEqual(branches.branchesFor(table, item).map(branch => branch.id), ['principal', 'extra']);
  assert.equal(branches.inBranch(table, item, 'principal'), true);
  assert.equal(branches.inBranch(table, item, 'extra'), true);
  item.status = 'Ativo';
  assert.equal(item.status, 'Ativo');
  assert.equal(branches.branchesFor(table, item).length, 2);
});

test('categoria lista todos os registros em páginas e mantém recentes separados', () => {
  assert.match(view, /moduleApi\(\)\.categoryPage\(categoryFilters\(\)\)/);
  assert.match(view, /pageItems: page\.items, total: Number\(page\.total/);
  assert.match(view, /const results = matched;/);
  assert.doesNotMatch(view, /latestEquipment\(matched\)/);
  assert.match(view, /refreshCategoryPage\(\)/);
  assert.match(client, /async categoryPage\(filters\)/);
  assert.match(client, /client\.rpc\('inventory_global_page', parameters\)/);
  assert.match(client, /client\.rpc\('inventory_branch_page'/);
  assert.match(branchSql, /limit v_size offset \(v_page - 1\) \* v_size/i);
  assert.match(branchSql, /exists \(select 1 from public\.inventory_branch_memberships/i);
  assert.match(branchSql, /security invoker/i);
});

test('entrada global consulta no servidor, mostra cinco recentes e pagina sem carga integral', () => {
  assert.match(view, /moduleApi\(\)\.globalOverview\(\)/);
  assert.match(view, /moduleApi\(\)\.globalPage\(globalFilters\(\)\)/);
  assert.match(view, /data-inv-global-search/);
  assert.match(view, /setTimeout\(\(\) => \{ void refreshGlobalPage\(\); \}, 260\)/);
  assert.doesNotMatch(view, /data-inv-global-view/);
  assert.match(view, /data-inv-global-page/);
  assert.match(view, /globalState\.pageSize: 25|pageSize: 25/);
  assert.match(view, /shareDialog\(item\)/);
  assert.match(sql, /limit 5\s*\) r/i);
  assert.match(sql, /limit v_size offset \(v_page - 1\) \* v_size/i);
});

test('entrada global não exibe quadro redundante nem botão Ver todos', () => {
  const markup = view.split('function globalMarkup() {')[1]?.split('function ')[0];
  assert.ok(markup);
  assert.doesNotMatch(markup, /inventory-global-heading/);
  assert.match(markup, /inventory-global-search[^`]*data-inv-global-search/);
  assert.doesNotMatch(markup, /inventory-global-view-button|Ver todos/);
  assert.match(globalStyles, /\.inventory-global-search\{display:flex;align-items:center;justify-content:center/);
});

test('migração mantém um registro original, RLS e vínculos da mesma categoria', () => {
  assert.match(sql, /primary key \(item_id, branch_id\)/i);
  assert.match(sql, /foreign key \(item_id, table_id\) references public\.inventory_items\(id, table_id\)/i);
  assert.match(sql, /foreign key \(branch_id, table_id\) references public\.inventory_branches\(id, table_id\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /app\.can_manage_module\('inventory', 'update'\)/i);
  assert.match(sql, /insert into public\.inventory_item_logs/i);
  assert.match(sql, /insert into public\.inventory_branch_events/i);
  assert.match(sql, /create or replace function public\.inventory_global_overview\(\)/i);
  assert.match(sql, /create or replace function public\.inventory_global_page\(/i);
  assert.doesNotMatch(sql, /insert into public\.inventory_items/i);
  assert.match(client, /sharedBranchIds: sharesByItem\.get\(row\.id\) \|\| \[\]/);
  assert.match(client, /for \(const sharedId of new Set\(sourceItem\.sharedBranchIds \|\| \[\]\)\)/);
});
