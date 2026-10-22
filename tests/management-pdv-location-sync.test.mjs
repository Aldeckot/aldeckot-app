import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/086_inventory_pdv_location_sync.sql'), 'utf8');
const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');

test('a correção de locais parte dos IDs auditados e falha em caso de divergência', () => {
  assert.match(migration, /begin;[\s\S]*lock table public\.inventory_items, public\.module_records, public\.module_tables/i);
  assert.match(migration, /create temporary table aldeckot_pdv_location_map on commit drop as/i);
  assert.match(migration, /count\(\*\) from pg_temp\.aldeckot_pdv_location_map\) <> 78/);
  assert.match(migration, /count\(distinct position_id\).*<> 14/);
  assert.match(migration, /count\(distinct inventory_id\).*<> 78/);
  assert.match(migration, /item\.id::text = \(peripheral\.value ->> 'sourceItemId'\)/);
  assert.match(migration, /lower\(btrim\(coalesce\(inventory_location, ''\)\)\) is distinct from lower\(computer\)/);
  assert.match(migration, /update public\.inventory_items item[\s\S]*set location = mapping\.terminal/);
  assert.match(migration, /if changed_count <> 78 then/);
  assert.match(migration, /commit;/);
});

test('sincronização antiga não remove os periféricos durante a correção', () => {
  const removed = migration.indexOf('drop trigger inventory_peripheral_management_sync');
  const corrected = migration.indexOf('update public.inventory_items item');
  const restored = migration.indexOf('create trigger inventory_peripheral_management_sync');
  assert.ok(removed >= 0 && removed < corrected && corrected < restored);
  assert.match(migration, /after insert or update of tag, location on public\.inventory_items/);
  assert.match(migration, /insert into public\.inventory_item_logs/);
  assert.match(migration, /Sem movimentação física/);
});

test('novas alterações usam o ID patrimonial e a posição física', () => {
  assert.match(migration, /create or replace function app\.apply_inventory_peripheral_assignment/);
  assert.match(migration, /'sourceItemId'\) = p_inventory_item_id::text/);
  assert.match(migration, /payload ->> 'terminal'.*lower\(btrim\(p_location\)\)/);
  assert.match(migration, /create trigger management_pdv_peripheral_location_guard/);
  assert.match(migration, /item\.location.*lower\(position_name\)/);
  assert.match(migration, /raise exception 'Periférico de PDV não corresponde ao ID, TAG ou local físico do Inventário/);
});

test('periféricos legados fora dos PDVs continuam removíveis e atualizáveis', () => {
  assert.match(migration, /legacy_remove boolean := false/);
  assert.match(migration, /legacy_count integer := 0/);
  assert.match(migration, /record_row\.payload ->> 'terminal'.*!~\* '\^PDV/);
  assert.match(migration, /if linked_count = 0 and legacy_count = 0 then/);
});

test('cliente não reatribui periféricos pelo nome do PC após o commit', () => {
  assert.doesNotMatch(client, /const (assignManagementPeripheral|clearManagementPeripheral|appendPeripheralSyncLog)\s*=/,
    'Auxiliares antigos que sobrescreviam todos os periféricos do mesmo tipo não devem voltar');
  assert.match(client, /async syncManagementPeripheral\(item\)[\s\S]*?return \{ \.\.\.nextAssignment, state: 'server-managed' \};/);
  const syncMethod = client.slice(client.indexOf('async syncManagementPeripheral(item)'),
    client.indexOf('async addLog(', client.indexOf('async syncManagementPeripheral(item)')));
  assert.doesNotMatch(syncMethod, /from\('module_records'\)\.update/);
});
