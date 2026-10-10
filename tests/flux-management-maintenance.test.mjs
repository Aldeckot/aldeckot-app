import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'supabase/072_flux_management_maintenance.sql'), 'utf8');
const api = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
const managementPath = migration.split('create or replace function app.process_flux_management_maintenance')[1]
  .split('create or replace function app.sync_flux_maintenance_to_inventory')[0];
const triggerPath = migration.split('create or replace function app.sync_flux_maintenance_to_inventory')[1];

test('origem selecionada na Gestão TI é resolvida por UUID antes da busca patrimonial', () => {
  assert.match(triggerPath, /if new\.source_module = 'management' then[\s\S]*?process_flux_management_maintenance\(new\.id\)/);
  assert.ok(triggerPath.indexOf("if new.source_module = 'management'") < triggerPath.indexOf('from public.inventory_items'));
  assert.match(managementPath, /r\.id = movement\.source_record_id for update of r/);
  assert.match(managementPath, /TAG ou série também identifica outro computador/);
  assert.doesNotMatch(managementPath, /insert into public\.(?:inventory_items|module_records|control_items)/i);
});

test('envio para manutenção atualiza o mesmo computador e confirma chamado mensal', () => {
  assert.match(managementPath, /movement\.reason <> 'Manutenção'/);
  assert.match(managementPath, /movement\.movement <> 'Envio'/);
  assert.match(managementPath, /current_control_maintenance_table_name\(\)/);
  assert.match(managementPath, /update public\.module_records set payload = jsonb_set/);
  assert.match(managementPath, /sync_management_record_to_control\(computer\.id/);
  assert.match(managementPath, /c\.management_record_id = computer\.id for update of c/);
  assert.match(managementPath, /control_item\.status <> 'Em manutenção'/);
  assert.match(managementPath, /O chamado do Controle TI não foi confirmado/);
});

test('evento único correlaciona logs e reprocessamento não duplica efeitos', () => {
  assert.match(managementPath, /source_event_key = 'management-maintenance:' \|\| movement\.id::text/);
  assert.match(managementPath, /if found then[\s\S]*?return;/);
  assert.match(managementPath, /'eventId', maintenance_event_id::text/);
  assert.match(managementPath, /control_item_logs set event_id = maintenance_event_id/);
  assert.match(managementPath, /flux_item_logs \(flux_item_id, action, message, event_id\)/);
  assert.match(managementPath, /equipment_event_effects \(event_id, module, status, attempts, processed_at\)/);
  assert.match(managementPath, /'flux', 'applied'[\s\S]*'management', 'applied'[\s\S]*'control', 'applied'/);
});

test('falhas de identidade e de sincronização abortam a transação, sem alterar a regra do Inventário', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;/m);
  assert.match(managementPath, /Crie a tabela % no Controle TI/);
  assert.match(managementPath, /Corrija o vínculo antes de salvar/);
  assert.match(triggerPath, /Equipamento TAG % não localizado no Inventário/);
  assert.match(triggerPath, /app\.sync_inventory_maintenance_to_control\(item\.id\)/);
  assert.match(triggerPath, /after insert or update of tag, serial, reason, movement, status,[\s\S]*source_module, source_record_id/);
});

test('cliente não faz gravação tardia que possa parecer falha de um commit concluído', () => {
  const start = api.indexOf('async saveItem(tableId, values, existingId, logMessage)', api.indexOf('missingFluxSourceColumns'));
  const fluxSave = api.slice(start, api.indexOf('async inventoryCategories()', start));
  assert.match(fluxSave, /const saved = check\(result\);[\s\S]*?if \(values\.sourceModule === 'management' && values\.situation === 'Manutenção' &&[\s\S]*?values\.movement === 'Envio'\) return saved;/);
  assert.ok(fluxSave.indexOf("values.sourceModule === 'management'") < fluxSave.indexOf("client.from('flux_item_logs').insert"));
});
