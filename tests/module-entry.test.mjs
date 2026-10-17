import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = name => readFileSync(resolve(root, name), 'utf8');

for (const [module, page] of [['control', 'control.html'], ['flux', 'flux.html']]) {
  test(`${module} inicializa mesmo se o catálogo de imagens não estiver disponível`, () => {
    assert.match(source(page), /inventory\.js\?v=/);
    assert.match(source(page), /inventory-images\.js\?v=/);
    assert.match(source(page), /equipment-images\.js\?v=/);
    assert.match(source(page), /module-home\.js\?v=/);
    assert.ok(source(page).indexOf('module-home.js') < source(page).indexOf('inventory.js'));
    const window = { location: { search: '' }, addEventListener() {} };
    const document = {
      body: { dataset: { module } },
      querySelectorAll() { return []; },
      addEventListener() {}
    };
    runInNewContext(source('inventory.js'), { window, document, URLSearchParams, Map, Set, Date, console });
    assert.equal(typeof window.openInventory, 'function');
  });
}

test('Suprimentos mostra dados iniciais antes da sincronização complementar', () => {
  const code = source('supplies.js');
  const load = code.slice(code.indexOf('  const load = async () => {'), code.indexOf('  const loadDetail = async () => {'));
  const start = code.slice(code.indexOf('  const start = async () => {'), code.indexOf('  window.AldeckotSuppliesOpenDetails'));
  assert.ok(load.indexOf('state.items = variations.orderItems(projected)') < load.indexOf('await integrationPromise'));
  assert.ok(load.indexOf('AldeckotModuleStage?.reveal?.()') < load.indexOf('await integrationPromise'));
  assert.ok(start.indexOf('AldeckotModuleStage?.reveal?.()') < start.indexOf('await load()'));
  assert.match(code, /if \(!state\.initialized && !state\.error\) return '<p class="sp-muted aldeckot-inline-loading"/);
  assert.match(code, /const canEdit = \(\) => Boolean\(window\.AldeckotAuth\?\.isAdmin\) && !state\.error && !state\.bootSyncing/);
});
