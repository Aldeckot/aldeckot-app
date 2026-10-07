import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/057_inventory_control_maintenance_sync.sql'), 'utf8');

test('Inventário cria manutenção no Controle TI apenas ao entrar nesse status', () => {
  assert.match(migration, /after insert or update of status on public\.inventory_items/);
  assert.match(migration, /if new\.status <> 'Manutenção' then return new/);
  assert.match(migration, /old\.status is not distinct from new\.status then return new/);
  assert.match(migration, /if pg_trigger_depth\(\) > 1 then return new/);
  assert.match(migration, /app\.current_control_maintenance_table_name\(\)/);
  assert.match(migration, /Crie a tabela % no Controle TI/);
});

test('a manutenção usa vínculo estável e reaproveita o item existente', () => {
  assert.match(migration, /add column if not exists inventory_item_id uuid/);
  assert.match(migration, /create unique index if not exists control_items_inventory_item_unique/);
  assert.match(migration, /item\.inventory_item_id = p_inventory_item_id/);
  assert.match(migration, /lower\(btrim\(coalesce\(item\.tag, ''\)\)\) = source_tag/);
  assert.match(migration, /lower\(btrim\(coalesce\(item\.serial, ''\)\)\) = source_serial/);
  assert.match(migration, /existing_inventory_id <> p_inventory_item_id/);
  assert.match(migration, /set inventory_item_id = p_inventory_item_id/);
  assert.match(migration, /perform app\.add_management_control_log\(control_item_id, 'create', sync_message\)/);
});

test('status e histórico do Controle TI retornam ao item vinculado do Inventário', () => {
  assert.match(migration, /create or replace function app\.sync_inventory_status_from_control\(\)/);
  assert.match(migration, /new\.inventory_item_id is not null and item\.id = new\.inventory_item_id/);
  assert.match(migration, /create or replace function app\.copy_control_log_to_inventory\(\)/);
  assert.match(migration, /control_item\.inventory_item_id is not null and item\.id = control_item\.inventory_item_id/);
  assert.match(migration, /on conflict \(inventory_item_id, source_module, source_log_id\)/);
});
