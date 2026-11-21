import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inventoryCss = readFileSync(new URL('../inventory.css', import.meta.url), 'utf8');
const glassCss = readFileSync(new URL('../glass-transparency.css', import.meta.url), 'utf8');
const inventoryView = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');

test('a lateral recolhida do Inventário não vira um painel vertical', () => {
  assert.match(inventoryCss, /\.inventory-layout \.inventory-table-sidebar\{min-height:0;align-self:start\}/);
  assert.match(inventoryCss, /\.inventory-layout:not\(\.tables-open\) \.inventory-table-sidebar\{bottom:auto\}/);
  assert.doesNotMatch(glassCss, /\.inventory-panel\.inventory-table-sidebar/);
});

test('as Homes permanecem disponíveis e a casa retorna à visão geral', () => {
  assert.match(inventoryView, /sidebarOpen: false/);
  const selection = inventoryView.split("const chosen = event.target.closest('[data-inv-table]');")[1]?.split("const editTable =")[0];
  assert.ok(selection);
  assert.match(selection, /state\.sidebarOpen = false/);
  assert.match(inventoryView, /active: null, overview: true, sidebarOpen: false/);
  assert.match(inventoryView, /if \(event\.target\.closest\('\[data-inv-global-home\]'\)\) \{\s*await showModuleHome\(\)/);
  assert.match(inventoryView, /const moduleHomeButton = event\.target\.closest\('\[data-inv-module-home\]'\)/);
  assert.match(inventoryView, /data-module-home-table-select/);
  assert.match(inventoryView, /if \(type === 'toggle-tables'\) \{ state\.sidebarOpen = !state\.sidebarOpen/);
});
