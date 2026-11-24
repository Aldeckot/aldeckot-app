const { test } = require('node:test');
const assert = require('node:assert/strict');
const view = require('../equipment-detail-view.js');
const photos = require('../equipment-photo.js');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { webcrypto } = require('node:crypto');

test('histórico mescla evento compartilhado e log local sem duplicar a mesma operação', () => {
  const item = { logs: [
    { id: 'local-a', eventId: 'event-a', at: '23/11/2026, 10:00', text: 'Cópia local' },
    { id: 'local-b', createdAt: '2026-11-21T10:00:00Z', text: 'Nota local' }
  ] };
  const rows = view.historyRows(item, 'inventory', [{ id: 'event-a', source_module: 'flux',
    action: 'Transferência', created_at: '2026-11-23T10:00:00Z', reason: 'Local atualizado' }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.description), ['Local atualizado', 'Nota local']);
  assert.equal(rows[0].module, 'flux');
});

test('visualização escapa dados externos e não inventa informações ausentes', () => {
  const html = view.render({ id: 'item-a', equipment: '<script>alert(1)</script>',
    tag: '', serial: '', logs: [] }, { module: 'inventory' });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Sem movimentação confirmada'));
  assert.ok(html.includes('Não informado'));
});

test('somente caminhos da pasta oficial podem ser limpos após troca de foto', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal(photos.officialPath(`equipment/${id}/${'a'.repeat(32)}.webp`), true);
  assert.equal(photos.officialPath(`${id}/${'a'.repeat(32)}.webp`), false);
  assert.equal(photos.officialPath(`equipment/${id}/../../outro.webp`), false);
});

test('falha ao gravar a referência remove somente o arquivo novo e preserva a foto anterior', async () => {
  const removed = [];
  const db = {
    rpc: async () => ({ error: new Error('Falha de validação') }),
    from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
    storage: { from: () => ({
      upload: async () => ({ data: {}, error: null }),
      remove: async paths => { removed.push(...paths); return { data: [], error: null }; }
    }) }
  };
  const window = { AldeckotSupabase: { init: async () => ({ client: db }) } };
  runInNewContext(readFileSync(join(__dirname, '../equipment-photo.js'), 'utf8'),
    { window, crypto: webcrypto, CustomEvent: class {} });
  const id = '00000000-0000-4000-8000-000000000001';
  const previous = `equipment/${id}/${'b'.repeat(32)}.webp`;
  const file = { type: 'image/png', size: 3, arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer };
  await assert.rejects(window.AldeckotEquipmentPhoto.save('inventory', id, file, previous), /Falha de validação/);
  assert.equal(removed.length, 1);
  assert.ok(removed[0].startsWith(`equipment/${id}/`));
  assert.notEqual(removed[0], previous);
});

test('foto removida permanece distinta de equipamento sem foto cadastrada', async () => {
  let value = null;
  const window = { AldeckotSupabase: { init: async () => ({ client: {
    rpc: async () => ({ data: value, error: null })
  } }) } };
  runInNewContext(readFileSync(join(__dirname, '../equipment-photo.js'), 'utf8'),
    { window, crypto: webcrypto, CustomEvent: class {} });
  const service = window.AldeckotEquipmentPhoto;
  assert.equal(await service.get('inventory', 'item'), null);
  value = '';
  assert.equal(await service.get('inventory', 'item'), '');
});

test('troca preserva a foto anterior quando outra referência ainda a utiliza', async () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const previous = `equipment/${id}/${'b'.repeat(32)}.jpg`;
  const removed = [];
  let submitted;
  const db = {
    rpc: async (_name, args) => { submitted = args; return { data: previous, error: null }; },
    from: table => ({ select: () => ({ eq: () => ({ limit: async () => ({
      data: table === 'equipment_photos' ? [{ equipment_id: id }] : [], error: null
    }) }) }) }),
    storage: { from: () => ({
      upload: async () => ({ data: {}, error: null }),
      remove: async paths => { removed.push(...paths); return { data: [], error: null }; }
    }) }
  };
  const window = { AldeckotSupabase: { init: async () => ({ client: db }) } };
  runInNewContext(readFileSync(join(__dirname, '../equipment-photo.js'), 'utf8'),
    { window, crypto: webcrypto, CustomEvent: class {} });
  const file = { type: 'image/png', size: 3, arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer };
  const path = await window.AldeckotEquipmentPhoto.save('inventory', id, file, previous);
  assert.equal(submitted.p_expected_path, previous);
  assert.equal(submitted.p_path, path);
  assert.deepEqual(removed, []);
});
