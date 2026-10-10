import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('a tabela do Flux usa setas com nomes acessíveis sem alterar os dados', () => {
  const script = read('inventory.js');
  const indicator = script.split('function fluxMovementIndicator(movement)')[1]
    .split('function fluxTableMarkup(table, visible)')[0];
  const table = script.split('function fluxTableMarkup(table, visible)')[1]
    .split('function tableMarkup(')[0];
  assert.match(indicator, /label !== 'Envio' && label !== 'Recebimento'/);
  assert.ok(indicator.includes('role="img" aria-label="${label}" title="${label}"'));
  assert.match(indicator, /<svg[^>]+aria-hidden="true"/);
  assert.ok(table.includes('<td>${fluxMovementIndicator(item.movement)}</td>'));
  assert.ok(!table.includes('<span class="inventory-movement ${className(item.movement)}">${escape(item.movement)}</span>'));
  assert.match(script, /movements: \['Envio', 'Recebimento'\]/);
});

test('Envio aponta para cima em vermelho e Recebimento para baixo em verde', () => {
  const css = read('flux.css');
  assert.match(css, /\.inventory-movement-icon\.envio\{color:#ff484f/);
  assert.match(css, /\.inventory-movement-icon\.recebimento\{color:#27e562/);
  assert.match(css, /\.inventory-movement-icon\.recebimento svg\{transform:rotate\(180deg\)/);
  assert.match(css, /\.theme-light \.flux-data \.inventory-movement-icon\.envio/);
  assert.match(css, /\.theme-light \.flux-data \.inventory-movement-icon\.recebimento/);
});
