import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const handler = require('../api/auth-bootstrap.js');
const response = () => ({
  statusCode: null,
  payload: null,
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; }
});

test('administrator bootstrap stays unavailable without explicit server authorization', async () => {
  const names = ['ALDECKOT_BOOTSTRAP_ENABLED', 'ALDECKOT_BOOTSTRAP_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('An unauthorized request reached Supabase'); };
  try {
    delete process.env.ALDECKOT_BOOTSTRAP_ENABLED;
    delete process.env.ALDECKOT_BOOTSTRAP_TOKEN;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const unavailable = response();
    await handler({ method: 'POST', headers: {} }, unavailable);
    assert.equal(unavailable.statusCode, 404);

    process.env.ALDECKOT_BOOTSTRAP_ENABLED = 'true';
    process.env.ALDECKOT_BOOTSTRAP_TOKEN = 'test-only-secret-with-at-least-32-characters';
    const missingToken = response();
    await handler({ method: 'POST', headers: {} }, missingToken);
    assert.equal(missingToken.statusCode, 404);

    const wrongToken = response();
    await handler({ method: 'POST', headers: { 'x-aldeckot-bootstrap-token': 'wrong' } }, wrongToken);
    assert.equal(wrongToken.statusCode, 404);

    const authorized = response();
    await handler({ method: 'POST', headers: { 'x-aldeckot-bootstrap-token': process.env.ALDECKOT_BOOTSTRAP_TOKEN } }, authorized);
    assert.equal(authorized.statusCode, 500);
    assert.match(authorized.payload.error, /Configuração segura/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('the login page never triggers bootstrap automatically', () => {
  const login = readFileSync(new URL('../login.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
  assert.doesNotMatch(login, /bootstrapAdministrator/);
  assert.doesNotMatch(client, /\/api\/auth-bootstrap/);
});
