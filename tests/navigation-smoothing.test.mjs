import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = name => readFileSync(resolve(root, name), 'utf8');

test('a Home revela a estrutura sem esperar indefinidamente por dados ou fontes', () => {
  const route = source('page-transition.js');
  assert.match(route, /HOME_RENDER_MAX_WAIT = 600/);
  assert.match(route, /homeWaitExpired = true;\s*revealHomeWhenStable\(\)/);
  assert.match(route, /Promise\.race\(\[/);
  assert.match(route, /if \(homeTransitionReturn\) return \(\) => \{\};/);
});

test('navegação e restauração do cache limpam cortina e carregador anteriores', () => {
  const route = source('page-transition.js');
  const loading = source('loading-indicator.js');
  assert.match(route, /function restoreCachedPage\(\)/);
  assert.match(route, /querySelectorAll\('\.aldeckot-route-curtain'\)/);
  assert.match(route, /AldeckotLoading\?\.reset\?\.\(\)/);
  assert.match(route, /if \(event\.persisted\) restoreCachedPage\(\)/);
  assert.match(loading, /window\.addEventListener\('pagehide', reset\)/);
  assert.match(loading, /if \(event\.persisted\) reset\(\)/);
  assert.doesNotMatch(loading, /beforeunload/);
  assert.doesNotMatch(route, /AldeckotLoading\?\.show/);
});

test('atualização de recentes preserva o painel operacional e ignora respostas antigas', () => {
  const home = source('home.js');
  assert.match(home, /lastRecentSignature/);
  assert.match(home, /recentLoadSequence/);
  assert.match(home, /operationsSlot = panel\.querySelector\('\[data-home-operations-slot\]'\)/);
  assert.match(home, /panel\.appendChild\(operationsSlot\)/);
  assert.match(home, /if \(requestId !== recentLoadSequence\) return/);
});

test('a agenda reserva seus quadros antes de buscar dados e mantém o quadro de hoje', () => {
  const agenda = source('agenda.js');
  assert.match(agenda, /async function bootstrapAgenda\(\)\s*\{\s*\/\/[^\n]*\n\s*renderAll\(\);\s*try/);
  assert.doesNotMatch(agenda, /panel\.hidden = !todays\.length/);
  assert.match(agenda, /Nenhuma tarefa ou evento para hoje/);
});

test('o efeito visual não reinicia nos quadros da Home a cada atualização', () => {
  const css = source('page-transition.css');
  assert.match(css, /body\.home-page \.panel\s*\{\s*animation:\s*none\s*!important/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(css, /body\.aldeckot-page-leaving\s*\{\s*overflow:\s*hidden/);
  assert.doesNotMatch(css, /@keyframes aldeckot-(?:home-arrive|module-arrive|module-leave)\s*\{[^}]*transform:/);
  assert.doesNotMatch(source('loading-indicator.css'), /transition:[^;]*backdrop-filter/);
});
