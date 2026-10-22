import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/087_management_computer_identity.sql'), 'utf8');
const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
const managementUi = readFileSync(resolve(root, 'management.js'), 'utf8');

test('a migração cria IDs estáveis sem cadastrar computadores no Inventário', () => {
  assert.match(migration, /position_count <> 33 or computer_count <> 20/);
  assert.match(migration, /add column management_computer_id uuid/);
  assert.match(migration, /set management_computer_id = r\.id/);
  assert.match(migration, /unique \(management_computer_id\) deferrable initially deferred/);
  assert.doesNotMatch(migration, /insert into public\.inventory_items/i);
  assert.match(migration, /commit;/);
});

test('o preenchimento inicial não altera a data de atualização dos PCs', () => {
  const disabled = migration.indexOf('disable trigger module_records_set_updated_at');
  const updated = migration.indexOf('set management_computer_id = r.id');
  const enabled = migration.indexOf('enable trigger module_records_set_updated_at');
  assert.ok(disabled >= 0 && disabled < updated && updated < enabled);
});

test('a edição comum preserva a identidade e bloqueia a transferência legada', () => {
  assert.match(migration, /app\.management_transfer_in_progress/);
  assert.match(migration, /Transferencia antiga desativada/);
  assert.match(migration, /app\.management_movement_in_progress/);
  assert.match(migration, /new\.management_computer_id is distinct from old\.management_computer_id/);
  assert.match(migration, /Remocao de computador exige movimentacao com destino confirmado/);
  assert.match(migration, /create trigger management_computer_identity_guard/);
  assert.match(migration, /create trigger management_position_delete_guard/);
  assert.match(migration, /Use uma restauracao transacional verificada/);
});

test('a restauração antiga não apaga posições em chamadas separadas', () => {
  const restore = client.match(/async replaceAll\(items\) \{([\s\S]*?)\n    \},/);
  assert.ok(restore);
  assert.match(restore[1], /Restauração da Gestão TI temporariamente indisponível/);
  assert.doesNotMatch(restore[1], /\.delete\(\)|\.insert\(/);
});

test('novos backups carregam o ID estável de cada computador', () => {
  assert.match(client, /computerId: row\.management_computer_id \|\| ''/);
  assert.match(client, /async load\(\) \{[\s\S]*?from\('module_records'\)\.select\('\*'\)/);
  assert.match(managementUi, /const backupSnapshot = \(\) => \(\{[\s\S]*?data: \{ items: payload\.items \}/);
});
