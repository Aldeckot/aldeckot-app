import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../module-header-cards.css', import.meta.url), 'utf8');
const inventoryStyles = readFileSync(new URL('../inventory.css', import.meta.url), 'utf8');
const inventoryPage = readFileSync(new URL('../inventory.html', import.meta.url), 'utf8');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('cabeçalho preserva arte, etiquetas, cubos e marca após recarregamento parcial', () => {
  const fallback = inventoryPage.match(/<style id="inventory-header-critical">([\s\S]*?)<\/style>/)?.[1];
  assert.ok(fallback, 'estilos essenciais estão no próprio HTML');
  assert.ok(inventoryPage.indexOf('inventory-header-critical') < inventoryPage.indexOf('module-header-cards.css'), 'estilo completo mantém prioridade');
  assert.match(fallback, /\.module-header-summary-tags\{display:flex/);
  assert.match(fallback, /module-inventory-illustration\.png/);
  assert.match(fallback, /--inventory-empty-main:#39cdf4/);
  assert.match(fallback, /\.system-header-brand-copy b\{display:block/);
  assert.match(view, /function ensureHeaderBrand\(\)/);
  assert.match(view, /applyHeaderPresentation\(\);\s*ensureHeaderBrand\(\);/);
  assert.match(view, /brand\.dataset\.systemHeaderBrand = 'true'/);
});

test('alternador lateral usa ícone de tabela e mantém rótulo acessível', () => {
  assert.match(view, /class="inventory-table-toggle-icon" viewBox="0 0 24 24"/);
  assert.match(view, /aria-label="\$\{state\.sidebarOpen \? 'Ocultar tabelas' : 'Mostrar tabelas'\}"/);
  assert.match(view, /<rect x="2\.5" y="3\.5" width="19" height="17"/);
});

test('cubos do cabeçalho cabem na área animada também em telas estreitas', () => {
  assert.match(view, /setAttribute\('viewBox', '0 0 620 110'\)/);
  assert.match(styles, /\.inventory-header-cube-scene \.inventory-empty-illustration \{\s*width: min\(100%, 590px\) !important;\s*height: 104px;/);
  assert.match(view, /translate\(277 14\) scale\(1\.5\)/);
  assert.match(view, /\['yellow', 'translate\(554 55\) scale\(\.8\)'\]/);
  assert.match(styles, /@media \(max-width: 1050px\)[\s\S]*?\.inventory-header-cube-scene \.inventory-empty-illustration \{\s*height: 74px;/);
  for (const cube of ['edge-left', 'upper-left', 'left-mid', 'middle-left', 'middle-low', 'middle-right-high', 'right-mid', 'right-low', 'edge-right']) {
    assert.match(view, new RegExp(`'${cube}', '[^']+', 'translate\\(\\d+ \\d+\\) scale\\(\\.\\d+\\)', '-[^']+s'`));
  }
  assert.match(view, /cube\.style\.animationDelay = delay/);
  assert.match(view, /illustration\.append\(cube\)/);
});

test('exportações PDF compartilham documento vermelho e selo verde de download', () => {
  for (const file of ['inventory.js', 'management.js', 'supplies.js', 'nfe.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /<path d="M5\.8 11\.9V7\.8[^>]*stroke="#fff" stroke-width="1\.25"/, file);
    assert.match(source, /<circle cx="17\.8" cy="17\.8" r="5\.3" fill="#35d82e"/, file);
    assert.match(source, /M17\.8 14\.5v4\.2m-2-1\.9 2 2 2-2[^>]*stroke-width="1\.6"/, file);
  }
  assert.match(styles, /\.management-header \.management-pdf-action svg,[\s\S]*?\.sp-header-actions \.sp-export-action svg \{\s*width: 27px;\s*height: 27px;/);
  assert.match(styles, /\.nfe-export-menu \[data-nfe-export="pdf"\] svg \{\s*width: 20px;\s*height: 20px;/);
});

test('ícone PDF preenche mais o quadro sem alterar o tamanho do botão', () => {
  assert.match(inventoryStyles, /\.inventory-header \.inventory-pdf-action\{padding:4px\}/);
  assert.match(inventoryStyles, /\.inventory-header \.inventory-pdf-action svg\{width:100%;height:100%;max-width:44px;max-height:44px\}/);
  for (const page of ['inventory.html', 'index.html', 'control.html', 'flux.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`href="inventory.css?v=${version}"`), page);
  }
});
