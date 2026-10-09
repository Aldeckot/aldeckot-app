import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../nfe.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');

test('Fiscal NF-e pagina a partir de 25 e preserva opções coerentes com a consulta', () => {
  assert.match(source, /const pageSizes = \[10, 25, 50, 100\]/);
  assert.match(source, /pageSizes\.includes\(savedPageSize\) \? savedPageSize : 25/);
  assert.match(source, /localStorage\.setItem\(pageSizeKey, String\(size\)\)/);
  assert.match(client, /\[10, 25, 50, 100\]\.includes\(requestedPageSize\) \? requestedPageSize : 25/);
});

test('Fiscal NF-e retorna à última página válida após redução do conjunto', () => {
  assert.match(source, /const lastPage = Math\.max\(1, Math\.ceil\(records\.count \/ state\.pageSize\)\)/);
  assert.match(source, /if \(state\.page > lastPage\) \{[\s\S]*?state\.page = lastPage;[\s\S]*?api\(\)\.load\(/);
});
