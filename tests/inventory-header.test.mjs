import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../inventory.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../module-header-cards.css', import.meta.url), 'utf8');
const inventoryStyles = readFileSync(new URL('../inventory.css', import.meta.url), 'utf8');
const refreshStyles = readFileSync(new URL('../inventory-visual-refresh.css', import.meta.url), 'utf8');
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
  assert.match(view, /applyHeaderPresentation\(\);[\s\S]*?ensureHeaderBrand\(\);/);
  assert.match(view, /brand\.dataset\.systemHeaderBrand = 'true'/);
});

test('Inventário e Flux removem a barra lateral de tabelas após criar a tela', () => {
  assert.match(view, /if \(!controlMode && table\) \{\s*const layout = document\.querySelector\('\.inventory-layout'\);[\s\S]*?layout\?\.querySelector\('\.inventory-table-sidebar'\)\?\.remove\(\)/);
  assert.match(refreshStyles, /\.inventory-layout\.inventory-no-sidebar/);
});

test('cabeçalho do Inventário representa rastreamento de patrimônio', () => {
  assert.match(view, /function inventoryScanScene\(\)/);
  for (const element of ['inventory-scan-rack', 'inventory-scan-asset', 'inventory-scan-location', 'inventory-scan-sweep']) {
    assert.match(view, new RegExp(element));
  }
  assert.match(refreshStyles, /prefers-reduced-motion: reduce/);
  assert.match(inventoryPage, /inventory-visual-refresh\.css/);
});

test('exportações PDF compartilham o ícone de documento com seta de download', () => {
  const asset = readFileSync(new URL('../assets/pdf-export.svg', import.meta.url), 'utf8');
  assert.match(asset, /stroke="#ff9ab0" d="M5 3h9l4 4v5/);
  assert.match(asset, /stroke="#81e8c1" d="M17 13v7/);
  for (const file of ['inventory.js', 'control-board.js', 'management.js', 'supplies.js', 'nfe.js', 'central-equipment.js', 'settings.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /<img class="pdf-export-icon" src="assets\/pdf-export\.svg" width="\d+" height="\d+" alt="">/, file);
    assert.doesNotMatch(source, /fill="#35d82e"/, file);
  }
});

test('cabeçalho do Inventário mantém o tamanho e o nome acessível do botão PDF', () => {
  assert.match(inventoryStyles, /\.inventory-header \.inventory-pdf-action\{padding:4px\}/);
  assert.match(view, /aria-label="Exportar tabela aberta em PDF"[^>]*data-inv-action="export-pdf"><img[^>]*width="24" height="24"/);
  for (const page of ['inventory.html', 'index.html', 'control.html', 'flux.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.ok(html.includes(`href="inventory.css?v=${version}"`), page);
  }
});
