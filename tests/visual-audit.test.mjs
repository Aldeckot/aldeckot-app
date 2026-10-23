import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('indicadores da NF-e mostram detalhes completos mesmo em cartões estreitos', () => {
  const css = read('nfe-metric-icons.css');
  assert.match(css, /\.nfe-metric-main > div > span\s*\{[^}]*white-space:\s*normal;[^}]*text-overflow:\s*clip;/s);
  assert.match(css, /\.nfe-metric footer > span\s*\{[^}]*white-space:\s*normal;[^}]*text-overflow:\s*clip;/s);
  assert.match(read('nfe.html'), /nfe-metric-icons\.css\?v=2\.0\.78/);
});

test('tabela móvel de Suprimentos separa miniatura e nome', () => {
  const css = read('supplies.css');
  assert.match(css, /@media \(max-width: 700px\)\s*\{\s*\.sp-table th:nth-child\(1\)\s*\{ width: 62px; \}/s);
  assert.match(css, /\.sp-table td:nth-child\(2\)\s*\{ padding-left: 8px; \}/);
});

test('indicadores dos módulos repetem o acabamento leve e as cores da Home', () => {
  const css = read('indicator-labels.css');
  const version = JSON.parse(read('package.json')).version;
  assert.match(css, /border: 1px solid currentColor !important;/);
  assert.match(css, /filter: none !important;/);
  assert.match(css, /backdrop-filter: none !important;/);
  assert.match(css, /font-size: 9px !important;/);
  assert.match(css, /\.inventory-status\.reserva[^}]+color: #ffc34a !important;/);
  assert.match(css, /\.inventory-situation\.normal[^}]+color: #35d8c8 !important;/);
  assert.match(css, /background: transparent !important;/);
  assert.match(css, /box-shadow: none !important;/);
  assert.doesNotMatch(css, /background: color-mix\(in srgb,currentColor/);
  for (const page of ['inventory.html', 'control.html', 'flux.html', 'management.html', 'supplies.html', 'nfe.html']) {
    assert.ok(read(page).includes(`indicator-labels.css?v=${version}`), `${page} deve carregar os indicadores atualizados`);
  }
});

test('contadores singulares usam descrição correta para leitores de tela', () => {
  assert.match(read('inventory.js'), /entry\.items\.length === 1 \? 'item' : 'itens'/);
  assert.match(read('module-notifications.js'), /notifications\.length === 1 \? 'alerta' : 'alertas'/);
  assert.match(read('home-notifications.js'), /count === 1 \? 'notificação prioritária' : 'notificações prioritárias'/);
});
