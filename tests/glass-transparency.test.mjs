import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');
const css = read('glass-transparency.css');

test('todos os módulos principais carregam o mesmo acabamento de vidro', () => {
  for (const page of ['index', 'inventory', 'control', 'flux', 'management', 'nfe', 'supplies', 'settings']) {
    assert.match(read(`${page}.html`), /glass-transparency\.css\?v=\d+\.\d+\.\d+/);
  }
});

test('vidro mantém desfoque nos dois temas sem encobrir o wallpaper', () => {
  assert.match(css, /body\.home-page \.app:not\(:has\(\.theme-switch:checked\)\)::after\s*\{[^}]*background:\s*rgba\(5, 11, 22, \.16\) !important/s);
  assert.match(css, /body\.home-page main::before\s*\{[^}]*background:\s*transparent !important/s);
  assert.match(css, /body:not\(\.theme-light\):is\([\s\S]*?\.inventory-header/);
  assert.match(css, /body\.theme-light:is\([\s\S]*?\.nfe-header/);
  assert.match(css, /body\.supplies-open \.sp-detail\s*\{[^}]*blur\(16px\)/s);
  assert.match(css, /body\.supplies-open \.sp-header\s*\{[^}]*blur\(18px\)/s);
  assert.match(css, /body\.supplies-open \.sp-metric\s*\{[^}]*blur\(16px\)/s);
  assert.match(css, /body\.theme-light\.supplies-open \.sp-detail/);
  assert.match(css, /body\.supplies-open:not\(\.theme-light\)::after\s*\{[^}]*#020b1845/s);
  assert.match(css, /body\.supplies-open:not\(\.theme-light\) \.sp-table tr\.selected\s*\{[^}]*#2b74ae52/s);
  assert.match(css, /body\.home-page \.nav \.module-nav-card\s*\{[^}]*blur\(15px\)/s);
  assert.doesNotMatch(css, /body\.home-page \.nav (?:button|\.module-nav-card)\s*\{[^}]*background\s*:/s);
  const cards = read('home-module-cards.css');
  for (const [module, color] of Object.entries({
    inventory: '#31e99a', management: '#9a5cff', control: '#249bff',
    flux: '#ff9d25', nfe: '#20d8f2', supplies: '#ff5365'
  })) {
    assert.match(cards, new RegExp(`\\.module-nav-card\\.module-${module}[^}]*${color}`, 's'));
  }
});

test('cabeçalhos dos módulos usam vidro translúcido sem alterar os cards da Home', () => {
  const shared = css.slice(css.indexOf('/* Cabeçalhos de módulos:'));
  assert.ok(shared.length > 0);
  const surfaces = css.slice(css.indexOf('/* Superfícies funcionais'), css.indexOf('body.supplies-open:not(.theme-light) .sp-header'));
  for (const selector of ['.inventory-header', '.management-header', '.nfe-header']) {
    assert.ok(!surfaces.includes(selector), `${selector} não pode herdar o vidro opaco dos painéis`);
  }
  const [dark, light] = shared.split('body.theme-light:is(');
  for (const selector of ['.inventory-header', '.management-header', '.nfe-header', '.sp-header', '.settings-topbar']) {
    assert.ok(dark.includes(selector), `${selector} ausente no tema escuro`);
    assert.ok(light.includes(selector), `${selector} ausente no tema claro`);
  }
  assert.match(dark, /rgba\(10, 29, 49, \.14\)/);
  assert.match(light, /rgba\(245, 250, 255, \.08\)/);
  assert.match(shared, /blur\(3px\)/);
  assert.match(shared, /body:not\(\.home-page\):has\(\.theme-switch:checked\)/);
  assert.doesNotMatch(shared, /\.module-nav-card/);
  for (const page of ['index', 'inventory', 'control', 'flux', 'management', 'nfe', 'supplies', 'settings']) {
    assert.match(read(`${page}.html`), /glass-transparency\.css\?v=2\.0\.94/);
  }
});
