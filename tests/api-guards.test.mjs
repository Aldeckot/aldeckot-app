import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const clientError = require('../api/client-error.js');

const responseStub = () => ({
  headers: {},
  statusCode: null,
  payload: null,
  ended: false,
  setHeader(key, value) { this.headers[key] = value; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
  end() { this.ended = true; return this; }
});

test('o recebimento de erros do navegador ignora JSON inválido sem falhar', async () => {
  const response = responseStub();
  const originalError = console.error;
  console.error = () => {};
  try {
    await clientError({ method: 'POST', body: '{inválido', headers: { 'x-forwarded-for': 'test-client-error' } }, response);
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 204);
  assert.equal(response.ended, true);
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0');
});

test('o recebimento de erros rejeita métodos indevidos', async () => {
  const response = responseStub();
  await clientError({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.payload.error, 'Método não permitido.');
});
