import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const inventoryCss = readFileSync(new URL('../inventory.css', import.meta.url), 'utf8');
const glassCss = readFileSync(new URL('../glass-transparency.css', import.meta.url), 'utf8');

test('a lateral recolhida do Inventário não vira um painel vertical', () => {
  assert.match(inventoryCss, /\.inventory-layout \.inventory-table-sidebar\{min-height:0;align-self:start\}/);
  assert.match(inventoryCss, /\.inventory-layout:not\(\.tables-open\) \.inventory-table-sidebar\{bottom:auto\}/);
  assert.doesNotMatch(glassCss, /\.inventory-panel\.inventory-table-sidebar/);
});
