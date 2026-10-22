import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// Banco descartável em memória: nenhuma conexão à produção.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const migration = readFileSync(resolve(root, 'supabase/090_inventory_pdv_movement_history.sql'), 'utf8');
const source001 = readFileSync(resolve(root, 'supabase/001_aldeckot_schema.sql'), 'utf8');
const updatedAtStart = source001.indexOf('create or replace function app.set_updated_at()');
assert.ok(updatedAtStart > 0);
const updatedAtFunction = source001.slice(updatedAtStart, source001.indexOf('$$;', updatedAtStart) + 3);
const db = new PGlite();
const first = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const ids = {
  inventoryTable: '20000000-0000-4000-8000-000000000002',
  pdv10: '10000000-0000-4000-8000-000000000010',
  pdv05: '10000000-0000-4000-8000-000000000005',
  item: '30000000-0000-4000-8000-000000000001',
  computer: '40000000-0000-4000-8000-000000000010',
};

try {
  await db.exec(`
    create schema app; create schema auth; create role authenticated;
    create function auth.uid() returns uuid language sql stable as $$
      select '90000000-0000-4000-8000-000000000001'::uuid $$;
    create table public.module_tables (
      id uuid primary key, module text not null
    );
    create table public.module_records (
      id uuid primary key, table_id uuid not null references public.module_tables(id),
      payload jsonb not null
    );
    create table public.inventory_items (
      id uuid primary key, table_id uuid not null, equipment text not null,
      model text not null default '', brand text not null default '',
      serial text not null default '', tag text not null,
      sector text not null default '', location text,
      status text not null, situation text not null default 'Normal',
      cleaning_type text not null default 'Não realizada',
      notes text not null default '', branch_id uuid, position integer not null default 0,
      updated_at timestamptz not null default now()
    );
    create table public.equipment_events (
      id uuid primary key, source_module text not null, source_event_key text not null,
      source_id uuid, inventory_item_id uuid, action text not null,
      previous_status text, new_status text, previous_location text, new_location text,
      origin_location text, destination_location text, reason text,
      affected_modules jsonb, processing_result jsonb, metadata jsonb, actor_id uuid,
      created_at timestamptz not null default now(),
      unique(source_module, source_event_key)
    );
    create table public.inventory_item_logs (
      id uuid primary key default gen_random_uuid(), inventory_item_id uuid not null,
      action text not null, message text not null, event_id uuid
    );
    create table public.equipment_event_effects (
      event_id uuid not null, module text not null, status text not null,
      attempts integer not null, processed_at timestamptz,
      primary key (event_id, module)
    );
    create table public.inventory_replacements (id uuid primary key);
    create function public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text)
      returns void language plpgsql as $$ begin return; end $$;
    create function public.inventory_replace_equipment(uuid,uuid,text,text,text)
      returns uuid language sql as $$ select null::uuid $$;
    create function app.inventory_tag_peripheral_type(p_tag text)
      returns text language sql immutable as $$
      select case when upper(p_tag) like 'IMPR%' then 'Impressora' end $$;
    create function app.can_manage_module_table(p_table_id uuid, p_module text, p_operation text)
      returns boolean language sql stable as $$ select true $$;
    create function public.management_movement_history(
      p_computer_id uuid default null, p_position_id uuid default null
    ) returns table (
      event_id uuid, occurred_at timestamptz, action text, reason text,
      metadata jsonb, processing_result jsonb
    ) language sql as $$
      select e.id, e.created_at, e.action, e.reason, e.metadata, e.processing_result
      from public.equipment_events e where false $$;
    insert into public.module_tables values
      ('20000000-0000-4000-8000-000000000001','management'),
      ('${ids.inventoryTable}','inventory');
    insert into public.module_records values
      ('${ids.pdv10}','20000000-0000-4000-8000-000000000001',
        '{"terminal":"PDV 10","peripherals":[]}'::jsonb),
      ('${ids.pdv05}','20000000-0000-4000-8000-000000000001',
        '{"terminal":"PDV 05","peripherals":[]}'::jsonb);
    insert into public.inventory_items
      (id, table_id, equipment, tag, status, location, updated_at) values
      ('${ids.item}','${ids.inventoryTable}',
       'Impressora MPR2','IMPR002','Ativo','PDV 10',now() - interval '1 minute');
  `);
  await db.exec(updatedAtFunction);
  await db.exec(`create trigger inventory_items_set_updated_at before update
    on public.inventory_items for each row execute function app.set_updated_at()`);
  await db.exec(migration);

  const expected = (await first('select updated_at from public.inventory_items where id=$1',
    [ids.item])).updated_at;
  const operationId = '50000000-0000-4000-8000-000000000001';
  const move = async (id, location, reason = 'Troca de posição confirmada', version = expected) =>
    first(`select (public.inventory_save_pdv_peripheral(
      $1::uuid, $2::jsonb, $3::timestamptz, $4::text, $5::uuid)).location as location`,
      [ids.item, JSON.stringify({ location }), version, reason, id]);
  await assert.rejects(move('50000000-0000-4000-8000-000000000009', 'PDV 05', ''),
    /motivo \(5 a 500 caracteres\)/);
  assert.equal((await first('select count(*)::integer as count from public.equipment_events')).count, 0);
  const duplicateClicks = await Promise.all([
    move(operationId, 'PDV 05'), move(operationId, 'PDV 05')
  ]);
  assert.deepEqual(duplicateClicks.map(result => result.location), ['PDV 05', 'PDV 05'],
    'Dois envios do mesmo pedido retornam o mesmo resultado');
  assert.equal((await move(operationId, 'PDV 05')).location, 'PDV 05',
    'Reenvio idempotente retorna a operação sem duplicar evento');
  assert.notEqual((await first('select updated_at from public.inventory_items where id=$1',
    [ids.item])).updated_at.getTime(), expected.getTime(),
  'O gatilho real deve atualizar a versão do equipamento');
  await assert.rejects(move('50000000-0000-4000-8000-000000000008', 'PDV 10'),
    /O equipamento mudou/);
  await assert.rejects(move(operationId, 'PDV 10'), /Identificador de operação já usado/);
  const event = await first(`select e.id, e.source_module, e.inventory_item_id,
    e.previous_location, e.new_location, e.metadata, l.event_id as log_event_id
    from public.equipment_events e join public.inventory_item_logs l on l.event_id = e.id`);
  assert.equal(event.source_module, 'inventory');
  assert.equal(event.inventory_item_id, ids.item);
  assert.equal(event.previous_location, 'PDV 10');
  assert.equal(event.new_location, 'PDV 05');
  assert.equal(event.log_event_id, event.id);
  assert.equal(event.id, operationId);
  assert.deepEqual(event.metadata.positionIds, [ids.pdv10, ids.pdv05]);
  assert.equal((await first('select reason from public.equipment_events where id=$1', [event.id])).reason,
    'Troca de posição confirmada');
  const effects = (await db.query(`select module, status from public.equipment_event_effects
    where event_id = $1 order by module`, [event.id])).rows;
  assert.deepEqual(effects, [
    { module: 'inventory', status: 'applied' },
    { module: 'management', status: 'applied' }
  ]);

  for (const positionId of [ids.pdv10, ids.pdv05]) {
    const rows = (await db.query(`select * from public.management_movement_history(null,$1::uuid)`,
      [positionId])).rows;
    assert.equal(rows.length, 1, 'O mesmo evento deve aparecer nos dois PDVs');
    assert.equal(rows[0].event_id, event.id);
  }
  const computerHistory = (await db.query(`select * from public.management_movement_history($1::uuid,null)`,
    [ids.computer])).rows;
  assert.equal(computerHistory.length, 0, 'Movimento do periférico não pertence ao histórico do PC');

  await db.exec(`update public.inventory_items set status = 'Reserva' where id = '${ids.item}'`);
  await db.exec(`update public.inventory_items set location = 'PDV 05' where id = '${ids.item}'`);
  assert.equal((await first('select count(*)::integer as count from public.equipment_events')).count, 1,
    'Edição sem mudança física não cria outro evento');

  await assert.rejects(db.exec(`update public.inventory_items set location = 'PDV 99'
    where id = '${ids.item}'`), /PDV de origem ou destino inexistente/);
  assert.equal((await first(`select location from public.inventory_items where id = $1`, [ids.item])).location,
    'PDV 05', 'PDV inexistente não muda o equipamento');
  await assert.rejects(db.exec(`update public.inventory_items set location = 'PDV 10'
    where id = '${ids.item}'`), /Informe o motivo da movimentação física/);
  assert.equal((await first(`select location from public.inventory_items where id = $1`, [ids.item])).location,
    'PDV 05', 'Atualização direta sem motivo não move o periférico');

  await db.exec(`
    create function app.reject_test_movement() returns trigger language plpgsql as $$
    begin raise exception 'falha simulada'; end $$;
    create trigger zz_reject_test_movement after update of location on public.inventory_items
      for each row execute function app.reject_test_movement();
  `);
  const currentVersion = (await first('select updated_at from public.inventory_items where id=$1',
    [ids.item])).updated_at;
  await assert.rejects(move('50000000-0000-4000-8000-000000000010', 'PDV 10',
    'Troca de posição confirmada', currentVersion), /falha simulada/);
  assert.equal((await first(`select location from public.inventory_items where id = $1`, [ids.item])).location,
    'PDV 05', 'Falha posterior reverte a mudança de local');
  assert.equal((await first('select count(*)::integer as count from public.equipment_events')).count, 1,
    'Falha posterior reverte também o evento e seu log');
  assert.equal((await first('select count(*)::integer as count from public.inventory_item_logs')).count, 1);

  console.log('✓ Periférico: um evento compartilhado nos dois PDVs e no Inventário; PC isolado; rollback íntegro.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
