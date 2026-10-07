import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/063_event_context_foundation.sql'), 'utf8');

test('063 é aditiva, transacional e não faz backfill histórico', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  const topLevel = migration.split('$$').filter((_, index) => index % 2 === 0).join('\n');
  assert.doesNotMatch(topLevel, /^\s*(?:insert into|update public\.|delete from|truncate|drop table)\b/im);
  assert.equal(migration.split('$$').length % 2, 1);
});

test('evento-raiz reutiliza o UUID do Inventário e garante idempotência da origem', () => {
  assert.match(migration, /inventory_item_id uuid references public\.inventory_items\(id\)/);
  assert.match(migration, /unique \(source_module, source_event_key\)/);
  assert.match(migration, /source_event_key text not null/);
});

test('efeitos por módulo permitem retry e registram falha parcial', () => {
  assert.match(migration, /create table if not exists public\.equipment_event_effects/);
  assert.match(migration, /status text not null default 'pending'/);
  assert.match(migration, /status in \('pending', 'applied', 'failed', 'skipped'\)/);
  assert.match(migration, /unique \(event_id, module\)/);
  assert.match(migration, /error_message text/);
});

test('logs existentes recebem event_id opcional sem perder compatibilidade', () => {
  for (const table of [
    'inventory_item_logs', 'control_item_logs', 'flux_item_logs',
    'supply_logs', 'sync_events', 'equipment_sync_events'
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table}[\\s\\S]*?add column if not exists event_id uuid`));
  }
  assert.match(migration, /event_id uuid references public\.equipment_events\(id\) on delete set null/);
});

test('eventos e efeitos ficam protegidos por RLS', () => {
  assert.match(migration, /alter table public\.equipment_events enable row level security/);
  assert.match(migration, /alter table public\.equipment_event_effects enable row level security/);
  assert.match(migration, /revoke all on public\.equipment_events, public\.equipment_event_effects from anon/);
  assert.match(migration, /using \(app\.has_active_account\(\)\)/);
});
