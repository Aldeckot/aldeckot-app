/* Uma linha por identidade física; registros legados ambíguos permanecem separados. */
(() => {
  const normalize = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const linkedKey = item => item.equipmentUid ? `uid:${item.equipmentUid}`
    : item.inventoryItemId ? `inventory:${item.inventoryItemId}`
      : item.sourceModule && item.sourceRecordId && item.sourceModule !== 'flux'
        ? `${item.sourceModule}:${item.sourceRecordId}` : '';
  const eventDate = item => item.movement === 'Recebimento'
    ? item.receivedDate || item.sendDate || item.updatedAt || ''
    : item.sendDate || item.updatedAt || '';

  function groups(tables, tableId, { query = '', status = '', situation = '' } = {}) {
    const records = (tables || []).flatMap(table => (table.items || []).map(item => ({ ...item, tableId: table.id, tableName: table.name })));
    const search = normalize(query);
    const byId = new Map(records.map(item => [item.id, item]));
    const grouped = new Map();
    records.forEach(item => {
      const parentId = item.returnOf || (item.sourceModule === 'flux' ? item.sourceRecordId : null);
      const parent = parentId && byId.get(parentId);
      const linked = linkedKey(item) || (parent && linkedKey(parent));
      const key = linked || `record:${parent?.id || item.id}`;
      if (!grouped.has(key)) grouped.set(key, { key, items: [] });
      grouped.get(key).items.push(item);
    });
    return [...grouped.values()].map(group => {
      group.items.sort((a, b) => eventDate(a).localeCompare(eventDate(b)) || a.id.localeCompare(b.id));
      group.selected = group.items.filter(item => item.tableId === tableId);
      group.latest = group.selected.findLast(item => (!status || item.status === status)
        && (!situation || item.situation === situation)) || null;
      const returns = new Map(group.items.filter(item => item.returnOf).map(item => [item.returnOf, item]));
      group.cycles = group.items.filter(item => item.movement === 'Envio').map(send => ({ send, entry: returns.get(send.id) || null }));
      group.cycle = group.latest
        ? group.cycles.find(({ send, entry }) => send.id === group.latest.id || entry?.id === group.latest.id) || null
        : null;
      return group;
    }).filter(group => group.latest && (!search || group.items.some(item =>
      [item.equipment, item.tag, item.serial, item.brand, item.model, item.senderCompany, item.destinationCompany]
        .some(value => normalize(value).includes(search))))).sort((a, b) =>
      eventDate(b.latest).localeCompare(eventDate(a.latest)) || a.key.localeCompare(b.key));
  }

  function compareHistory(a, b) {
    const time = value => {
      const timestamp = Date.parse(value);
      return Number.isFinite(timestamp) ? timestamp : -Infinity;
    };
    return b.day.localeCompare(a.day) || time(b.timestamp) - time(a.timestamp)
      || a.key.localeCompare(b.key);
  }

  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit' });

  function localDay(instant) {
    const date = new Date(instant);
    if (!Number.isFinite(date.getTime())) return String(instant || '').slice(0, 10);
    const parts = Object.fromEntries(dayFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function historyEvents(tables) {
    return tables.flatMap(table => table.items.flatMap(item => {
      const base = { item, tableId: table.id, tableName: table.name };
      const rows = [];
      const add = (type, day, timestamp, text) => {
        rows.push({ ...base, type, day, period: day.slice(0, 7), timestamp,
          key: `${item.id}:${type}`, when: timestamp || day, dateOnly: !timestamp, text });
      };
      if (item.movement === 'Envio' && item.sendDate)
        add('Saída', item.sendDate.slice(0, 10), '',
          `${item.equipment} saiu de ${item.senderCompany} para ${item.destinationCompany}${item.situation ? ` por ${item.situation.toLowerCase()}` : ''}.`);
      if (item.deliveredAt)
        add('Entrega', localDay(item.deliveredAt), item.deliveredAt,
          `${item.equipment} teve a entrega confirmada${item.deliveredBy ? ` por ${item.deliveredBy}` : ''} em ${item.destinationCompany}.`);
      if (item.movement === 'Recebimento' && item.receivedDate)
        add(item.returnOf ? 'Retorno' : 'Entrada', item.receivedDate.slice(0, 10), item.receivedAt,
          `${item.equipment} chegou a ${item.destinationCompany}${item.returnOf ? ' em retorno ao envio vinculado' : ''}${item.receiverResponsible ? `; recebido por ${item.receiverResponsible}` : ''}.`);
      return rows;
    })).sort(compareHistory);
  }

  function filterHistory(events, { query = '', month, type, status, from, to }) {
    const search = normalize(query);
    return events.filter(row => (!month || row.period === month)
      && (!type || row.type === type)
      && (!status || (row.shared ? row.shared.new_status : row.item.status) === status)
      && (!from || row.day >= from) && (!to || row.day <= to)
      && (!search || [row.item.equipment, row.item.tag, row.item.serial,
        row.item.senderCompany, row.item.destinationCompany, row.tableName,
        row.shared?.action, row.shared?.previous_location, row.shared?.new_location]
        .some(value => normalize(value).includes(search))));
  }

  const api = { groups, compareHistory, historyEvents, filterHistory, localDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AldeckotFluxCycles = api;
})();
