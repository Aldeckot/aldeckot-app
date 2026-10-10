import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('Gestão TI e Controle TI usam recortes transparentes nos dois temas', () => {
  const css = read('module-header-cards.css');
  assert.match(css, /\.module-header-summary-art\.management\s*\{\s*background-image:\s*url\('assets\/module-management-illustration-transparent\.png'\)/);
  assert.match(css, /\.module-header-summary-art\.control\s*\{\s*background-image:\s*url\('assets\/module-control-illustration-transparent\.png'\)/);
  assert.doesNotMatch(css, /background-image:\s*url\('assets\/module-(?:management|control)-illustration\.png'\)/);
  assert.match(css, /\.module-header-summary-art\s*\{[^}]*mix-blend-mode:\s*normal/s);
  for (const name of ['management', 'control']) {
    assert.ok(existsSync(resolve(root, `assets/module-${name}-illustration-transparent.png`)));
  }
});

test('todos os módulos carregam a versão atual do estilo compartilhado', () => {
  const version = JSON.parse(read('package.json')).version;
  for (const page of ['inventory', 'management', 'control', 'flux', 'nfe', 'supplies']) {
    assert.ok(read(`${page}.html`).includes(`module-header-cards.css?v=${version}`), page);
  }
});
