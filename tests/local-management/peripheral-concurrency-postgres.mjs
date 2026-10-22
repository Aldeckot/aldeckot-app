import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Execute somente contra um contêiner PostgreSQL descartável criado para testes.
const container = process.env.ALDECKOT_TEST_POSTGRES_CONTAINER || '';
if (!/^aldeckot-pg090-test-[a-z0-9-]+$/.test(container)) {
  throw new Error('Defina ALDECKOT_TEST_POSTGRES_CONTAINER com o nome do contêiner local de testes.');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source001 = readFileSync(resolve(root, 'supabase/001_aldeckot_schema.sql'), 'utf8');
const updatedAtStart = source001.indexOf('create or replace function app.set_updated_at()');
assert.ok(updatedAtStart > 0);
const updatedAtFunction = source001.slice(updatedAtStart, source001.indexOf('$$;', updatedAtStart) + 3);
const migration090 = readFileSync(resolve(root, 'supabase/090_inventory_pdv_movement_history.sql'), 'utf8');
const item = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const operation = n => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const expectedVersion = '2020-01-01 00:00:00+00';

function runSql(sql) {
  const args = ['-d', 'podman-uosserver', '-u', 'root', '--', 'podman', 'exec', '-i',
    container, 'psql', '-U', 'postgres', '-d', 'aldeckot_test', '-X', '-qAt',
    '-v', 'ON_ERROR_STOP=1'];
  const child = spawn('wsl.exe', args, { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.end(sql);
  return new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('close', code => resolveResult({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function checked(sql) {
  const result = await runSql(sql);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  return result.stdout;
}

const fixture = `
  create schema app; create schema auth; create role authenticated;
  create function auth.uid() returns uuid language sql stable as $$
    select '90000000-0000-4000-8000-000000000001'::uuid $$;
  create table public.module_tables (id uuid primary key, module text not null);
  create table public.module_records (
    id uuid primary key, table_id uuid not null references public.module_tables(id),
    payload jsonb not null);
  create table public.inventory_items (
    id uuid primary key, table_id uuid not null, equipment text not null,
    model text not null default '', brand text not null default '',
    serial text not null default '', tag text not null,
    sector text not null default '', location text,
    status text not null, situation text not null default 'Normal',
    cleaning_type text not null default 'Não realizada',
    notes text not null default '', branch_id uuid, position integer not null default 0,
    updated_at timestamptz not null default now());
  create table public.equipment_events (
    id uuid primary key, source_module text not null, source_event_key text not null,
    source_id uuid, inventory_item_id uuid, action text not null,
    previous_status text, new_status text, previous_location text, new_location text,
    origin_location text, destination_location text, reason text,
    affected_modules jsonb, processing_result jsonb, metadata jsonb, actor_id uuid,
    created_at timestamptz not null default now(), unique(source_module, source_event_key));
  create table public.inventory_item_logs (
    id uuid primary key default gen_random_uuid(), inventory_item_id uuid not null,
    action text not null, message text not null, event_id uuid);
  create table public.equipment_event_effects (
    event_id uuid not null, module text not null, status text not null,
    attempts integer not null, processed_at timestamptz,
    primary key (event_id, module));
  create table public.inventory_replacements (id uuid primary key);
  create table public.inventory_branch_events (
    id uuid primary key default gen_random_uuid(), table_id uuid not null,
    item_id uuid, operation text not null, details jsonb not null default '{}'::jsonb,
    correlation_id uuid not null default gen_random_uuid());
  create function public.inventory_swap_locations(uuid,uuid,uuid,text,text,text,text)
    returns void language plpgsql as $$ begin return; end $$;
  create function public.inventory_replace_equipment(uuid,uuid,text,text,text)
    returns uuid language sql as $$ select null::uuid $$;
  create function app.inventory_tag_peripheral_type(p_tag text)
    returns text language sql immutable as $$
    select case when upper(p_tag) like 'IMPR%' then 'Impressora' end $$;
  create function app.can_manage_module_table(uuid,text,text)
    returns boolean language sql stable as $$ select true $$;
  create function app.can_manage_module(text,text)
    returns boolean language sql stable as $$ select true $$;
  create function public.management_movement_history(
    p_computer_id uuid default null, p_position_id uuid default null
  ) returns table (
    event_id uuid, occurred_at timestamptz, action text, reason text,
    metadata jsonb, processing_result jsonb
  ) language sql as $$
    select e.id, e.created_at, e.action, e.reason, e.metadata, e.processing_result
    from public.equipment_events e where false $$;
  ${updatedAtFunction}
  create trigger inventory_items_set_updated_at before update
    on public.inventory_items for each row execute function app.set_updated_at();
  insert into public.module_tables values
    ('10000000-0000-4000-8000-000000000001','management'),
    ('20000000-0000-4000-8000-000000000001','inventory');
  insert into public.module_records values
    ('10000000-0000-4000-8000-000000000010',
     '10000000-0000-4000-8000-000000000001','{"terminal":"PDV 10"}'::jsonb),
    ('10000000-0000-4000-8000-000000000005',
     '10000000-0000-4000-8000-000000000001','{"terminal":"PDV 05"}'::jsonb);
  insert into public.inventory_items
    (id,table_id,equipment,tag,status,location,updated_at) values
    ('${item(1)}','20000000-0000-4000-8000-000000000001',
     'Impressora 1','IMPR001','Ativo','PDV 10','${expectedVersion}'),
    ('${item(2)}','20000000-0000-4000-8000-000000000001',
     'Impressora 2','IMPR002','Ativo','PDV 10','${expectedVersion}');
`;

function saveSql(itemId, operationId, applicationName) {
  return `set application_name = '${applicationName}';
    select (public.inventory_save_pdv_peripheral(
      '${itemId}'::uuid, '{"location":"PDV 05"}'::jsonb,
      '${expectedVersion}'::timestamptz, 'Movimentação confirmada no teste local',
      '${operationId}'::uuid)).location;`;
}

async function waitForActivity(applicationName, condition) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const count = Number(await checked(`select count(*) from pg_stat_activity
      where application_name = '${applicationName}' and ${condition};`));
    if (count > 0) return;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }
  throw new Error(`A sessão ${applicationName} não alcançou o estado esperado.`);
}

async function exercise(label, itemId, firstOperation, secondOperation, expectRetry) {
  const holderName = `aldeckot-090-holder-${label}`;
  const contenderName = `aldeckot-090-contender-${label}`;
  const holder = runSql(`set application_name = '${holderName}'; begin;
    select (public.inventory_save_pdv_peripheral(
      '${itemId}'::uuid, '{"location":"PDV 05"}'::jsonb,
      '${expectedVersion}'::timestamptz, 'Movimentação confirmada no teste local',
      '${firstOperation}'::uuid)).location;
    select pg_sleep(5); commit;`);
  await waitForActivity(holderName, "state = 'active' and query like '%pg_sleep(5)%'");
  const contender = runSql(saveSql(itemId, secondOperation, contenderName));
  await waitForActivity(contenderName, "wait_event_type = 'Lock'");
  const [firstResult, secondResult] = await Promise.all([holder, contender]);
  assert.equal(firstResult.code, 0, firstResult.stderr);
  if (expectRetry) {
    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.match(secondResult.stdout, /PDV 05/);
  } else {
    assert.notEqual(secondResult.code, 0, 'O pedido conflitante não pode concluir');
    assert.match(secondResult.stderr, /O equipamento mudou/);
  }
  const state = await checked(`select location,
    (select count(*) from public.equipment_events where inventory_item_id='${itemId}') as events,
    (select count(*) from public.inventory_item_logs where inventory_item_id='${itemId}') as logs
    from public.inventory_items where id='${itemId}';`);
  assert.equal(state, 'PDV 05|1|1', `Resultado inconsistente em ${label}: ${state}`);
}

await checked(fixture);
await checked(migration090);
await exercise('retry', item(1), operation(1), operation(1), true);
await exercise('conflict', item(2), operation(2), operation(3), false);
console.log('✓ PostgreSQL local: duas sessões, reenvio idempotente e conflito sem escrita parcial.');
