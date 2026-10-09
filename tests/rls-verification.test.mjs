import test from 'node:test';
import assert from 'node:assert/strict';
import { anonymousReadBlocked, protectedTables } from '../scripts/rls-check.mjs';

test('verificador aceita lista vazia ou recusa explícita de permissão sem expor registros', () => {
  assert.equal(anonymousReadBlocked(200, []), true);
  assert.equal(anonymousReadBlocked(401, { code: '42501', message: 'permission denied for table' }), true);
  assert.equal(anonymousReadBlocked(403, { code: '42501' }), true);
  assert.equal(anonymousReadBlocked(200, [{ id: 'registro' }]), false);
  assert.equal(anonymousReadBlocked(401, { code: 'PGRST301', message: 'Invalid API key' }), false);
  assert.equal(anonymousReadBlocked(500, { code: '42501' }), false);
});

test('verificação anônima cobre as tabelas e a visão de Suprimentos', () => {
  for (const table of ['supplies', 'supply_variants', 'supply_units', 'supply_movements',
    'supply_logs', 'supply_maintenance_links', 'supply_stock_summary']) {
    assert.ok(protectedTables.includes(table), `${table} precisa de verificação anônima`);
  }
});
