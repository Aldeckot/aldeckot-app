import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('082 cadastra somente VISORAJ MON001-MON033 sem inventar dados técnicos', () => {
  const sql = read('supabase/082_inventory_monitors_visoraj.sql');
  assert.match(sql, /^begin;[\s\S]*commit;\s*$/m);
  assert.match(sql, /module = 'inventory'/);
  assert.match(sql, /select count\(\*\), \(array_agg\(id\)\)\[1\] into v_table_count, v_table_id/);
  assert.doesNotMatch(sql, /\b(?:min|max)\(id\)/i);
  assert.match(sql, /in \('monitores', 'monitores🖥️'\)/);
  assert.match(sql, /if v_table_count <> 1 then[\s\S]*raise exception/);
  assert.match(sql, /generate_series\(1, 33\)/);
  assert.match(sql, /'MON' \|\| lpad\(number::text, 3, '0'\)/);
  assert.match(sql, /insert into public\.inventory_items \(table_id, equipment, model, tag\)/);
  assert.match(sql, /select v_table_id, 'VISORAJ', '', candidate\.tag/);
  assert.match(sql, /where not exists \([\s\S]*lower\(btrim\(item\.tag\)\) = lower\(candidate\.tag\)/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /insert into public\.inventory_item_logs[\s\S]*from inserted/);
  assert.doesNotMatch(sql, /\b(?:update|delete from)\s+public\.inventory_items\b/i);
});

test('modelo vazio é aceito no banco e apenas no formulário do Inventário', () => {
  const sql = read('supabase/082_inventory_monitors_visoraj.sql');
  const inventory = read('inventory.js');
  const itemForm = inventory.split('function itemForm(entry) {')[1]?.split('function transferForm(')[0];
  assert.ok(itemForm);
  assert.match(sql, /drop constraint if exists inventory_items_model_check/);
  assert.match(sql, /add constraint inventory_items_model_check\s+check \(char_length\(btrim\(model\)\) <= 160\)/);
  assert.match(itemForm, /<span>Modelo<\/span><input name="model" value=/);
  assert.doesNotMatch(itemForm, /<span>Modelo \*<\/span><input name="model" required/);
  assert.match(inventory, /<span>Modelo \*<\/span><input name="model" required/);
});
