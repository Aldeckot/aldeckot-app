import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('detalhes da Gestão TI usam painel integrado com navegação e ações existentes', () => {
  const source = read('management.js');
  const page = read('management.html');
  const version = JSON.parse(read('package.json')).version;
  assert.match(source, /management-modal-dialog management-asset-detail/);
  for (const tab of ['Geral', 'Hardware', 'Rede', 'Localização', 'Status Operacional', 'Histórico', 'Periféricos']) {
    assert.ok(source.includes(`'${tab}'`), tab);
  }
  for (const action of ['transfer', 'toggle-actions', 'edit', 'close', 'add-log', 'edit-log', 'delete-log']) {
    assert.ok(source.includes(`data-management-action="${action}"`), action);
  }
  assert.ok(page.includes(`management-detail-dashboard.css?v=${version}`));
  assert.ok(page.includes(`management.js?v=${version}`));
});

test('resumo técnico não inventa monitoramento ou condições de periféricos', () => {
  const source = read('management.js');
  const css = read('management-detail-dashboard.css');
  assert.match(source, /Conectividade não monitorada/);
  assert.match(source, /Estado não informado/);
  assert.match(source, /filter\(\(\[, , value\]\) => hasDetailValue\(value\)\)/);
  assert.doesNotMatch(source, /detail\('Placa-mãe'|detail\('Placa de Vídeo'/);
  assert.match(css, /body\.theme-light\.management-open \.management-modal-dialog\.management-asset-detail/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('ícones do modal têm traçado visível e ilustrações por tipo de equipamento', () => {
  const source = read('management.js');
  const css = read('management-detail-dashboard.css');
  assert.match(css, /\.management-asset-detail svg\s*\{[^}]*fill: none;[^}]*stroke: currentColor/s);
  assert.match(css, /\.management-asset-heading-icon\.icon-info/);
  assert.match(source, /management-asset-workstation-art/);
  assert.match(css, /\.management-asset-workstation-art \.art-monitor-frame/);
  assert.match(source, /workstation: '<rect/);
  for (const icon of ['printer', 'keypad', 'drawer', 'scale', 'scanner']) {
    assert.ok(source.includes(`return '${icon}'`), icon);
  }
});

test('status dos periféricos usa o registro vinculado do Inventário sem gravar condição fictícia', () => {
  const source = read('management.js');
  const api = read('supabase-client.js');
  assert.match(api, /async peripheralInventoryStatuses\(\{ ids = \[\], tags = \[\] \} = \{\}\)/);
  assert.match(api, /from\('inventory_items'\)\.select\('id, tag, equipment, status'\)/);
  assert.match(source, /entry\.sourceModule === 'inventory' && sourceId/);
  assert.match(source, /matches\.length === 1 \? matches\[0\] : null/);
  assert.match(source, /inventoryItem\?\.status/);
  assert.match(source, /sameInventoryLink \? \{ sourceModule: 'inventory', sourceItemId: previous\.sourceItemId \}/);
  assert.match(source, /event\.detail\?\.table === 'inventory_items'/);
});
