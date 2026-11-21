import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sql = readFileSync(new URL('../supabase/095_control_case_architecture.sql', import.meta.url), 'utf8');
const source = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
const apiFor = client => {
  const window = { ALDECKOT_SUPABASE_CONFIG: { url: 'https://test.supabase.co', publishableKey: 'test-public-key' },
    supabase: { createClient: () => client } };
  runInNewContext(source, { window, console, Headers, Request, URLSearchParams });
  return window.AldeckotSupabase;
};

test('migração de chamados é aditiva, transacional e conserva identidade e estado legado', () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /^commit;/m);
  assert.match(sql, /create table public\.control_cases \(/);
  assert.match(sql, /create table public\.control_case_transitions \(/);
  assert.match(sql, /select c\.id,c\.id,c\.table_id/);
  assert.match(sql, /when c\.status = 'Em manutenção' then 'Em manutenção' else null end/);
  assert.match(sql, /requires_review/);
  assert.match(sql, /management_computer_id/);
  assert.match(sql, /nullif\(btrim\(c\.serial\),''\) is not null/);
  assert.match(sql, /management_identity_ok/);
  assert.doesNotMatch(sql, /m\.management_computer_id,c\.management_record_id,c\.supply_unit_id/);
  assert.doesNotMatch(sql, /drop table public\.control_items/i);
  assert.doesNotMatch(sql, /update public\.inventory_items set/i);
});

test('episódio novo não reabre encerrado e transição manual não altera status físico nem Flux', () => {
  assert.match(sql, /ticket_state not in \('Concluído','Cancelado'\)/);
  assert.match(sql, /Após um encerramento, a nova entrada técnica é sempre outro chamado/);
  assert.match(sql, /p_next_state = 'Concluído' and current_case\.ticket_state <> 'Resolvido'/);
  assert.match(sql, /physicalMovement',false,'equipmentStatusChanged',false/);
  assert.doesNotMatch(sql, /update public\.(inventory_items|module_records|flux_items) set/i);
});

test('chamados e transições são legíveis somente por contas ativas; escrita usa RPC autorizada', () => {
  assert.match(sql, /alter table public\.control_cases enable row level security/);
  assert.match(sql, /alter table public\.control_case_transitions enable row level security/);
  assert.match(sql, /revoke all on public\.control_cases,public\.control_case_transitions from public,anon,authenticated/);
  assert.match(sql, /app\.can_manage_module_table\(current_case\.table_id,'control','update'\)/);
  assert.match(sql, /request_id uuid unique/);
  assert.match(sql, /before delete on public\.control_items/);
});

test('API lê histórico por item e muda apenas o estado do chamado por RPC', async () => {
  const calls = [];
  let reads = 0;
  const query = {
    select(columns) { calls.push(['select', columns]); return query; },
    eq(column, value) { calls.push(['eq', column, value]); return query; },
    order(column, options) { calls.push(['order', column, options.ascending]);
      reads += 1;
      return Promise.resolve({ data: reads === 1
        ? [{ id: 'case-1', source_module: 'inventory', source_id: 'physical-1', ticket_state: 'Em verificação' }]
        : [{ id: 'case-1', ticket_state: 'Em verificação' }, { id: 'older-case', ticket_state: 'Concluído' }], error: null }); }
  };
  const api = apiFor({
    from(table) { calls.push(['from', table]); return query; },
    rpc(name, args) { calls.push(['rpc', name, args]); return Promise.resolve({ data: { caseId: 'case-1' }, error: null }); }
  });
  const cases = await api.control.listCases('item-1');
  assert.equal(cases[0].ticket_state, 'Em verificação');
  assert.equal(cases.length, 2);
  assert.deepEqual(calls.find(call => call[0] === 'from'), ['from', 'control_cases']);
  assert.deepEqual(calls.filter(call => call[0] === 'eq'), [
    ['eq', 'control_item_id', 'item-1'],
    ['eq', 'source_module', 'inventory'],
    ['eq', 'source_id', 'physical-1']
  ]);
  await api.control.transitionCase('case-1', 'Aguardando peça', 'Aguardando reposição', 'request-1');
  const rpc = calls.find(call => call[0] === 'rpc');
  assert.equal(rpc[1], 'transition_control_case');
  assert.equal(rpc[2].p_next_state, 'Aguardando peça');
  assert.equal(rpc[2].p_reason, 'Aguardando reposição');
  assert.equal(rpc[2].status, undefined);
  assert.equal(rpc[2].location, undefined);
});

test('restauração legada nunca altera dados enquanto não há transação completa', async () => {
  const api = apiFor({ from() { throw Error('Nenhuma consulta ou mutação deve ocorrer.'); } });
  await assert.rejects(api.control.replace({ tables: [] }), /Backup preservado.*Nenhum registro foi alterado/);
});
