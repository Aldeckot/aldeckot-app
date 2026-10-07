import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('os painéis da Home usam ícones vetoriais próprios em todos os estados', () => {
  const home = read('home.js');
  const operations = read('operational-dashboard.js');
  assert.match(home, /recentItemsIcon = '<svg[^']+aria-hidden="true"/);
  assert.equal((home.match(/\$\{recentItemsIcon\}/g) || []).length, 3);
  assert.match(operations, /operationsIcon = '<svg[^']+aria-hidden="true"/);
  assert.match(operations, /<span>\$\{operationsIcon\}<\/span>/);
  assert.doesNotMatch(home, /home-recent-icon">◈/);
  assert.doesNotMatch(operations, /<span>▥<\/span>/);
  assert.match(read('operational-dashboard.css'), /\.home-recent-icon svg,\.operations-heading>div>span svg/);
});
