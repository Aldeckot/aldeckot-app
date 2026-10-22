import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/085_management_pdv_peripheral_identity.sql'), 'utf8');

test('backfill limita-se aos periféricos de PDV sem ID e não reatribui locais', () => {
  assert.match(migration, /'terminal'.*\~\* '\^PDV\[\[:space:\]\]\+\[0-9\]\+\$'/s);
  assert.match(migration, /'sourceItemId'.*is null/s);
  assert.doesNotMatch(migration, /update\s+public\.inventory_items/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.match(migration, /set payload = jsonb_set\(record_row\.payload, '\{peripherals\}'/);
});

test('auditoria e gravação são atômicas e recusam vínculos incertos', () => {
  assert.match(migration, /begin;[\s\S]*lock table public\.inventory_items, public\.module_records, public\.module_tables in share row exclusive mode;/i);
  assert.match(migration, /create temporary table aldeckot_pdv_peripheral_links on commit drop as/);
  assert.doesNotMatch(migration, /create temporary table pg_temp\./);
  assert.match(migration, /match_count <> 1/);
  assert.match(migration, /if existing_link_count <> 19 then/);
  assert.match(migration, /group by inventory_id having count\(\*\) > 1/i);
  assert.match(migration, /if link_count <> 59 then/);
  assert.match(migration, /peripheral\.value \|\| jsonb_build_object\([\s\S]*'sourceModule', 'inventory', 'sourceItemId'/);
  assert.match(migration, /commit;/);
});
