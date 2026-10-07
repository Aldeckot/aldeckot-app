import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('Configurações abre com navegação recolhida e permite expansão acessível', () => {
  const html = read('settings.html');
  const script = read('settings-visual-refresh.js');
  assert.match(html, /<body class="settings-page settings-sidebar-collapsed">/);
  assert.match(html, /id="settingsSidebarToggle"[^>]+aria-controls="settingsNavigation"[^>]+aria-expanded="false"/);
  assert.match(script, /classList\.toggle\('settings-sidebar-expanded'\)/);
  assert.match(script, /toggle\.setAttribute\('aria-expanded', String\(expanded\)\)/);
});

test('Resumo só aparece em Geral e dica Ctrl + K não aparece', () => {
  const html = read('settings.html');
  const css = read('settings-visual-refresh.css');
  const script = read('settings.js');
  assert.match(html, /id="settingsOverview" class="settings-overview"/);
  assert.match(script, /overview\.hidden = name !== 'general'/);
  assert.match(css, /\.settings-overview\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.doesNotMatch(html, /<kbd>Ctrl \+ K<\/kbd>/);
});

test('Ícones, fundo e mascote usam o sistema visual do projeto', () => {
  const html = read('settings.html');
  const css = read('settings-visual-refresh.css');
  const script = read('settings-visual-refresh.js');
  assert.match(html, /assets\/mascot-dark\.png/);
  assert.match(css, /assets\/mascot-light-clean\.png/);
  assert.match(css, /assets\/background-dark\.png/);
  assert.match(css, /assets\/background-light-v2\.png/);
  for (const key of ['online', 'database', 'users', 'backup', 'security', 'appearance', 'integrations', 'notifications', 'audit', 'settings', 'home', 'logout']) {
    assert.match(script, new RegExp(`\\b${key}: '<`));
  }
  assert.match(script, /new MutationObserver\(hydrateContent\)/);
});
