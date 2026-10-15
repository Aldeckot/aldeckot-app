import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');

test('Inventário, Controle TI e Flux compartilham a paginação de 25 registros', () => {
  assert.match(source, /const pageSizes = \[10, 25, 50, 100\]/);
  assert.match(source, /state\.pageSize = pageSizes\.includes\(savedPageSize\) \? savedPageSize : 25/);
  assert.match(source, /const scope = scopedItems\(table\)/);
  assert.match(source, /const matched = scope\.filter\(matchesActiveFilters\)/);
  assert.match(source, /results\.slice\(\(state\.page - 1\) \* state\.pageSize, state\.page \* state\.pageSize\)/);
  assert.match(source, /state\.page = Math\.max\(1, Math\.min\(state\.page, lastPage\)\)/);
  for (const page of ['inventory.html', 'control.html', 'flux.html']) {
    assert.match(readFileSync(new URL(`../${page}`, import.meta.url), 'utf8'), /inventory-pagination\.css\?v=2\.0\.82/);
  }
});
