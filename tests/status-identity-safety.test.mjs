import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/062_status_identity_safety.sql'), 'utf8');
const functionBody = name => {
  const start = migration.indexOf(`create or replace function ${name}`);
  assert.notEqual(start, -1, `${name} ausente`);
  const next = migration.indexOf('create or replace function ', start + 1);
  return migration.slice(start, next < 0 ? migration.length : next);
};

test('062 preserva dados legados e pode ser reaplicada sem backfill', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.equal(migration.split('$$').length % 2, 1, 'blocos SQL devem estar balanceados');
  const topLevel = migration.split('$$').filter((_, index) => index % 2 === 0).join('\n');
  assert.doesNotMatch(topLevel, /^\s*(?:insert into|update public\.|delete from|truncate|drop table)\b/im);
  assert.doesNotMatch(topLevel, /alter table public\.control_items/i);
});

test('resolução da identidade respeita UUID e bloqueia TAG/série divergentes', () => {
  const resolver = functionBody('app.resolve_inventory_item_id');
  assert.match(resolver, /if p_item_id is not null then/);
  assert.match(resolver, /return p_item_id;/);
  assert.match(resolver, /if matching_count > 1 then/);
  assert.match(resolver, /matched_tag is distinct from tag_key/);
  assert.match(resolver, /matched_serial is distinct from serial_key/);
  assert.match(resolver, /'\*\*\*'/);
});

test('matriz de status não remove Em uso da operação nem reativa conclusão', () => {
  const inventory = functionBody('app.sync_inventory_status_from_control');
  const management = functionBody('app.management_status_from_control');
  assert.match(inventory, /when 'Em uso' then 'Ativo'/);
  assert.match(inventory, /when 'Aguardando avaliação' then 'Manutenção'/);
  assert.match(inventory, /when 'Manutenção concluída' then 'Reserva'/);
  assert.match(management, /when 'aguardando avaliação' then 'Manutenção'/);
  assert.doesNotMatch(management, /when 'manutenção concluída' then 'Ativo'/);
  assert.match(inventory, /old\.status is not distinct from new\.status then return new/);
});

test('logs não são copiados para outra identidade por um FK de terminal antigo', () => {
  const managementMatch = functionBody('app.management_identity_matches');
  const managementSync = functionBody('app.sync_management_status_from_control');
  const managementLog = functionBody('app.copy_control_log_to_management');
  const inventoryLog = functionBody('app.copy_control_log_to_inventory');
  assert.match(managementMatch, /if tag_key is null and serial_key is null then return false/);
  assert.match(managementMatch, /p_payload ->> 'numero_serie'/);
  assert.match(managementSync, /app\.management_identity_matches\(record_row\.payload, new\.tag, new\.serial\)/);
  assert.match(managementLog, /app\.management_identity_matches\(record_row\.payload, control_item\.tag, control_item\.serial\)/);
  assert.match(inventoryLog, /app\.resolve_inventory_item_id\(/);
});

test('RPC de conflitos deixa de executar anonimamente', () => {
  assert.match(migration, /revoke all on function public\.equipment_identity_conflicts\(\) from public, anon;/);
  assert.match(migration, /grant execute on function public\.equipment_identity_conflicts\(\) to authenticated;/);
});
