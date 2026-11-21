import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../management.js', import.meta.url), 'utf8');
const start = source.indexOf('  function positionHistoryMarkup(');
const end = source.indexOf('  function detailContent(', start);
assert.ok(start > 0 && end > start);
const renderHistory = new Function('movementHistory', 'payload', 'escape', 'dateTime',
  `${source.slice(start, end)}
   return movementHistoryMarkup({ id: 'pdv', computerId: '' }, 'position');`);
const render = rows => renderHistory({ key: 'pdv:', loading: false, error: '', position: rows },
  { items: [] }, value => String(value ?? '').replaceAll('<', '&lt;'), value => value);

function peripheralEvent(eventId, date, tag, from, to, previousStatus, newStatus,
  { action = 'peripheral-transfer', operationId = '', reason = '', regularizationIntent = '' } = {}) {
  return { event_id: eventId, occurred_at: date, action, reason,
    metadata: { operationId, regularizationIntent, previousStatus, newStatus, peripheral: {
      equipment: 'Impressora', tag, inventoryItemId: tag,
      fromPositionId: from === 'PDV 07' ? 'pdv' : null,
      toPositionId: to === 'PDV 07' ? 'pdv' : null, fromLocation: from, toLocation: to
    } } };
}

test('histórico do PDV agrupa os dois eventos de substituição e preserva a retificação', () => {
  const replacement = { operationId: 'troca-07-04', regularizationIntent: 'replacement',
    reason: 'Retirado em manutenção' };
  const rows = [
    peripheralEvent('correcao', '2026-11-12', 'IMPR004', 'PDV 07', 'PDV 10', 'Ativo', 'Ativo',
      { action: 'Correção cadastral de local', reason: 'Acerto de endereço' }),
    peripheralEvent('evento-entrada', '2026-11-11', 'IMPR004', 'Sala CPD', 'PDV 07', 'Reserva', 'Ativo', replacement),
    peripheralEvent('evento-saida', '2026-11-11', 'IMPR007', 'PDV 07', 'Sala CPD', 'Ativo', 'Manutenção', replacement),
    peripheralEvent('evento-original', '2026-10-12', 'IMPR007', 'Sala CPD', 'PDV 07', 'Reserva', 'Ativo')
  ];
  const html = render(rows);
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.match(html, /Correção cadastral de local[\s\S]*Evento correcao[\s\S]*Substituição no PDV/);
  assert.match(html, /Retirado em manutenção[\s\S]*Operação troca-07-04/);
  assert.match(html, /Retirado · Impressora · TAG IMPR007[\s\S]*Antes · PDV 07 · Ativo[\s\S]*Depois · Sala CPD · Manutenção[\s\S]*Evento evento-saida/);
  assert.match(html, /Instalado · Impressora · TAG IMPR004[\s\S]*Antes · Sala CPD · Reserva[\s\S]*Depois · PDV 07 · Ativo[\s\S]*Evento evento-entrada/);
  assert.match(html, /Evento evento-entrada[\s\S]*Evento evento-original/);
});

test('uma etapa sem o par permanece visível com o próprio evento e seus dados disponíveis', () => {
  const row = peripheralEvent('evento-legado', '2026-10-12', 'IMPR007', 'Sala CPD', 'PDV 07',
    undefined, undefined, { operationId: 'troca-parcial', regularizationIntent: 'replacement' });
  const html = render([row]);
  assert.match(html, /Entrada de periférico em substituição/);
  assert.match(html, /Operação troca-parcial[\s\S]*Antes · Sala CPD[\s\S]*Depois · PDV 07[\s\S]*Evento evento-legado/);
  assert.doesNotMatch(html, /Substituição no PDV|undefined/);
});

test('registro antigo da movimentação da Gestão TI é lido no mesmo fuso do evento', () => {
  const client = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
  const start = client.indexOf('  const managementItemFromRow = ');
  const end = client.indexOf('  const managementRecordPayload = ', start);
  assert.ok(start > 0 && end > start);
  const map = new Function(`${client.slice(start, end)} return managementItemFromRow;`)();
  const logs = map({ payload: { logs: [
    { id: 'legacy', eventId: 'event', sourceModule: 'management', at: '2026-10-20T14:34:10.123456' },
    { id: 'explicit', eventId: 'other', sourceModule: 'management', at: '2026-10-20T11:34:10-03:00' },
    { id: 'manual', at: '2026-10-20T14:34:10' }
  ] } }).logs;
  assert.deepEqual(Object.fromEntries(logs.map(log => [log.id, log.at])), {
    legacy: '2026-10-20T14:34:10.123456Z',
    explicit: '2026-10-20T11:34:10-03:00',
    manual: '2026-10-20T14:34:10'
  });
});
