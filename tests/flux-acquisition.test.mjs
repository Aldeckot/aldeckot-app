import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('intenção de aquisição é durável e não concede escrita direta ao navegador', () => {
  const sql = read('supabase/069_flux_inventory_acquisition.sql');
  assert.match(sql, /flux_item_id uuid primary key references public\.flux_items/);
  assert.match(sql, /status text not null check \(status in \('pending', 'completed', 'skipped'\)\)/);
  assert.match(sql, /revoke all on public\.flux_acquisition_intents from anon, authenticated/);
  assert.match(sql, /app\.can_manage_module\('flux', 'update'\)/);
  assert.doesNotMatch(sql, /update public\.inventory_items set status = 'Ativo'/i);
});

test('entrada só ocorre após Recebido, em transação e com identidade revalidada', () => {
  const sql = read('supabase/069_flux_inventory_acquisition.sql');
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /where id = p_flux_item_id for update/);
  assert.match(sql, /intent\.status <> 'pending' or movement\.status <> 'Recebido'/);
  assert.match(sql, /lower\(btrim\(tag\)\) = norm_tag or lower\(btrim\(serial\)\) = norm_serial/);
  assert.match(sql, /matched_count > 1/);
  assert.match(sql, /'Reserva', 'Normal', 'Não realizada'/);
  assert.match(sql, /if intent\.status = 'completed' then[\s\S]*?'alreadyApplied', true/);
});

test('um evento correlaciona Flux e Inventário sem segunda entrada em Suprimentos', () => {
  const sql = read('supabase/069_flux_inventory_acquisition.sql');
  assert.match(sql, /'inventory-acquisition:' \|\| p_flux_item_id::text/);
  assert.match(sql, /insert into public\.inventory_item_logs\(inventory_item_id, action, message, event_id\)/);
  assert.match(sql, /insert into public\.flux_item_logs\(flux_item_id, action, message, event_id\)/);
  assert.match(sql, /'supplies', 'derived-from-inventory'/);
  assert.doesNotMatch(sql, /insert into public\.(?:supplies|supply_units|supply_variants|supply_logs)/i);
});

test('assistente salva escolha pendente, prevê conflitos e exige confirmação', () => {
  const ui = read('inventory.js');
  const api = read('supabase-client.js');
  assert.match(ui, /updatedItem\.situation === 'Aquisição'.*fluxAcquisitionWizard\(updatedItem\)/);
  assert.match(ui, /setAcquisitionIntent\(itemId, destination, tableId, managementArea, managementKind\)/);
  assert.match(ui, /if \(item\.status !== 'Recebido'\)/);
  assert.match(ui, /previewInventoryAcquisition\(itemId\)/);
  assert.match(ui, /AldeckotMessage\.confirm\(action/);
  assert.match(ui, /completeInventoryAcquisition\(itemId\)/);
  assert.match(api, /client\.rpc\('flux_complete_inventory_acquisition'/);
});
