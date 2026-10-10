import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('migração da Gestão TI preserva uma intenção por movimentação e restringe tipos', () => {
  const sql = read('supabase/070_flux_management_computer_acquisition.sql');
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /management_area in \('Frente de Loja', 'Escritório', 'Estoque'\)/);
  assert.match(sql, /management_kind = 'computer'/);
  assert.match(sql, /p_management_kind is distinct from 'computer'/);
  assert.doesNotMatch(sql, /update public\.inventory_items set status = 'Ativo'/i);
});

test('computador só é integrado após recebimento e identidade revalidada sob bloqueio', () => {
  const sql = read('supabase/070_flux_management_computer_acquisition.sql');
  assert.match(sql, /where id = p_flux_item_id for update/);
  assert.match(sql, /intent\.status <> 'pending' or movement\.status <> 'Recebido'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /matched > 1/);
  assert.match(sql, /candidate\.payload->>'area' is distinct from intent\.management_area/);
  assert.match(sql, /'status', 'Reserva', 'situation', 'Estoque'/);
  assert.match(sql, /'isFixed', false/);
  assert.match(sql, /if intent\.status = 'completed' then[\s\S]*?'alreadyApplied', true/);
});

test('Flux e Gestão TI compartilham evento sem instalar em PDV ou creditar estoque', () => {
  const sql = read('supabase/070_flux_management_computer_acquisition.sql');
  assert.match(sql, /'management-acquisition:' \|\| p_flux_item_id::text/);
  assert.match(sql, /insert into public\.equipment_events/);
  assert.match(sql, /insert into public\.flux_item_logs\(flux_item_id, action, message, event_id\)/);
  assert.match(sql, /'sourceModule', 'flux'/);
  assert.doesNotMatch(sql, /insert into public\.(?:inventory_items|supply_units|supply_variants)/i);
});

test('assistente oferece computador apenas com a migração e pede confirmação', () => {
  const ui = read('inventory.js');
  const api = read('supabase-client.js');
  assert.match(ui, /if \(intent\?\.managementAvailable\)/);
  assert.match(ui, /managementOption\.disabled = false/);
  assert.match(ui, /Periférico — próxima etapa/);
  assert.match(ui, /previewManagementAcquisition\(itemId\)/);
  assert.match(ui, /completeManagementAcquisition\(itemId\)/);
  assert.match(ui, /ainda sem instalação em terminal ou PDV/);
  assert.match(api, /client\.rpc\('flux_complete_management_acquisition'/);
  assert.match(api, /client\.rpc\('flux_set_acquisition_intent'/);
});
