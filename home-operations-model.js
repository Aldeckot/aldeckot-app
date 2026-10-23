/* Projeção analítica somente leitura: fatos históricos e processos abertos nunca se somam entre si. */
((root, factory) => {
  const api = factory(root?.AldeckotHomeModel || (typeof require === 'function' ? require('./home-operational-model.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotOperationsModel = api;
})(typeof window !== 'undefined' ? window : null, model => {
  const definitions = {
    registered: { label: 'Equipamentos cadastrados', color: '#18c7e8', module: 'inventory', deps: ['inventory', 'management'] },
    ticketCreated: { label: 'Chamados criados', color: '#9172ef', module: 'control', deps: ['control'] },
    maintenanceDone: { label: 'Manutenções concluídas', color: '#22d8a5', module: 'control', deps: ['control', 'events'] },
    verificationDone: { label: 'Verificações concluídas', color: '#67d4ff', module: 'control', deps: ['control', 'events'] },
    transferDone: { label: 'Transferências concluídas', color: '#ffbf53', module: 'flux', deps: ['flux'] },
    fiscal: { label: 'Ocorrências fiscais', color: '#ff6b8f', module: 'nfe', deps: ['nfe'] },
    maintenanceOpen: { label: 'Manutenções abertas', color: '#ff697b', module: 'control', deps: ['control'] },
    verificationOpen: { label: 'Verificações abertas', color: '#69d4f4', module: 'control', deps: ['control'] },
    ticketOpen: { label: 'Chamados em andamento', color: '#a782ff', module: 'control', deps: ['control'] },
    transferOpen: { label: 'Transferências em curso', color: '#ffca63', module: 'flux', deps: ['flux'] }
  };
  const openStatus = value => ['em manutencao', 'manutencao', 'aguardando avaliacao', 'em sala'].includes(model.norm(value));
  const openTransfer = value => ['pendente', 'em transito', 'aguardando recebimento'].includes(model.norm(value));
  const stamp = row => row.occurredAt || row.createdAt || row.entryDate || '';
  const periodBounds = (period, now, from, to) => {
    if (period === 'all') return { from: '', to: '' };
    if (period === 'custom') return { from: from || '', to: to || '' };
    const today = model.dateKey(now);
    if (period === 'last30') {
      const date = new Date(today + 'T12:00:00-03:00');
      date.setUTCDate(date.getUTCDate() - 29);
      return { from: model.dateKey(date), to: today };
    }
    return { from: today.slice(0, 7) + '-01', to: today };
  };
  function build(source, options = {}, now = new Date()) {
    const mode = options.mode === 'open' ? 'open' : 'activity';
    const period = options.period || (mode === 'open' ? 'all' : 'month');
    const { from, to } = periodBounds(period, now, options.from, options.to);
    const invalidPeriod = period === 'custom' && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to);
    const rows = key => Array.isArray(source?.[key]) ? source[key] : [];
    const consolidated = model.consolidate(rows('inventory'), rows('management')).equipment;
    const control = [...new Map(rows('control').filter(row => row.id).map(row => [row.id, row])).values()];
    const flux = [...new Map(rows('flux').filter(row => row.id).map(row => [row.id, row])).values()];
    const history = source?.operationsHistory?.from === from && source?.operationsHistory?.to === to ? source.operationsHistory : null;
    const operationEvents = Array.isArray(history?.events) ? history.events : rows('events');
    const operationFiscal = Array.isArray(history?.nfe) ? history.nfe : rows('nfe');
    const byCategory = new Map();
    const add = (kind, row, identity, when) => {
      if (!identity) return;
      const definition = definitions[kind];
      const key = 'operation:' + kind + ':' + identity;
      if (byCategory.has(key)) return;
      byCategory.set(key, model.viewRow({ ...row, module: row.module || definition.module,
        key, operationType: kind, occurredAt: when || '', targetUrl: row.targetUrl || model.target(row) }));
    };
    if (mode === 'activity') {
      for (const item of consolidated) {
        const when = item.origins?.map(origin => origin.createdAt).find(value => model.epoch(value) != null) || item.createdAt;
        if (model.epoch(when) != null) add('registered', item, item.key, when);
      }
      for (const ticket of control) if (model.epoch(ticket.createdAt) != null)
        add('ticketCreated', { ...ticket, module: 'control' }, ticket.id, ticket.createdAt);
      for (const event of operationEvents) {
        const action = model.norm(event.action);
        const kind = action === 'manutencao concluida' ? 'maintenanceDone'
          : action === 'verificacao concluida' ? 'verificationDone' : '';
        if (!kind || model.epoch(event.createdAt) == null) continue;
        const ticket = control.find(row => row.id === (event.controlItemId || event.sourceId));
        if (ticket) add(kind, { ...ticket, module: 'control' }, event.id, event.createdAt);
      }
      const completedIds = new Set(operationEvents.filter(event => model.norm(event.action) === 'manutencao concluida')
        .map(event => event.controlItemId || event.sourceId));
      for (const ticket of control) if (model.norm(ticket.status) === 'manutencao concluida'
        && model.epoch(ticket.exitDate) != null && !completedIds.has(ticket.id))
        add('maintenanceDone', { ...ticket, module: 'control' }, 'ticket:' + ticket.id, ticket.exitDate);
      for (const transfer of flux) if (['recebido', 'entregue'].includes(model.norm(transfer.status))
        && model.epoch(transfer.receivedDate) != null)
        add('transferDone', { ...transfer, module: 'flux' }, transfer.id, transfer.receivedDate);
      for (const occurrence of operationFiscal) if (model.epoch(occurrence.occurredAt) != null)
        add('fiscal', { ...occurrence, module: 'nfe', equipment: 'NF-e ' + (occurrence.nfeNumber || 'sem número') },
          occurrence.id, occurrence.occurredAt);
    } else {
      for (const ticket of control.filter(row => openStatus(row.status))) {
        const kind = ticket.followUpKind === 'verification' ? 'verificationOpen'
          : model.norm(ticket.status) === 'em manutencao' || model.norm(ticket.status) === 'manutencao' ? 'maintenanceOpen' : 'ticketOpen';
        add(kind, { ...ticket, module: 'control' }, ticket.id, ticket.entryDate || ticket.createdAt);
      }
      for (const transfer of flux.filter(row => openTransfer(row.status)))
        add('transferOpen', { ...transfer, module: 'flux' }, transfer.id, transfer.createdAt);
    }
    const types = mode === 'activity'
      ? ['registered', 'ticketCreated', 'maintenanceDone', 'verificationDone', 'transferDone', 'fiscal']
      : ['maintenanceOpen', 'verificationOpen', 'ticketOpen', 'transferOpen'];
    const selectedModule = options.module || 'all';
    const selectedType = types.includes(options.type) ? options.type : 'all';
    const health = source?.health || {};
    const missing = [...new Set(types.flatMap(kind => definitions[kind].deps))]
      .filter(key => !Array.isArray(source?.[key]) || health[key]?.unavailable || health[key]?.stale);
    const filtered = [...byCategory.values()].filter(row => {
      if (invalidPeriod) return false;
      if (selectedModule !== 'all' && row.module !== selectedModule) return false;
      if (selectedType !== 'all' && row.operationType !== selectedType) return false;
      const day = model.dateKey(stamp(row));
      if (!from && !to) return true;
      return day && (!from || day >= from) && (!to || day <= to);
    });
    const categories = types.filter(kind => selectedType === 'all' || kind === selectedType)
      .filter(kind => selectedModule === 'all' || definitions[kind].module === selectedModule
        || kind === 'registered' && selectedModule === 'management')
      .map(kind => ({ key: kind, ...definitions[kind], rows: filtered.filter(row => row.operationType === kind) }));
    const modules = [...new Set(types.map(kind => definitions[kind].module).concat('management'))];
    const selectableTypes = types.filter(kind => selectedModule === 'all' || definitions[kind].module === selectedModule
      || kind === 'registered' && selectedModule === 'management');
    const historyFloor = model.previousMonth(model.monthKey(now)) + '-01';
    const historyPartial = mode === 'activity' && (!from || from < historyFloor)
      && (categories.some(category => ['maintenanceDone', 'verificationDone', 'fiscal'].includes(category.key)))
      && !history;
    return { mode, period, from, to, categories, rows: filtered, total: filtered.length,
      missing, partial: missing.length > 0 || historyPartial || invalidPeriod, historyPartial, invalidPeriod,
      modules, types: selectableTypes, definitions };
  }
  return { build, definitions, periodBounds };
});
