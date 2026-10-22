import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventory = readFileSync(resolve(root, 'inventory.js'), 'utf8');
const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/090_inventory_pdv_movement_history.sql'), 'utf8');

test('Inventário exige motivo apenas ao mudar o Local envolvendo PDV', () => {
  assert.match(inventory, /Motivo da mudança de Local \*/);
  assert.match(inventory, /reasonInput\.required = moving/);
  assert.match(inventory, /pdvMovement && movementReason\.length < 5/);
  assert.match(inventory, /movementOperationId = crypto\.randomUUID\(\)/);
});

test('gravação da 090 usa uma operação, sem log adicional no cliente', () => {
  assert.match(client, /client\.rpc\('inventory_save_pdv_peripheral'/);
  assert.match(client, /if \(!movementRecorded\) \{[\s\S]*?inventory_item_logs/);
  assert.match(client, /result\.error\?\.code === 'PGRST202'/);
  assert.match(migration, /pg_advisory_xact_lock\(89090/);
  assert.match(migration, /prior\.updated_at is distinct from p_expected_updated_at/);
  assert.match(migration, /Informe o motivo da movimentação física do periférico/);
  assert.match(migration, /inventory_item_logs \(inventory_item_id, action, message, event_id\)/);
});

test('histórico do periférico pertence à posição e ao Inventário, não ao PC', () => {
  assert.match(migration, /'positionIds', to_jsonb\(array_remove/);
  assert.match(migration, /e\.source_module = 'inventory' and e\.action = 'peripheral-transfer'/);
  assert.match(migration, /and p_position_id is not null/);
  assert.doesNotMatch(migration, /'computerIds',/);
  assert.match(client, /eventId: log\.event_id \|\| ''/);
  assert.match(inventory, /entry\.id && !entry\.eventId/);
});

test('permuta usa motivo e correlaciona os dois periféricos sem duplicar logs', () => {
  assert.match(inventory, /Motivo da permuta \*/);
  assert.match(inventory, /swapLocations\(first, second, node\.dataset\.operationId, expected, reason\)/);
  assert.match(client, /client\.rpc\('inventory_swap_locations_with_reason'/);
  assert.match(client, /legacy: true/);
  assert.match(migration, /'operationId', coalesce\(requested_group_id, movement_event_id::text\)/);
  assert.match(migration, /if requested_group_id is null then[\s\S]*?inventory_item_logs/);
  assert.match(migration, /inventory_swap_locations_with_reason/);
  assert.match(migration, /pg_advisory_xact_lock\(89091/);
  assert.match(migration, /movementEventId/);
});

test('substituição patrimonial preserva a rotina e liga os logs aos eventos dos PDVs', () => {
  assert.match(migration, /create or replace function public\.inventory_replace_equipment/);
  assert.match(migration, /set_config\('app\.inventory_pdv_operation_id', result_id::text, true\)/);
  assert.match(migration, /insert into public\.inventory_replacements[\s\S]*?values \(result_id,/);
  assert.match(migration, /insert into public\.inventory_item_logs \(inventory_item_id, action, message, event_id\)/);
  assert.match(migration, /metadata ->> 'operationId' = result_id::text/);
});
