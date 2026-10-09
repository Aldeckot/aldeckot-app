import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import variations from '../supplies-variations.js';

const sql = readFileSync(new URL('../supabase/066_supply_tracked_batch_exit.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../supplies-api.js', import.meta.url), 'utf8');

test('saída usa IDs reais, bloqueio e transação sem reinterpretar status', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /add column if not exists exited_at timestamptz/);
  assert.match(sql, /old\.exited_at is not null and new is distinct from old/);
  assert.match(sql, /for unit_id in select id from unnest\(p_unit_ids\).*order by id loop/);
  assert.match(sql, /from public\.supply_units where id = unit_id for update/);
  assert.match(sql, /from public\.supplies where id = p_supply_id for update/);
  assert.match(sql, /parent\.inventory_group_key is not null/);
  assert.match(sql, /unit_row\.status <> 'Em estoque' or unit_row\.exited_at is not null/);
  assert.match(sql, /insert into public\.supply_movements\([\s\S]*?supply_unit_id[\s\S]*?'Saída'/);
  assert.match(sql, /revoke all on function public\.supply_exit_units_batch\(uuid,uuid\[\],text\) from public, anon/);
  assert.doesNotMatch(sql, /delete from public\.|truncate |update public\.inventory_items/i);
});

test('uma unidade baixada não permanece disponível nem pode sair de novo', () => {
  const stock = { id: 'item-1', tracking_type: 'unit', name: 'Leitores', model: '', brand: '',
    minimum_stock: 0, quantity_stock: 0 };
  const units = [
    { id: 'one', supply_id: 'item-1', variant_id: null, status: 'Em estoque' },
    { id: 'two', supply_id: 'item-1', variant_id: null, status: 'Em estoque', exited_at: '2026-10-09T11:00:00Z' },
    { id: 'three', supply_id: 'item-1', variant_id: null, status: 'Defeito' }
  ];
  const [base] = variations.localVariants(stock, [], units);
  assert.equal(base.total, 3);
  assert.equal(base.reserve, 1);
  assert.equal(variations.exitEligible(units[0]), true);
  assert.equal(variations.exitEligible(units[1]), false);
  assert.equal(variations.exitEligible(units[2]), false);
  assert.equal(variations.exitEligible(units[0], { inactive: true }), false);
});

test('interface seleciona unidades por ID e impede seleção de indisponíveis', () => {
  assert.match(ui, /data-sp-action="unit-exit"/);
  assert.match(ui, /data-sp-exit-search/);
  assert.match(ui, /name="exit_unit_id" value="\$\{safe\(unit\.id\)\}"/);
  assert.match(ui, /eligible\(unit\) \? '' : 'disabled'/);
  assert.match(ui, /new Set\(unitIds\)\.size !== unitIds\.length/);
  assert.match(ui, /api\.exitUnits\(\{ p_supply_id: item\.id, p_unit_ids: unitIds/);
});

test('API não tenta uma saída parcial quando a migração falta', async () => {
  const calls = [];
  const window = { AldeckotSupabase: { init: async () => ({ client: { rpc: async name => {
    calls.push(name); return { error: { code: 'PGRST202', message: 'missing' } };
  } } }) } };
  runInNewContext(apiSource, { window });
  await assert.rejects(window.AldeckotSupplies.exitUnits({ p_supply_id: 'item-1',
    p_unit_ids: ['one', 'two'], p_reason: 'Transferência' }), /Nenhuma unidade foi retirada/);
  assert.deepEqual(calls, ['supply_exit_units_batch']);
});
