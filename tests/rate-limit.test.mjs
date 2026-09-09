import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resetForTests, take } = require('../server/rate-limit.js');

test('limita tentativas após atingir o máximo configurado', () => {
  resetForTests();
  const options = { key: 'login:127.0.0.1', limit: 2, windowMs: 60_000, timestamp: 1_000 };
  assert.equal(take(options).allowed, true);
  assert.equal(take(options).allowed, true);
  assert.equal(take(options).allowed, false);
});

test('libera uma nova janela de tentativas depois do prazo', () => {
  resetForTests();
  const first = { key: 'login:127.0.0.1', limit: 1, windowMs: 60_000, timestamp: 1_000 };
  assert.equal(take(first).allowed, true);
  assert.equal(take({ ...first, timestamp: 61_001 }).allowed, true);
});
