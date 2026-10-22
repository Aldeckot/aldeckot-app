import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const management = readFileSync(resolve(root, 'management.js'), 'utf8');
const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
const helper = management.match(/const configuredAreas = \(\) => ([^;]+);/);
assert.ok(helper, 'A Gestão TI deve descobrir as ramificações existentes.');

test('ramificações já cadastradas permanecem disponíveis sem criar ramificações fictícias', () => {
  const areas = ['Escritório', 'Estoque', 'Frente de Loja'];
  const payload = { items: [{ area: 'Açougue' }, { area: 'Frente de Loja' }] };
  const configuredAreas = new Function('areas', 'payload', `return () => ${helper[1]};`)(areas, payload);
  assert.deepEqual(configuredAreas(), [...areas, 'Açougue']);
  assert.match(management, /configuredAreas\(\)\.map\(area => \[area, payload\.items\.filter\(item => item\.area === area\)\]\)/);
});

test('Categoria é independente da ramificação na edição, persistência e detalhes', () => {
  assert.match(management, /input\.name = 'category'/);
  assert.match(management, /areaLabel\.textContent = 'Ramificação'/);
  assert.match(management, /if \(current\?\.area\) area\.value = current\.area/);
  assert.match(management, /category: String\(values\.category \|\| \(values\.equipment \? 'Computador' : ''\)\)\.trim\(\)/);
  assert.match(management, /\['area', 'ramificação'\]/);
  assert.match(management, /assetCard\('cube', 'Categoria', item\.category\)/);
  assert.match(client, /category: String\(item\.category \|\| ''\)\.trim\(\)/);
  assert.match(client, /category: payload\.category \|\| \(payload\.equipment \? 'Computador' : ''\)/);
});

test('posição física é a referência e local legado divergente aparece sem mutação automática', () => {
  const helper = management.match(/const recordedLocationConflict = item => ([\s\S]*?);/);
  assert.ok(helper);
  const isConflict = new Function('hasFixedTerminal', 'hasInstalledComputer', 'normalize',
    `return item => ${helper[1]};`)(
    item => Boolean(item.terminal),
    item => Boolean(item.equipment),
    value => String(value || '').toLowerCase().trim()
  );
  assert.equal(isConflict({ terminal: 'PDV 05', equipment: 'Caixa 05', location: 'PDV 06' }), true);
  assert.equal(isConflict({ terminal: 'PDV 05', equipment: 'Caixa 05', location: 'PDV 05' }), false);
  assert.equal(isConflict({ terminal: 'PDV 05', equipment: '', location: 'PDV 06' }), false);
  assert.match(management, /detail\('Local registrado \(divergente\)', item\.location/);
  assert.match(management, /'Posição física', hasFixedTerminal\(item\) \? terminalName\(item\)/);
});

test('Inativo é o status canônico sem esconder o legado Desativado', () => {
  assert.match(management, /const statuses = \['Ativo', 'Reserva', 'Defeito', 'Manutenção', 'Inativo'\]/);
  assert.match(management, /const configuredStatuses = \(\) =>/);
  assert.match(management, /Desativado: \{ color: '#718096', icon: 'offline' \}/);
  assert.match(management, /if \(current\?\.status\) status\.value = current\.status/);
});
