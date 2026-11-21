import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('os cartões do Flux mostram direção e mantêm abertura acessível', () => {
  const script = read('inventory.js');
  const cards = script.split('function fluxCardMarkup(group)')[1]
    .split('function fluxSidebarMarkup(')[0];
  assert.match(cards, /item\.movement === 'Recebimento' \? 'entry' : 'send'/);
  assert.match(cards, /class="flux-card-direction[^`]+aria-hidden="true"/);
  assert.match(cards, /role="button" aria-label="Abrir histórico de/);
  assert.match(cards, /fluxIcon\('direction'\)/);
  assert.match(cards, /fluxIcon\('send'\)[^\n]+<b>Saída<\/b>/);
  assert.match(cards, /fluxIcon\('entry'\)[^\n]+<b>\$\{arrivalLabel\}<\/b>/);
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
