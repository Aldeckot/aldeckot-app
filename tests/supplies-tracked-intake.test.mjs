import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sql = readFileSync(new URL('../supabase/065_supply_tracked_batch_intake.sql', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../supplies.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../supplies-api.js', import.meta.url), 'utf8');

test('entrada rastreável é uma função transacional restrita a suprimentos próprios', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /create or replace function public\.supply_create_units_batch\(/);
  assert.match(sql, /not coalesce\(app\.is_admin\(\), false\)/);
  assert.match(sql, /parent\.inventory_group_key is not null/);
  assert.match(sql, /parent\.tracking_type <> 'unit' or parent\.inactive/);
  assert.match(sql, /from public\.supplies where id = p_supply_id for update/);
  assert.match(sql, /jsonb_array_length\(p_units\) not between 1 and 50/);
  assert.match(sql, /insert into public\.supply_units\(supply_id, variant_id, code, serial_number, physical_location\)/);
  assert.match(sql, /insert into public\.supply_movements\([\s\S]*?supply_unit_id/);
  assert.match(sql, /array_append\(created_ids, unit_id\)/);
  assert.match(sql, /grant execute on function public\.supply_create_units_batch\(uuid,uuid,jsonb,text\) to authenticated/);
  assert.doesNotMatch(sql, /delete from public\.|truncate |insert into public\.inventory_items/i);
});

test('entrada identifica cada unidade e não exige TAG ou série', () => {
  assert.match(ui, /data-sp-unit-row/);
  assert.match(ui, /name="unit_count" type="number" min="1" max="50"/);
  assert.match(ui, /TAG ou código físico/);
  assert.match(ui, /name="unit_serial"/);
  assert.match(ui, /rows\.length !== count/);
  assert.match(ui, /api\.createUnits\(\{ p_supply_id: item\.id/);
  assert.match(sql, /'UN-' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/);
  assert.match(sql, /unit_serial <> '' and exists/);
  assert.match(sql, /jsonb_typeof\(entry\) is distinct from 'object'/);
  assert.match(api, /createUnits: async row =>/);
  assert.match(api, /migração 065/);
});

const makeApi = rpc => {
  const window = { AldeckotSupabase: { init: async () => ({ client: { rpc } }) } };
  runInNewContext(api, { window, crypto: { randomUUID: () => 'a1b2-c3d4' } });
  return window.AldeckotSupplies;
};

test('sem migração, a entrada individual preserva a rotina antiga', async () => {
  const calls = [];
  const supplies = makeApi(async (name, args) => {
    calls.push({ name, args });
    return name === 'supply_create_units_batch'
      ? { error: { code: 'PGRST202', message: 'not found' } }
      : { data: 'unit-1' };
  });
  const result = await supplies.createUnits({ p_supply_id: 'supply-1', p_variant_id: null,
    p_units: [{ code: '', serialNumber: '', location: 'Estoque' }], p_reason: 'Compra' });
  assert.equal(result.legacy, true);
  assert.equal(result.ids[0], 'unit-1');
  assert.deepEqual(calls.map(call => call.name), ['supply_create_units_batch', 'supply_create_unit']);
  assert.equal(calls[1].args.p_code, 'UN-a1b2c3d4');
});

test('sem migração, entrada múltipla falha sem gravar unidades', async () => {
  const calls = [];
  const supplies = makeApi(async name => {
    calls.push(name);
    return { error: { code: 'PGRST202', message: 'not found' } };
  });
  await assert.rejects(supplies.createUnits({ p_supply_id: 'supply-1', p_variant_id: null,
    p_units: [{ code: 'A' }, { code: 'B' }], p_reason: 'Compra' }), /Nenhuma unidade foi criada/);
  assert.deepEqual(calls, ['supply_create_units_batch']);
});
