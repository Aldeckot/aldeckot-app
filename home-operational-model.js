/* Projeção somente leitura da Home; identidades e saldos permanecem na origem. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotHomeModel = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const ZONE = 'America/Sao_Paulo';
  const RULES = Object.freeze({ maintenanceAttentionDays: 15, maintenanceHighDays: 30,
    staleMediumDays: 7, staleHighDays: 15, verificationMediumHours: 48, verificationHighHours: 72,
    integrationPendingMinutes: 30 });
  const STATUS = Object.freeze([
    { name: 'Ativo', color: '#00db9a' }, { name: 'Reserva', color: '#ffc34a' },
    { name: 'Manutenção', color: '#ff4f69' }, { name: 'Inativo', color: '#8a9cb8' },
    { name: 'Defeito', color: '#ff8c3a' }
  ]);
  const pages = { inventory: 'inventory.html', management: 'management.html', control: 'control.html',
    flux: 'flux.html', nfe: 'nfe.html', supplies: 'supplies.html' };
  const labels = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI',
    flux: 'Flux', nfe: 'Fiscal NF-e', supplies: 'Suprimentos', system: 'Sistema' };
  const norm = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const serial = value => {
    const key = norm(value);
    return key.length >= 4 && !['sem serie', 'sem numero', 'nao informado', 'n/a', 'none', 'null', '0000', '***'].includes(key) ? key : '';
  };
  const epoch = value => {
    if (!value) return null;
    const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00-03:00' : value);
    return Number.isFinite(at) ? at : null;
  };
  const dateKey = (value = new Date(), zone = ZONE) => {
    const at = typeof value === 'string' ? epoch(value) : Number(value);
    if (at == null || !Number.isFinite(at)) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = key => parts.find(part => part.type === key)?.value;
    return get('year') + '-' + get('month') + '-' + get('day');
  };
  const monthKey = (value, zone = ZONE) => dateKey(value, zone).slice(0, 7);
  const previousMonth = key => {
    const [year, month] = key.split('-').map(Number);
    return (month === 1 ? year - 1 : year) + '-' + String(month === 1 ? 12 : month - 1).padStart(2, '0');
  };
  const target = row => {
    if (!pages[row.module] || !row.id) return '';
    const params = new URLSearchParams({ item: row.id });
    if (row.tableId) params.set('table', row.tableId);
    return pages[row.module] + '?' + params;
  };
  const unique = (rows, key = row => row.id) => [...new Map(rows.filter(row => key(row)).map(row => [key(row), row])).values()];
  const recentFirst = (a, b) => (epoch(b.occurredAt || b.updatedAt) || 0) - (epoch(a.occurredAt || a.updatedAt) || 0)
    || String(a.key || a.id).localeCompare(String(b.key || b.id));
  const knownStatus = value => STATUS.find(status => norm(status.name) === norm(value))?.name || String(value || 'Não informado');
  const name = row => row.equipment || row.name || row.tag || 'Registro sem nome';
  const describe = row => [row.tag && 'TAG ' + row.tag, row.serial && 'Série ' + row.serial,
    row.terminal || row.location, labels[row.module]].filter(Boolean).join(' · ');
  const viewRow = row => ({ ...row, title: row.title || name(row), detail: row.detail || describe(row),
    key: row.key || row.module + ':' + row.id, targetUrl: row.identityConflict ? '' : row.targetUrl || target(row) });
  const isPC = row => row.module === 'management' || /computador|desktop|notebook|pc\b/.test(norm(row.equipmentType || row.tableName || row.equipment));

  function consolidate(inventory, management) {
    const warnings = [];
    const equipment = unique(inventory).map(row => ({ ...row, module: 'inventory', key: 'inventory:' + row.id, inventoryIdentity: row.id, origins: [{ ...row, module: 'inventory' }] }));
    const inventoryById = new Map(equipment.map(row => [row.id, row]));
    const pcGroups = new Map();
    for (const row of management.filter(row => String(row.equipment || '').trim())) {
      const id = row.computerId || row.id;
      if (!id) continue;
      if (pcGroups.has(id)) {
        Object.assign(pcGroups.get(id), { identityConflict:true,technical:true,status:'Não informado' });
        warnings.push({ kind: 'computer-occupancy', id, message: 'Uma identidade de computador aparece em mais de uma posição.' });
        continue;
      }
      pcGroups.set(id, { ...row, module: 'management' });
    }
    const pcs = [...pcGroups.values()];
    const groupSerials = list => {
      const groups = new Map();
      for (const row of list) { const key=serial(row.serial); if(key) groups.set(key,[...(groups.get(key) || []),row]); }
      return groups;
    };
    const inventorySerials=groupSerials(equipment), computerSerials=groupSerials(pcs);
    const used = new Set();
    for (const pc of pcs) {
      let candidate = pc.inventoryItemId ? inventoryById.get(pc.inventoryItemId) : null;
      if (!candidate) {
        const key = serial(pc.serial);
        if (key && computerSerials.get(key)?.length === 1 && inventorySerials.get(key)?.length === 1) {
          const match = inventorySerials.get(key)[0];
          if (match && isPC(match) && (!norm(match.tag) || !norm(pc.tag) || norm(match.tag) === norm(pc.tag))) candidate = match;
          else if (match) warnings.push({ kind: 'identity', id: pc.computerId || pc.id, message: 'Série em comum com dados incompatíveis; registros mantidos separados.' });
        }
      }
      if (candidate && !used.has(candidate.inventoryIdentity || candidate.id)) {
        const inventoryId = candidate.inventoryIdentity || candidate.id;
        used.add(inventoryId);
        candidate.origins.push(pc);
        Object.assign(candidate, pc, { key: 'inventory:' + inventoryId, origins: candidate.origins });
      } else {
        if (candidate) warnings.push({ kind: 'identity', id: pc.id, message: 'Mais de um computador aponta ao mesmo registro; vínculo não consolidado.' });
        equipment.push({ ...pc, key: 'management:' + (pc.computerId || pc.id), origins: [pc] });
      }
    }
    const tags = new Map();
    for (const row of equipment) {
      const tag = norm(row.tag);
      if (!tag) continue;
      if (tags.has(tag) && tags.get(tag) !== row.key) warnings.push({ kind: 'tag', id: row.key, message: 'TAG ' + row.tag + ' em identidades distintas; revisar correspondência.' });
      tags.set(tag, row.key);
    }
    return { equipment: equipment.map(row => viewRow({ ...row, status: knownStatus(row.status) })), warnings };
  }

  function build(source, now = new Date(), rules = RULES) {
    const snapshot = source || {};
    const health = snapshot.health || {};
    const has = (...keys) => keys.every(key => Array.isArray(snapshot[key]) && !health[key]?.unavailable);
    const stale = keys => keys.some(key => health[key]?.stale);
    const rows = key => Array.isArray(snapshot[key]) ? snapshot[key] : [];
    const sets = {};
    const availability = {};
    const put = (key, entries, deps) => {
      sets[key] = entries.map(viewRow);
      availability[key] = { available: has(...deps), stale: stale(deps), errors: deps.filter(dep => health[dep]?.error).map(dep => health[dep].error) };
    };
    const { equipment, warnings } = consolidate(rows('inventory'), rows('management'));
    put('equipment', equipment, ['inventory', 'management']);
    for (const state of STATUS) put('status:' + state.name, equipment.filter(row => row.status === state.name), ['inventory', 'management']);
    put('status:Outros', equipment.filter(row => !STATUS.some(state => state.name === row.status)), ['inventory', 'management']);
    const control = unique(rows('control')).map(row => viewRow({ ...row, module: 'control' }));
    const openTicket = row => ['em manutencao', 'manutencao', 'aguardando avaliacao', 'em sala'].includes(norm(row.status));
    put('maintenance', control.filter(row => row.followUpKind !== 'verification' && ['em manutencao', 'manutencao', 'aguardando avaliacao', 'em sala'].includes(norm(row.status))), ['control']);
    put('tickets', control.filter(openTicket), ['control']);
    const transfers = unique(rows('flux')).map(row => viewRow({ ...row, module: 'flux' }));
    put('transfers', transfers.filter(row => ['pendente', 'em transito', 'aguardando recebimento'].includes(norm(row.status))), ['flux']);
    const fiscal = unique(rows('nfe')).map(row => viewRow({ ...row, module: 'nfe',
      equipment: 'NF-e ' + (row.nfeNumber || 'sem número'), tag: row.pdv ? 'PDV ' + row.pdv : '',
      detail: (row.reason || 'Ocorrência fiscal') + ' · ' + (row.pdv || 'PDV não informado') }));
    const events = unique(rows('events'));
    const completionEvents = events.filter(event => ['manutencao concluida','verificacao concluida'].includes(norm(event.action)));
    const completed = completionEvents.map(event => {
      const ticket = control.find(row => row.id === (event.controlItemId || event.sourceId));
      return ticket ? { ...ticket, key: 'completion:' + event.id, occurredAt: event.createdAt, operation: event.action } : null;
    }).filter(Boolean);
    const eventTickets = new Set(completionEvents.map(event => event.controlItemId || event.sourceId));
    completed.push(...control.filter(row => norm(row.status) === 'manutencao concluida' && epoch(row.exitDate) != null && !eventTickets.has(row.id))
      .map(row => ({ ...row, key: 'control-completion:' + row.id, occurredAt: row.exitDate, operation: 'Manutenção concluída' })));
    const delivered = transfers.filter(row => ['recebido', 'entregue'].includes(norm(row.status)) && epoch(row.receivedDate) != null)
      .map(row => ({ ...row, key: 'flux-completion:' + row.id, occurredAt: row.receivedDate, operation: 'Transferência concluída' }));
    const currentMonth = monthKey(now);
    const priorMonth = previousMonth(currentMonth);
    const inMonth = (list, key, field) => list.filter(row => monthKey(row[field] || row.occurredAt) === key);
    put('fiscal', inMonth(fiscal, currentMonth, 'occurredAt'), ['nfe']);
    put('completed', [...completed, ...delivered].filter(row => monthKey(row.occurredAt) === currentMonth).sort(recentFirst), ['control', 'events', 'flux']);
    const metrics = [];
    for (const [key, label, list, deps, field] of [
      ['new', 'Novos equipamentos', equipment, ['inventory', 'management'], 'createdAt'],
      ['maintenance', 'Manutenções concluídas', completed.filter(row => row.operation === 'Manutenção concluída'), ['control', 'events'], 'occurredAt'],
      ['transfers', 'Transferências realizadas', delivered, ['flux'], 'occurredAt'],
      ['fiscal', 'Ocorrências fiscais', fiscal, ['nfe'], 'occurredAt']
    ]) {
      const current = inMonth(list, currentMonth, field);
      const previous = inMonth(list, priorMonth, field);
      put('monthly:' + key, current.map(row => ({ ...row,occurredAt:row[field] || row.occurredAt })).sort(recentFirst), deps);
      metrics.push({ key, label, value: current.length, previous: previous.length,
        change: previous.length ? (current.length - previous.length) / previous.length * 100 : null });
    }
    const undatedEquipment = equipment.filter(row => epoch(row.createdAt) == null);
    const undatedClosed = control.filter(row => ['manutencao concluida','verificacao concluida'].includes(norm(row.status))
      && epoch(row.exitDate) == null && !eventTickets.has(row.id));
    if (undatedEquipment.length) {
      availability['monthly:new'].partial = true;
      availability['monthly:new'].reason = undatedEquipment.length + ' equipamento(s) sem data de cadastro confiável. O indicador considera apenas datas confirmadas.';
      metrics.find(row => row.key === 'new').change = null;
      warnings.push({ kind:'creation-date',id:'monthly:new',message:availability['monthly:new'].reason });
    }
    if (undatedClosed.length) {
      for (const key of ['monthly:maintenance','completed']) {
        availability[key].partial = true;
        availability[key].reason = undatedClosed.length + ' acompanhamento(s) concluído(s) sem data de conclusão verificável. A contagem inclui apenas conclusões datadas.';
      }
      warnings.push({ kind:'completion-date',id:'monthly:maintenance',message:availability['monthly:maintenance'].reason });
    }
    const pending = new Map();
    const addAlert = alert => {
      const old = pending.get(alert.key);
      if (!old) { pending.set(alert.key, viewRow({ ...alert, reasons: alert.reasons || [] })); return; }
      old.reasons = [...(old.reasons || []), ...(alert.reasons || [])];
      if (alert.priority > old.priority) {
        old.priority = alert.priority;
        old.title = alert.title;
        old.occurredAt = alert.occurredAt || old.occurredAt;
      }
    };
    const linkedTickets = item => control.filter(ticket => openTicket(ticket) && item.origins.some(origin =>
      origin.module === 'inventory' ? origin.id === (ticket.inventoryItemId || ticket.verificationInventoryItemId) : origin.module === 'management'
        && (origin.computerId && origin.computerId === (ticket.managementComputerId || ticket.verificationComputerId) || (!ticket.managementComputerId && origin.id === ticket.managementRecordId
          && (serial(ticket.serial) || norm(ticket.tag))
          && (!serial(ticket.serial) || serial(ticket.serial) === serial(origin.serial))
          && (!norm(ticket.tag) || norm(ticket.tag) === norm(origin.tag))))));
    const startedAt = (item, condition) => {
      if (condition === 'Verificando') {
        const followup = linkedTickets(item).find(ticket => ticket.followUpKind === 'verification' && epoch(ticket.verificationStartedAt) != null);
        if (followup) return followup.verificationStartedAt;
      }
      const match = events.filter(event => (condition === 'Verificando' ? event.action === 'Verificação iniciada' : norm(event.newStatus) === norm(condition) && norm(event.previousStatus) !== norm(condition))
        && item.origins.some(origin => origin.module === 'inventory' ? origin.id === event.inventoryItemId
          : origin.computerId && [event.computerId, event.incomingComputerId, event.outgoingComputerId].includes(origin.computerId)))
        .sort((a, b) => (epoch(b.createdAt) || 0) - (epoch(a.createdAt) || 0))[0];
      if (match) return match.createdAt;
      if (condition === 'Manutenção') return linkedTickets(item).map(ticket => ticket.entryDate).filter(value => epoch(value) != null).sort()[0] || '';
      return condition === 'Verificando' ? item.verificationStartedAt || '' : '';
    };
    for (const item of equipment) {
      const related = linkedTickets(item);
      const base = { ...item, key: related[0]?.id ? 'case:control:' + related[0].id : 'case:' + item.key,
        targetUrl: related[0]?.targetUrl || item.targetUrl,
        relatedTicketId: related[0]?.id || '', priority: 1 };
      if (norm(item.status) === 'defeito') addAlert({ ...base, title: name(item) + ' — com defeito',
        priority: related.some(ticket => norm(ticket.priority) === 'alta') ? 3 : 2,
        occurredAt: startedAt(item, 'Defeito'), reasons: [{ code:'defect', text:'Status Defeito confirmado.', source:'Equipamento' }] });
      if (norm(item.status) === 'manutencao') {
        const at = startedAt(item, 'Manutenção');
        const age = epoch(at) == null ? null : Math.max(0, (Number(now) - epoch(at)) / 86400000);
        if (age == null || Math.floor(age) >= rules.maintenanceAttentionDays) addAlert({ ...base,
          title: name(item) + ' — ' + (age == null ? 'manutenção sem data inicial verificável' : 'em manutenção há ' + Math.floor(age) + ' dias'),
          priority: age == null ? 0 : Math.floor(age) >= rules.maintenanceHighDays ? 3 : 2, occurredAt: at,
          reasons: [{ code:'maintenance-age', text: age == null ? 'Início da manutenção não comprovado.'
            : Math.floor(age) + ' dias completos em manutenção (atenção: 15; alto: 30).', startedAt:at, elapsedDays:age == null ? null : Math.floor(age) }] });
      }
      if (norm(item.situation) === 'verificando') {
        const at = startedAt(item, 'Verificando');
        const hours = epoch(at) == null ? null : Math.max(0, (Number(now) - epoch(at)) / 3600000);
        addAlert({ ...base, title: name(item) + ' — em verificação',
          detail: describe(item) + ' · ' + (related.length ? 'Acompanhamento técnico vinculado' : 'Sem chamado técnico vinculado') + (hours == null ? ' · Início não informado' : ''),
          priority: hours == null ? 0 : hours >= rules.verificationHighHours ? 3 : hours >= rules.verificationMediumHours ? 2 : 1,
          occurredAt: at, reasons: [{ code:'verification', text: hours == null ? 'Início da verificação não comprovado.'
            : 'Verificação aberta há ' + Math.floor(hours) + ' hora(s).', startedAt:at }] });
      }
    }
    const logsByTicket = new Map();
    for (const log of rows('controlLogs')) {
      if (!log.controlItemId || epoch(log.createdAt) == null
        || !['update', 'registro tecnico', 'registro tecnico atualizado', 'manutencao iniciada', 'verificacao iniciada'].includes(norm(log.action))) continue;
      const previous = logsByTicket.get(log.controlItemId);
      if (!previous || epoch(log.createdAt) > epoch(previous.createdAt)) logsByTicket.set(log.controlItemId, log);
    }
    for (const ticket of control.filter(openTicket)) {
      const initial = ticket.followUpKind === 'verification' ? ticket.verificationStartedAt || ticket.entryDate : ticket.entryDate;
      const latest = logsByTicket.get(ticket.id)?.createdAt;
      const technicalAt = [initial, latest].filter(value => epoch(value) != null).sort((a,b) => epoch(b)-epoch(a))[0] || '';
      const days = technicalAt ? Math.max(0, Math.floor((Number(now) - epoch(technicalAt)) / 86400000)) : null;
      if (days == null || days >= rules.staleMediumDays) addAlert({
        ...ticket, module:'control', key:'case:control:' + ticket.id, relatedTicketId:ticket.id,
        title:name(ticket) + (days == null ? ' — atualização técnica sem data confiável' : ' — sem atualização técnica há ' + days + ' dias'),
        priority:days == null ? 0 : days >= rules.staleHighDays ? 3 : 2, occurredAt:technicalAt,
        reasons:[{ code:'stale-followup', text:days == null ? 'Não há data técnica verificável para o acompanhamento.'
          : days + ' dias completos desde a última atualização técnica (atenção: 7; alto: 15).',
          startedAt:technicalAt, elapsedDays:days }]
      });
    }
    for (const alert of rows('nfeRecurring')) {
      if (!alert.id || !alert.pdv) continue;
      addAlert({ id: alert.id, module: 'nfe', key: 'nfe:recurring:' + alert.id,
        title: 'PDV ' + alert.pdv + ' — recorrência de ocorrências fiscais',
        detail: String(alert.occurrences || 0) + ' ocorrências na semana', priority: 3,
        occurredAt: alert.latestAt, targetUrl: 'nfe.html?pdv=' + encodeURIComponent(alert.pdv) });
    }
    for (const stock of rows('stock')) addAlert({ ...stock, key: 'supply:' + stock.itemId + ':' + stock.variantId,
      module: 'supplies', id: stock.itemId, title: stock.itemName + ' — estoque abaixo do mínimo',
      detail: stock.name + ' · Disponível: ' + stock.stock + ' · Mínimo: ' + stock.minimum, priority: stock.stock === 0 ? 3 : 2,
      targetUrl: 'supplies.html?' + new URLSearchParams({ item: stock.itemId, variant: stock.variantId }) });
    for (const failure of rows('effects').filter(row => row.status === 'failed' || (row.status === 'pending'
      && epoch(row.createdAt) != null && Number(now) - epoch(row.createdAt) > rules.integrationPendingMinutes * 60000))) {
      addAlert({ ...failure, key: 'effect:' + failure.id, title: failure.status === 'failed' ? 'Falha de integração registrada' : 'Integração aguardando processamento',
        detail: (labels[failure.module] || failure.module) + ' · Evento ' + failure.eventId,
        priority: failure.status === 'failed' ? 3 : 2, occurredAt: failure.createdAt, technical: true, targetUrl: '' });
    }
    const warningTitles = { 'computer-occupancy': 'Computador em mais de uma posição', identity: 'Vínculo de identidade requer conferência',
      tag: 'TAG em identidades distintas', 'creation-date': 'Cadastro sem data confiável', 'completion-date': 'Conclusão sem data confiável' };
    for (const warning of warnings) addAlert({ key: 'quality:' + warning.kind + ':' + warning.id, id: warning.id,
      module: 'system', title: warningTitles[warning.kind] || 'Conferência de dados necessária',
      detail: warning.message + ' · Referência: ' + warning.id, errorMessage: warning.message,
      status: 'Pendente de conferência', priority: 0, technical: true, targetUrl: '',
      reasons:[{ code:'data-quality', text:warning.message }] });
    const alerts = [...pending.values()].sort((a, b) => b.priority - a.priority
      || (epoch(a.occurredAt) ?? Infinity) - (epoch(b.occurredAt) ?? Infinity) || a.key.localeCompare(b.key));
    put('alerts', alerts, ['inventory', 'management', 'control', 'controlLogs', 'events', 'stock', 'effects']);
    const activities = rows('effects').filter(row => ['applied', 'failed'].includes(row.status) && epoch(row.processedAt) != null)
      .map(row => viewRow({ ...row, key: 'effect:' + row.id, title: 'Integração ' + (labels[row.module] || row.module) + (row.status === 'applied' ? ' concluída' : ' com falha'),
        detail: 'Evento ' + row.eventId, occurredAt: row.processedAt, technical: true, targetUrl: '' }));
    for (const backup of rows('backups')) {
      if (backup.source !== 'automatic') continue;
      activities.push(viewRow({ ...backup, key: 'backup:' + backup.module + ':' + backup.id, title: 'Backup automático concluído',
        detail: (labels[backup.module] || backup.module) + ' · ' + (backup.label || 'Backup persistido'), occurredAt: backup.createdAt, technical: true, targetUrl: '' }));
    }
    put('activities', unique(activities, row => row.key).sort(recentFirst), ['effects', 'backups']);
    put('recent', [...equipment, ...control, ...transfers, ...fiscal].filter(row => epoch(row.updatedAt) != null).sort(recentFirst), ['inventory', 'management', 'control', 'flux', 'nfe']);
    return { sets, availability, metrics, warnings, status: STATUS, month: currentMonth, priorMonth,
      loadedAt: snapshot.loadedAt || '', rules, health, labels };
  }
  return { build, consolidate, RULES, STATUS, ZONE, labels, norm, epoch, dateKey, monthKey, previousMonth, target, viewRow };
});
