import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const sql = read('supabase/073_control_maintenance_completion.sql');
const ui = read('inventory.js');
const api = read('supabase-client.js');
const rpc = sql.split('create or replace function public.complete_control_maintenance(')[1];

test('088 preserva a rotina da 073 com diretiva local, sem configurar parametro de superusuario', () => {
  const movementSql = read('supabase/088_management_movements.sql');
  const functionPattern = /create or replace function public\.complete_control_maintenance\([\s\S]*?^end; \$\$;/m;
  const original = sql.match(functionPattern)?.[0];
  const revised = movementSql.match(functionPattern)?.[0];
  assert.ok(original);
  assert.ok(revised);
  assert.match(revised, /as \$\$\r?\n#variable_conflict use_variable\r?\ndeclare/);
  assert.equal(revised.replace(/^#variable_conflict use_variable\r?\n/m, ''), original);
  assert.doesNotMatch(movementSql, /alter function[^;]*set\s+plpgsql\.variable_conflict/i);
});

test('Controle TI exige escolha explícita e cancelar não salva', () => {
  const choice = ui.split('function chooseMaintenanceResult(item)')[1]
    .split('async function saveItem(form)')[0];
  assert.match(choice, /value="Ativo" required/);
  assert.match(choice, /value="Reserva" required/);
  assert.doesNotMatch(choice, /checked/);
  assert.match(choice, /data-inv-maintenance-cancel[\s\S]*?resolve\(null\)/);
  assert.match(ui, /if \(!maintenanceStatus\) return;/);
  assert.match(ui, /completeMaintenance\(id, valuesToSave, maintenanceStatus, crypto\.randomUUID\(\)\)/);
});

test('interface usa uma RPC para concluir, sem gravação parcial no cliente', () => {
  const control = api.split('const control = {')[1].split('const flux = {')[0];
  const completion = control.split('async completeMaintenance(')[1].split('async saveItem(')[0];
  assert.match(completion, /client\.rpc\('complete_control_maintenance'/);
  assert.doesNotMatch(completion, /client\.from\(/);
  assert.match(control, /inventory_item_id, management_record_id, supply_unit_id/);
});

test('RPC atualiza inventário ou Gestão TI com escolha explícita e preserva local', () => {
  assert.match(rpc, /p_equipment_status not in \('Ativo', 'Reserva'\)/);
  assert.match(rpc, /source_module := 'inventory'/);
  assert.match(rpc, /source_module := 'management'/);
  assert.match(rpc, /update public\.inventory_items set status = p_equipment_status where id = inventory_id/);
  assert.match(rpc, /jsonb_set\(computer\.payload, '\{status\}', to_jsonb\(p_equipment_status\)/);
  assert.doesNotMatch(rpc, /update public\.inventory_items set[^;]*location\s*=/);
  assert.doesNotMatch(rpc, /jsonb_set\([^;]*'\{location\}'/);
  assert.doesNotMatch(rpc, /update public\.flux_items|insert into public\.flux_item_logs/);
});

test('erros e duplicatas não podem produzir conclusão parcial ou sucesso falso', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(rpc, /for update of c/);
  assert.match(rpc, /for update of i/);
  assert.match(rpc, /for update of r/);
  assert.match(rpc, /can_manage_module_table\(ticket\.table_id, 'control', 'update'\)/);
  assert.match(rpc, /can_manage_module_table\(inventory_row\.table_id, 'inventory', 'update'\)/);
  assert.match(rpc, /can_manage_module_table\(computer\.table_id, 'management', 'update'\)/);
  assert.match(rpc, /if ticket\.status = 'Manutenção concluída' then[\s\S]*?already-applied[\s\S]*?raise exception/);
  assert.match(rpc, /equipment_event_effects[\s\S]*'applied'/);
  assert.match(sql, /linked_control_completion_guard/);
});

test('evento e logs compartilham ID e gatilhos não criam ciclo de manutenção', () => {
  assert.match(rpc, /'maintenance-complete:' \|\| p_request_id::text/);
  assert.match(rpc, /inventory_item_logs[\s\S]*event_row\.id/);
  assert.match(rpc, /'eventId', event_row\.id::text/);
  assert.match(rpc, /control_item_logs[\s\S]*event_row\.id/);
  assert.match(rpc, /sync_events \(module, operation, details, event_id\)/);
  assert.match(sql, /management_requires_control[\s\S]*not in \('ativo', 'reserva'\)/);
  assert.match(sql, /management_record_control_sync[\s\S]*app\.control_completion_event/);
  assert.match(sql, /control_item_inventory_status_sync[\s\S]*app\.control_completion_event/);
  assert.match(sql, /control_item_management_status_sync[\s\S]*app\.control_completion_event/);
});
