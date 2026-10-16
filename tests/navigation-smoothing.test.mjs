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
  const navigation = route.slice(route.indexOf('function navigate('), route.indexOf('function goHome()'));
  assert.doesNotMatch(navigation, /AldeckotLoading\?\.show/);
});

test('atualização de recentes preserva o painel operacional e ignora respostas antigas', () => {
  const home = source('home.js');
  assert.match(home, /lastRecentSignature/);
  assert.match(home, /recentLoadSequence/);
  assert.match(home, /data-home-recent-list/);
  assert.match(home, /list\.innerHTML = items\.map/);
  assert.doesNotMatch(home.slice(home.indexOf('function renderRecentItems('), home.indexOf('async function loadRecentItems(')), /panel\.innerHTML/);
  assert.match(home, /if \(requestId !== recentLoadSequence\) return/);
});

test('quadros de dados mantêm suas dimensões e a sincronização exibe feedback visual', () => {
  const css = source('operational-dashboard.css');
  const dashboard = source('operational-dashboard.js');
  const routeCss = source('page-transition.css');
  assert.match(css, /\.home-recent-list\[data-home-recent-list\]\{min-height:168px/);
  assert.match(css, /\.operations-panel\{[^}]*min-height:132px/);
  assert.doesNotMatch(css, /@keyframes operations-item-update\{[^}]*transform:/);
  assert.match(dashboard, /const ensureShell = host =>/);
  assert.match(dashboard, /AldeckotLoading\?\.show\?\.\('Sincronizando dados…'/);
  assert.doesNotMatch(dashboard, /host\.offsetWidth/);
  assert.match(routeCss, /aldeckot-module-booting body\[data-inventory-page\] \.app/);
  assert.match(routeCss, /aldeckot-module-booting body\.supplies-open \.supplies-app/);
  const version = JSON.parse(source('package.json')).version;
  assert.ok(source('supplies.html').includes(`page-transition.js?v=${version}`));
  assert.match(source('supplies.js'), /AldeckotModuleStage\?\.reveal\?\.\(\)/);
});

test('a agenda reserva seus quadros antes de buscar dados e oculta o quadro de hoje quando vazio', () => {
  const agenda = source('agenda.js');
  assert.match(agenda, /async function bootstrapAgenda\(\)\s*\{\s*\/\/[^\n]*\n\s*renderAll\(\);\s*try/);
  assert.match(agenda, /panel\.hidden = !todays\.length/);
  assert.match(agenda, /if \(!todays\.length\) \{\s*panel\.replaceChildren\(\);\s*return;/);
  assert.match(agenda, /iso\(new Date\(\)\) !== iso\(today\)/);
});

test('o efeito visual não reinicia nos quadros da Home a cada atualização', () => {
  const css = source('page-transition.css');
  assert.match(css, /body\.home-page \.panel\s*\{\s*animation:\s*none\s*!important/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.doesNotMatch(css, /body\.aldeckot-page-leaving\s*\{\s*overflow:\s*hidden/);
  assert.doesNotMatch(css, /@keyframes aldeckot-(?:home-arrive|module-arrive|module-leave)\s*\{[^}]*transform:/);
  assert.doesNotMatch(source('loading-indicator.css'), /transition:[^;]*backdrop-filter/);
});
