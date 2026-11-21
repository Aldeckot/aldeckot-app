import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
const window = {
  ALDECKOT_SUPABASE_CONFIG: { url: 'https://test.supabase.co', publishableKey: 'test-key' },
  supabase: { createClient: () => ({ from() { throw Error('Unexpected database access'); } }) }
};
runInNewContext(source, { window, console, Headers, Request, URLSearchParams });

test('legacy modular restores stop before the first database operation', async () => {
  const api = window.AldeckotSupabase;
  for (const [module, action] of [
    ['Inventário', () => api.inventory.replace({ tables: [] })],
    ['Controle TI', () => api.control.replace({ tables: [] })],
    ['Flux', () => api.flux.replace({ tables: [] })],
    ['Fiscal NF-e', () => api.nfe.restoreBackup({ snapshot: { occurrences: [] } })]
  ]) {
    await assert.rejects(action(), error => {
      assert.match(error.message, /Backup preservado/);
      assert.ok(error.message.includes(module));
      assert.match(error.message, /Nenhum registro foi alterado/);
      return true;
    });
  }
});
