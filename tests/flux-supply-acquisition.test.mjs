import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('migração de Suprimentos limita o destino a itens próprios e quantidades explícitas', () => {
  const sql = read('supabase/071_flux_local_supply_acquisition.sql');
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /supply_quantity between 1 and 1000000/);
  assert.match(sql, /parent\.inventory_group_key is not null/);
  assert.match(sql, /inventory_variant_key is null and not inactive/);
  assert.match(sql, /app\.can_manage_module\('supplies', 'update'\)/);
  assert.match(sql, /movement\.source_module = 'inventory' or movement\.inventory_item_id is not null/);
});

test('recebimento de Suprimentos credita um único saldo sob bloqueio e é idempotente', () => {
  const sql = read('supabase/071_flux_local_supply_acquisition.sql');
  assert.match(sql, /where id = p_flux_item_id for update/);
  assert.match(sql, /intent\.status <> 'pending' or movement\.status <> 'Recebido'/);
  assert.match(sql, /if intent\.status = 'completed' then[\s\S]*?'alreadyApplied', true/);
  assert.match(sql, /select \* into parent from public\.supplies where id = intent\.supply_id for update/);
  assert.match(sql, /where id = intent\.supply_variant_id[\s\S]*?for update/);
  assert.match(sql, /if intent\.supply_variant_id is null then[\s\S]*?update public\.supplies set quantity_stock = next_stock[\s\S]*?else[\s\S]*?update public\.supply_variants set quantity_stock = next_stock/);
  assert.match(sql, /create unique index if not exists supply_movements_event_unique/);
  assert.doesNotMatch(sql, /update public\.inventory_items/i);
});

test('um evento liga a entrada aos históricos do Flux e de Suprimentos', () => {
  const sql = read('supabase/071_flux_local_supply_acquisition.sql');
  assert.match(sql, /'supply-acquisition:' \|\| p_flux_item_id::text/);
  assert.match(sql, /insert into public\.supply_movements/);
  assert.match(sql, /insert into public\.supply_logs/);
  assert.match(sql, /insert into public\.flux_item_logs\(flux_item_id, action, message, event_id\)/);
  assert.match(sql, /update public\.flux_acquisition_intents set status = 'completed'/);
});

test('assistente de aquisição mostra Suprimentos apenas após a migração e pede confirmação', () => {
  const ui = read('inventory.js');
  const api = read('supabase-client.js');
  const css = read('flux.css');
  assert.match(api, /select\('supply_id'\)\.limit\(0\)/);
  assert.match(api, /supplyAvailable: !supplyProbe\.error/);
  assert.match(api, /\.is\('inventory_group_key', null\)/);
  assert.match(ui, /if \(intent\?\.supplyAvailable\)/);
  assert.match(ui, /setSupplyAcquisitionIntent\(itemId, supplyId, supplyVariantId, supplyQuantity\)/);
  assert.match(ui, /previewSupplyAcquisition\(itemId\)/);
  assert.match(ui, /completeSupplyAcquisition\(itemId\)/);
  assert.match(ui, /Creditar estoque/);
  assert.match(css, /\.flux-acquisition-fields\[hidden\]/);
});
