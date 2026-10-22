import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/084_control_management_identity_repair.sql'), 'utf8');

test('reparo de chamado exige a rechecagem exata e corrige somente o Caixa 10', () => {
  assert.match(migration, /begin;[\s\S]*lock table public\.control_items, public\.module_records, public\.module_tables/s);
  assert.match(migration, /if linked_count <> 3 then/);
  assert.match(migration, /O chamado do Caixa 05 reapareceu/);
  assert.match(migration, /Os dois chamados historicos sem identidade mudaram/);
  assert.match(migration, /ticket\.status is distinct from 'Em manutenção'/);
  assert.match(migration, /app\.management_identity_matches\(correct_computer\.payload, ticket\.tag, ticket\.serial\)/);
  assert.match(migration, /set management_record_id = correct_computer\.id/);
  assert.match(migration, /if repaired_count <> 1 then/);
  assert.doesNotMatch(migration, /update\s+public\.module_records|update\s+public\.inventory_items/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|insert\s+into\s+public\.control_item_logs/i);
});

test('travas recusam novos vínculos, mas preservam históricos concluídos sem identidade', () => {
  assert.match(migration, /before insert or update of management_record_id, tag, serial, status/);
  assert.match(migration, /before update of table_id, payload/);
  assert.match(migration, /not app\.management_identity_matches\(computer_payload, new\.tag, new\.serial\)/);
  assert.match(migration, /not app\.management_identity_matches\(new\.payload, item\.tag, item\.serial\)/);
  assert.match(migration, /new\.status = 'Manutenção concluída'/);
  assert.match(migration, /old\.management_record_id is not distinct from new\.management_record_id/);
  assert.match(migration, /create or replace function app\.sync_management_status_from_control\(\)[\s\S]*?begin\s+return new;\s+end;/);
  assert.match(migration, /commit;/);
});
