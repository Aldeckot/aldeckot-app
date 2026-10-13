import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const homeSource = readFileSync(new URL('../home.js', import.meta.url), 'utf8');

test('a Home exibe a atividade mais recente de cada equipamento ativo e ignora exclusões', async () => {
  const panel = { innerHTML: '', querySelectorAll: () => [] };
  const document = {
    getElementById: () => null,
    querySelector: selector => selector === '[data-home-recent-items]'
      ? panel
      : selector === '.home-reference' ? { append: () => {} } : null,
    createElement: () => ({ dataset: {}, setAttribute: () => {} })
  };
  const event = (id, description, created_at, operation = 'update') => ({
    module: 'management',
    operation,
    created_at,
    details: {
      itemId: id,
      equipment: id,
      targetUrl: `management.html?item=${id}`,
      description
    }
  });
  const window = {
    AldeckotAuthReady: Promise.resolve(),
    AldeckotAuth: { session: {} },
    AldeckotSupabase: {
      init: async () => {},
      inventory: { load: async () => ({ tables: [] }) },
      management: { load: async () => ({ table: null, items: [] }) },
      control: { load: async () => ({ tables: [] }) },
      flux: { load: async () => ({ tables: [] }) },
      events: { recentActivity: async () => [
        event('same', 'Registro anterior', '2026-10-11T10:00:00Z'),
        event('other', 'Outro equipamento', '2026-10-12T10:00:00Z'),
        event('same', 'Registro mais recente', '2026-10-13T10:00:00Z'),
        event('deleted', 'Registro antigo de item excluído', '2026-10-09T10:00:00Z'),
        event('deleted', 'Equipamento excluído', '2026-10-12T12:00:00Z', 'delete')
      ] }
    },
    setInterval: () => {},
    requestAnimationFrame: callback => callback(),
    addEventListener: () => {},
    dispatchEvent: () => {}
  };

  runInNewContext(homeSource, {
    window,
    document,
    URLSearchParams,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    console
  });
  await window.AldeckotHomeDataReady;
  await new Promise(resolve => setImmediate(resolve));

  assert.match(panel.innerHTML, /Registro mais recente/);
  assert.match(panel.innerHTML, /Outro equipamento/);
  assert.doesNotMatch(panel.innerHTML, /Registro anterior/);
  assert.doesNotMatch(panel.innerHTML, /Registro antigo de item excluído|Equipamento excluído/);
  assert.equal((panel.innerHTML.match(/data-home-recent-target="management\.html\?item=same"/g) || []).length, 1);
});
