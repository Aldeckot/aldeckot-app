import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('carregamentos pendentes usam indicador inline sem bloquear consultas', () => {
  const css = read('loading-indicator.css');
  assert.match(css, /\.aldeckot-inline-loading::before/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  for (const file of ['supplies.html', 'supplies.js', 'supplies-backup.js', 'supply-links.js',
    'operational-dashboard.js', 'home.js', 'settings.js', 'inventory.html', 'control.html', 'flux.html']) {
    assert.match(read(file), /aldeckot-inline-loading/, `${file} precisa mostrar progresso na leitura pendente`);
  }
  assert.match(read('loading-indicator.js'), /return \['GET', 'HEAD'\]\.includes/);
});

test('gravações de Suprimentos indicam progresso e liberam o estado ao terminar', () => {
  const supplies = read('supplies.js');
  const backup = read('supplies-backup.js');
  assert.match(supplies, /submit\.classList\.add\('aldeckot-loading-button'\)/);
  assert.match(supplies, /submit\.classList\.remove\('aldeckot-loading-button'\)/);
  assert.match(backup, /button\.classList\.add\('aldeckot-loading-button'\)/);
  assert.match(backup, /button\.classList\.remove\('aldeckot-loading-button'\)/);
  assert.match(supplies, /state\.detailError = 'Não foi possível carregar os detalhes/);
});
