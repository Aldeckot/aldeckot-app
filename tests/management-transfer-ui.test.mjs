import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'management.js'), 'utf8');
const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
const helper = source.match(/  function selectTransferDestination\(id\) \{[\s\S]*?\n  \}\n\n  function transferAdvance/);
assert.ok(helper, 'O seletor do assistente deve existir.');
const chooseFactory = new Function('state', 'payload', 'activeItem', 'hasInstalledComputer',
  'hasFixedTerminal', 'isOperationalPdv', 'canTransferBetweenAreas', 'renderModal',
  `return (${helper[0].slice(2, -'\n\n  function transferAdvance'.length).trim()});`);

const fixture = (mode, activeId = 'source') => {
  const items = [
    { id: 'source', terminal: 'PDV 01', equipment: 'Caixa 01', computerId: 'pc-1', status: 'Ativo' },
    { id: 'occupied', terminal: 'PDV 02', equipment: 'Caixa 02', computerId: 'pc-2', status: 'Ativo' },
    { id: 'reserve', terminal: 'RES 01', equipment: 'Caixa 15', computerId: 'pc-15', status: 'Reserva' },
    { id: 'empty', terminal: 'PDV 03', equipment: '', computerId: '' }
  ];
  const state = { modal: { type: 'transfer' }, transferBusy: false,
    transferDraft: { step: 2, mode, operationId: 'old-key' } };
  let renders = 0;
  const choose = chooseFactory(state, { items }, () => items.find(item => item.id === activeId),
    item => Boolean(item.equipment), item => Boolean(item.terminal),
    item => /^PDV\s+[0-9]+$/i.test(item.terminal), (a, b) => a === b,
    () => { renders += 1; });
  return { state, choose, get renders() { return renders; } };
};

test('substituição seleciona computador ocupado e exige nova confirmação', () => {
  const flow = fixture('replace-other', 'reserve');
  flow.choose('occupied');
  assert.equal(flow.state.transferDraft.targetId, 'occupied');
  assert.equal(flow.state.transferDraft.step, 3);
  assert.equal(flow.state.transferDraft.operationId, null);
  assert.equal(flow.renders, 1);
});

test('transferência direta aceita apenas posição vazia ou sem terminal', () => {
  const flow = fixture('direct');
  flow.choose('occupied');
  assert.equal(flow.state.transferDraft.step, 2);
  flow.choose('empty');
  assert.equal(flow.state.transferDraft.targetId, 'empty');
  assert.equal(flow.state.transferDraft.step, 3);
  const withoutTerminal = fixture('direct');
  withoutTerminal.choose('__unassigned__');
  assert.equal(withoutTerminal.state.transferDraft.targetId, '__unassigned__');
});

test('ser substituído seleciona a origem do PC que entrará', () => {
  const flow = fixture('be-replaced');
  flow.choose('occupied');
  assert.equal(flow.state.transferDraft.step, 2);
  flow.choose('reserve');
  assert.equal(flow.state.transferDraft.incomingSourceId, 'reserve');
  assert.equal(flow.state.transferDraft.step, 3);
});

test('assistente não avança durante gravação ou com escolha inválida', () => {
  const flow = fixture('replace-other', 'reserve');
  flow.state.transferBusy = true;
  flow.choose('occupied');
  assert.equal(flow.state.transferDraft.step, 2);
  flow.state.transferBusy = false;
  flow.choose('empty');
  assert.equal(flow.state.transferDraft.step, 2);
});

test('PC já instalado em outro PDV não pode substituir computador', () => {
  const flow = fixture('replace-other');
  flow.choose('occupied');
  assert.equal(flow.state.transferDraft.step, 2);
  assert.match(source, /outgoing && isOperationalPdv\(incoming\)/);
});

test('interface usa a RPC nova, confirmação final e chave idempotente', () => {
  assert.match(source, /async function transferActive\(form\) \{\s*if \(state\.transferBusy\) return;/);
  assert.match(source, /draft\.operationId \|\| crypto\.randomUUID\(\)/);
  assert.match(source, /management\.moveComputer\(operationId, plan\)/);
  assert.match(source, /confirmedLocations: true/);
  assert.match(source, /state\.transferBusy = true;[\s\S]*?finally \{\s*state\.transferBusy = false;/);
  assert.match(source, /Etapa \$\{step\} de 5/);
  assert.match(client, /client\.rpc\('management_move_computer'/);
  assert.doesNotMatch(client, /client\.rpc\('management_transfer_terminal'/);
});

test('periféricos permanecem na posição mesmo quando ela fica vazia', () => {
  assert.match(source, /const computerName = item =>[^\n]*'Sem computador instalado'/);
  assert.match(source, /const computers = payload\.items\.filter\(hasInstalledComputer\)/);
  assert.match(source, /tab === 'operational' && !hasInstalledComputer\(item\)/);
});
