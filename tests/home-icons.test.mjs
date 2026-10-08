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

test('a busca e o calendário da Home usam ícones vetoriais consistentes', () => {
  const agenda = read('agenda.js');
  const iconStyles = read('home-icon-refresh.css');
  const index = read('index.html');
  assert.match(agenda, /calendarIcon = '<svg[^']+aria-hidden="true"/);
  assert.match(agenda, /home-cal-title-icon/);
  assert.match(iconStyles, /\.home-cal-title > i::before/);
  assert.match(iconStyles, /\.home-search \.search-icon::before/);
  assert.match(index, /home-icon-refresh\.css\?v=2\.0\.71/);
});
