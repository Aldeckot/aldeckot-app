import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build, consolidate, dateKey, RULES } = require('../home-operational-model.js');
const now = new Date('2026-10-22T15:00:00Z');
const empty = () => ({ inventory: [], management: [], control: [], controlLogs: [], flux: [], nfe: [], events: [], stock: [], effects: [], backups: [], health: {} });
const pc = (extra = {}) => ({ id: 'position-1', computerId: 'computer-1', equipment: 'Caixa 01', tag: 'AJPCCX01',
  serial: 'SERIAL-PC-001', status: 'Ativo', tableId: 'management', createdAt: '2026-09-01', ...extra });

test('resumo e ativo usam uma identidade por PC e não contam posições vazias nem periféricos repetidos', () => {
  const source = empty();
  source.inventory = [{ id: 'inv-pc', equipment: 'Computador', tableName: 'Computadores', serial: 'SERIAL-PC-001', tag: 'AJPCCX01', status: 'Reserva' },
    { id: 'monitor', equipment: 'Monitor', status: 'Ativo' }];
  source.management = [pc(), { id: 'empty', equipment: '', peripherals: [{ sourceItemId: 'monitor' }] }];
  const result = build(source, now);
  assert.equal(result.sets.equipment.length, 2);
  assert.equal(result.sets['status:Ativo'].length, 2);
  assert.equal(result.sets.equipment[0].origins.length, 2);
  assert.match(result.sets.equipment[0].targetUrl, /item=position-1/);
  assert.equal(source.inventory[0].status, 'Reserva');
});

test('TAG semelhante ou reutilizada não une equipamentos, séries ambíguas são preservadas', () => {
  const result = consolidate([{ id: 'a', equipment: 'Computador', tag: 'SAME', serial: 'SER-A' },
    { id: 'b', equipment: 'Computador', tag: 'OTHER', serial: 'SER-A' }], [pc({ tag: 'SAME', serial: 'SER-A' })]);
  assert.equal(result.equipment.length, 3);
  assert.ok(result.warnings.some(row => row.kind === 'tag'));
});

test('UUID explícito preserva identidade quando TAG muda e impede união múltipla ao mesmo UUID', () => {
  const result = consolidate([{ id: 'inv', equipment: 'PC', tag: 'OLD' }], [
    pc({ inventoryItemId: 'inv', tag: 'NEW' }), pc({ id: 'position-2', computerId: 'computer-2', inventoryItemId: 'inv' })
  ]);
  assert.equal(result.equipment.length, 2);
  assert.equal(result.equipment[0].key, 'inventory:inv');
  assert.equal(result.equipment[0].tag, 'NEW');
  assert.ok(result.warnings.some(row => row.kind === 'identity'));
});

test('manutenção e chamado representam registros do Controle TI, não repetem PCs em manutenção', () => {
  const source = empty();
  source.management = [pc({ status: 'Manutenção' })];
  source.control = [{ id: 'open', status: 'Em manutenção' }, { id: 'evaluation', status: 'Aguardando avaliação', followUpKind: 'verification' },
    { id: 'complete', status: 'Manutenção concluída' }, { id: 'cancel', status: 'Cancelado' }];
  const result = build(source, now);
  assert.equal(result.sets.maintenance.length, 1);
  assert.equal(result.sets.tickets.length, 2);
  assert.equal(result.sets['status:Manutenção'].length, 1);
});

test('conclusão usa evento ou data de saída; edição recente não inventa conclusão', () => {
  const source = empty();
  source.control = [{ id: 'a', status: 'Manutenção concluída', exitDate: '2026-10-11', updatedAt: now.toISOString() },
    { id: 'b', status: 'Manutenção concluída', exitDate: '', updatedAt: now.toISOString() },
    { id: 'c', status: 'Em manutenção' }];
  source.events = [{ id: 'event-a', sourceId: 'a', action: 'Manutenção concluída', createdAt: '2026-10-12T12:00:00Z' },
    { id: 'event-c', sourceId: 'c', action: 'Manutenção concluída', createdAt: '2026-09-12T12:00:00Z' }];
  const result = build(source, now);
  assert.equal(result.sets['monthly:maintenance'].length, 1);
  assert.equal(result.metrics.find(row => row.key === 'maintenance').previous, 1);
  assert.equal(result.sets.tickets.length, 1);
});

test('manutenção prolongada usa entrada do chamado e não a última edição das observações', () => {
  const source = empty();
  source.inventory = [{ id: 'inv', equipment: 'Impressora', status: 'Manutenção', updatedAt: now.toISOString() }];
  source.control = [{ id: 'ticket', inventoryItemId: 'inv', status: 'Em manutenção', entryDate: '2026-10-01' }];
  const result = build(source, now);
  const alert = result.sets.alerts.find(row => row.key === 'case:control:ticket');
  assert.equal(alert.priority, 3);
  assert.match(alert.title, /sem atualização técnica há 21 dias/);
  assert.ok(alert.reasons.some(reason => reason.code === 'maintenance-age' && reason.elapsedDays === 21));
});

test('verificação mantém status e não inventa duração ou cria chamado', () => {
  const source = empty();
  source.inventory = [{ id: 'inv', equipment: 'Scanner', status: 'Ativo', situation: 'Verificando', updatedAt: '2020-01-01' }];
  const result = build(source, now);
  assert.equal(result.sets['status:Ativo'].length, 1);
  assert.equal(result.sets.tickets.length, 0);
  const alert = result.sets.alerts.find(row => row.key === 'case:inventory:inv');
  assert.equal(alert.priority, 0);
  assert.match(alert.detail, /Início não informado/);
  assert.equal(alert.occurredAt, '');
});

test('prazo verificável e defeito usam prioridades auditáveis e ordenação determinística', () => {
  const source = empty();
  source.inventory = [
    { id: 'a', equipment: 'Scanner A', status: 'Ativo', situation: 'Verificando', verificationStartedAt: '2026-10-17T12:00:00Z' },
    { id: 'b', equipment: 'Scanner B', status: 'Defeito' }
  ];
  const result = build(source, now);
  assert.equal(result.sets.alerts[0].priority, 3);
  assert.equal(result.sets.alerts.filter(row => row.priority === 3).length, 1);
  assert.equal(result.sets.alerts.find(row => row.key === 'case:inventory:b').priority, 2);
  assert.deepEqual(result.sets.alerts.map(row => row.key), build(source, now).sets.alerts.map(row => row.key));
  assert.equal(RULES.maintenanceHighDays, 30);
});

test('limites de 14/15/29/30 dias e atualização técnica de 6/7/14/15 dias', () => {
  const day = days => new Date(now.getTime() - days * 86400000).toISOString();
  for (const [days, expected] of [[14,null],[15,2],[29,2],[30,3]]) {
    const source = empty();
    source.inventory = [{ id:'inv', equipment:'Impressora', status:'Manutenção' }];
    source.control = [{ id:'ticket', inventoryItemId:'inv', status:'Em manutenção', entryDate:day(days) }];
    source.controlLogs = [{ id:'log', controlItemId:'ticket', createdAt:day(1), action:'update' }];
    const alert = build(source,now).sets.alerts.find(row => row.key === 'case:control:ticket');
    assert.equal(alert?.reasons.find(reason => reason.code === 'maintenance-age')?.elapsedDays ?? null, expected == null ? null : days);
    if (expected != null) assert.equal(alert.priority, expected);
  }
  for (const [days, expected] of [[6,null],[7,2],[14,2],[15,3]]) {
    const source = empty();
    source.control = [{ id:'ticket', status:'Aguardando avaliação', entryDate:day(days + 3), updatedAt:day(0) }];
    source.controlLogs = [{ id:'log', controlItemId:'ticket', createdAt:day(days), action:'update' }];
    const alert = build(source,now).sets.alerts.find(row => row.key === 'case:control:ticket');
    assert.equal(alert?.priority ?? null, expected);
    if (alert) assert.equal(alert.reasons[0].elapsedDays, days);
  }
});

test('duas causas do mesmo chamado preservam motivos e vence a maior gravidade', () => {
  const source = empty();
  source.inventory = [{ id:'inv', equipment:'Pin Pad', status:'Manutenção', situation:'Verificando' }];
  source.control = [{ id:'ticket', inventoryItemId:'inv', status:'Em manutenção', entryDate:'2026-10-01' }];
  const alerts = build(source,now).sets.alerts.filter(row => row.key === 'case:control:ticket');
  assert.equal(alerts.length,1);
  assert.equal(alerts[0].priority,3);
  assert.ok(alerts[0].reasons.some(reason => reason.code === 'maintenance-age'));
  assert.ok(alerts[0].reasons.some(reason => reason.code === 'verification'));
  assert.ok(alerts[0].reasons.some(reason => reason.code === 'stale-followup'));
});

test('transferência em curso sai da contagem após conclusão; cancelada nunca entra', () => {
  const source = empty();
  source.flux = [{ id: 'pending', status: 'Pendente' }, { id: 'transit', status: 'Em Trânsito' },
    { id: 'done', status: 'Recebido', receivedDate: '2026-10-18' }, { id: 'cancel', status: 'Cancelado' }];
  const result = build(source, now);
  assert.equal(result.sets.transfers.length, 2);
  assert.deepEqual(result.sets['monthly:transfers'].map(row => row.id), ['done']);
  source.flux[0] = { ...source.flux[0], status: 'Entregue', receivedDate: '2026-10-22' };
  assert.equal(build(source, now).sets.transfers.length, 1);
});

test('saldo normalizado do Suprimentos gera um alerta por variação e desaparece ao regularizar', () => {
  const source = empty();
  source.stock = [{ itemId: 'toner', itemName: 'Toner', variantId: 'model', name: 'HP', stock: 0, minimum: 3 },
    { itemId: 'toner', itemName: 'Toner', variantId: 'model', name: 'HP', stock: 0, minimum: 3 }];
  const result = build(source, now);
  assert.equal(result.sets.alerts.length, 1);
  assert.equal(result.sets.alerts[0].priority, 3);
  assert.match(result.sets.alerts[0].targetUrl, /item=toner&variant=model/);
  source.stock = [];
  assert.equal(build(source, now).sets.alerts.length, 0);
});

test('atividades automáticas exigem efeito confirmado ou backup automático persistido', () => {
  const source = empty();
  source.events = [{ id: 'manual', action: 'Atualização manual', createdAt: now.toISOString() }];
  source.effects = [{ id: 'applied', module: 'management', eventId: 'manual', status: 'applied', processedAt: now.toISOString() },
    { id: 'pending', module: 'management', status: 'pending', createdAt: now.toISOString() },
    { id: 'false-success', module: 'management', status: 'applied' }];
  source.backups = [{ id: 'b', module: 'inventory', source: 'automatic', createdAt: now.toISOString() },
    { id: 'manual-backup', source: 'manual', createdAt: now.toISOString() }];
  const result = build(source, now);
  assert.equal(result.sets.activities.length, 2);
  assert.ok(result.sets.activities.every(row => !row.key.includes('manual-backup')));
});

test('erro de consulta não vira zero; último conjunto válido é sinalizado como desatualizado', () => {
  const source = empty();
  delete source.control;
  source.health.control = { unavailable: true, error: 'Falha controlada' };
  let result = build(source, now);
  assert.equal(result.availability.tickets.available, false);
  source.control = [{ id: 'a', status: 'Em manutenção' }];
  source.health.control = { stale: true, error: 'Falha controlada' };
  result = build(source, now);
  assert.equal(result.availability.tickets.available, true);
  assert.equal(result.availability.tickets.stale, true);
  assert.equal(result.sets.tickets.length, 1);
});

test('indicadores mensais respeitam São Paulo e não dividem por zero', () => {
  assert.equal(dateKey('2026-11-01T01:00:00Z'), '2026-10-31');
  const source = empty();
  source.inventory = [{ id: 'a', equipment: 'Monitor', status: 'Ativo', createdAt: '2026-11-01T01:00:00Z' }];
  const result = build(source, now);
  assert.equal(result.sets['monthly:new'].length, 1);
  assert.equal(result.metrics[0].change, null);
  assert.equal(result.metrics[0].previous, 0);
});

test('estados não padronizados permanecem classificados em Outros e percentuais usam o mesmo total', () => {
  const source = empty();
  source.inventory = [{ id: 'a', status: 'Troca' }, { id: 'b', status: 'Ativo' }, { id: 'c', status: 'Atenção' }];
  const result = build(source, now);
  assert.equal(result.sets['status:Outros'].length, 2);
  assert.equal(result.status.reduce((sum, state) => sum + result.sets['status:' + state.name].length, result.sets['status:Outros'].length), result.sets.equipment.length);
});

test('pendências de conferência aparecem individualmente em Alertas críticos sem alterar os registros', () => {
  const source = empty();
  source.inventory = [{ id: 'a', tag: 'DUP', status: 'Ativo', createdAt: '2026-10-01' },
    { id: 'b', tag: 'DUP', status: 'Reserva', createdAt: '2026-10-01' }];
  const before = JSON.stringify(source.inventory);
  const result = build(source, now);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.sets.alerts.filter(row => row.key.startsWith('quality:')).length, 1);
  assert.match(result.sets.alerts.find(row => row.key.startsWith('quality:')).detail, /TAG DUP/);
  assert.equal(JSON.stringify(source.inventory), before);
});

test('alerta é removido quando condição deixa de existir, sem mutação do histórico de origem', () => {
  const source = empty();
  source.inventory = [{ id: 'a', status: 'Defeito', tag: 'MON', createdAt: '2026-10-01' }];
  source.events = [{ id: 'log', sourceId: 'a', action: 'Histórico antigo' }];
  const before = JSON.stringify(source.events);
  assert.equal(build(source, now).sets.alerts.length, 1);
  source.inventory[0].status = 'Reserva';
  assert.equal(build(source, now).sets.alerts.length, 0);
  assert.equal(JSON.stringify(source.events), before);
});
