import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root,
  'supabase/089_management_movement_pdv_guard.sql'), 'utf8');

test('089 protege a RPC existente sem alterar registros históricos', () => {
  assert.match(migration, /^begin;/im);
  assert.match(migration, /alter function public\.management_move_computer\(uuid, jsonb\)\s+rename to management_move_computer_core;/i);
  assert.match(migration, /revoke all on function public\.management_move_computer_core\(uuid, jsonb\)\s+from public, authenticated;/i);
  assert.match(migration, /create function public\.management_move_computer\(/i);
  assert.doesNotMatch(migration, /\b(?:update|delete|truncate)\s+public\.(?:module_records|equipment_events|control_items)\b/i);
  assert.match(migration, /commit;\s*$/i);
});

test('089 preserva idempotência e revalida a ocupação sob bloqueio', () => {
  const advisory = migration.indexOf('pg_advisory_xact_lock(89188');
  const priorEvent = migration.indexOf("e.source_event_key = p_operation_id::text");
  const rowLock = migration.indexOf('order by r.id for update');
  const pdvGuard = migration.indexOf('O substituto já ocupa outro PDV');
  assert.ok(advisory >= 0 && advisory < priorEvent && priorEvent < rowLock && rowLock < pdvGuard);
  assert.match(migration, /source_row\.payload ->> 'terminal' ~\* '\^PDV/);
  assert.match(migration, /incoming_status <> 'Ativo'/);
  assert.match(migration, /return public\.management_move_computer_core\(p_operation_id, p_plan\);/);
});
