import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../supplies-api.js', import.meta.url), 'utf8');

function setup(shared, queryError = false, imageRuntime = {}) {
  const removed = [];
  const uploaded = [];
  const rows = {
    supplies: [{ id: 'parent', image_path: 'old.webp' }],
    supply_variants: shared ? [{ id: 'variant', image_path: 'old.webp' }] : []
  };
  const db = {
    from(table) {
      return { select() { return { eq(field, value) { return { limit: async () => ({
        data: rows[table].filter(row => row[field] === value).slice(0, 1),
        error: queryError ? new Error('Consulta indisponível') : null
      }) }; } }; } };
    },
    storage: { from() { return {
      upload: async (path, blob, options) => { uploaded.push({ path, blob, options }); return { error: null }; },
      remove: async paths => { removed.push(...paths); return { error: null }; }
    }; } },
    rpc: async (name, args) => {
      assert.equal(name, 'supply_set_image');
      rows.supplies[0].image_path = args.p_path;
      return { data: null, error: null };
    }
  };
  const window = { AldeckotSupabase: { init: async () => ({ client: db }) } };
  runInNewContext(source, { window, crypto: webcrypto, console, ...imageRuntime });
  return { api: window.AldeckotSupplies, rows, removed, uploaded };
}

test('substituição preserva foto antiga quando uma variação ainda a utiliza', async () => {
  const { api, rows, removed } = setup(true);
  const path = await api.uploadImage('supply', 'parent', new Blob(['imagem nova'], { type: 'image/png' }), 'old.webp');
  assert.equal(rows.supplies[0].image_path, path);
  assert.equal(rows.supply_variants[0].image_path, 'old.webp');
  assert.deepEqual(removed, []);
});

test('substituição remove foto anterior somente sem referências e preserva em falha de consulta', async () => {
  const unshared = setup(false);
  await unshared.api.uploadImage('supply', 'parent', new Blob(['imagem nova'], { type: 'image/png' }), 'old.webp');
  assert.deepEqual(unshared.removed, ['old.webp']);
  const unavailable = setup(false, true);
  await unavailable.api.uploadImage('supply', 'parent', new Blob(['imagem nova'], { type: 'image/png' }), 'old.webp');
  assert.deepEqual(unavailable.removed, []);
});

test('upload reduz dimensões e envia apenas a versão WebP menor', async () => {
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    toBlob: callback => callback(new Blob([new Uint8Array(100)], { type: 'image/webp' })) };
  const runtime = {
    document: { createElement: type => { assert.equal(type, 'canvas'); return canvas; } },
    createImageBitmap: async () => ({ width: 2400, height: 1600, close() {} })
  };
  const { api, uploaded } = setup(false, false, runtime);
  const original = new Blob([new Uint8Array(2000)], { type: 'image/png' });
  const path = await api.uploadImage('supply', 'parent', original, null);
  assert.equal(canvas.width, 1200);
  assert.equal(canvas.height, 800);
  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].blob.type, 'image/webp');
  assert.equal(uploaded[0].blob.size, 100);
  assert.equal(uploaded[0].options.contentType, 'image/webp');
  assert.match(path, /\.webp$/);
});

test('arquivo ilegível é recusado sem upload', async () => {
  const { api, uploaded } = setup(false, false, { createImageBitmap: async () => { throw new Error('decode'); } });
  await assert.rejects(api.uploadImage('supply', 'parent', new Blob(['imagem'], { type: 'image/png' }), null),
    /Não foi possível ler a imagem/);
  assert.equal(uploaded.length, 0);
});
