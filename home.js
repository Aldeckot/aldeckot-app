(() => {
  const model = window.AldeckotHomeModel;
  const queries = window.AldeckotHomeQueries;
  const operationsModel = window.AldeckotOperationsModel;
  const releaseHomeRender = window.AldeckotHomeStage?.hold?.('home-dashboard');
  let finishData;
  window.AldeckotHomeDataReady = new Promise(resolve => { finishData = resolve; });
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const svg = paths => '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
  const icons = {
    summary: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h6"/>'),
    operations: svg('<path d="M4 21V11h4v10M10 21V4h4v17M16 21v-7h4v7M2 21h20"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'),
    activity: svg('<path d="M5 4h14v17H5zM8 4V2m8 2V2M8 9h8M8 13h8M8 17h5"/>'),
    calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M7 14h2m6 0h2M7 17h2"/>'),
    computer: svg('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>'),
    tool: svg('<path d="m14 4 3 3 4-2a6 6 0 0 1-8 8l-7 7a2 2 0 0 1-3-3l7-7a6 6 0 0 1 4-8z"/>'),
    ticket: svg('<path d="M4 5h16v12H9l-5 4V5zM8 9h8m-8 4h5"/>'),
    transfer: svg('<path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5"/>'),
    check: svg('<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>'),
    alert: svg('<path d="m12 3 10 18H2L12 3zM12 9v5m0 3h.01"/>'),
    investigation: svg('<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>'),
    low: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'),
    medium: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v7m0 3h.01"/>'),
    fiscal: svg('<path d="M6 3h8l4 4v14H6V3zM14 3v5h5M9 12h6m-6 4h6"/>'),
    stock: svg('<path d="m3 7 9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10"/>'),
    printer: svg('<path d="M7 8V3h10v5M7 16H3V8h18v8h-4M7 13h10v8H7zM17 10h1"/>'),
    network: svg('<path d="M9 3h6v5H9zM2 17h6v5H2zM16 17h6v5h-6zM12 8v5M5 17v-4h14v4"/>'),
    scanner: svg('<path d="M3 4h18v16H3zM6 7v7m3-7v7m3-7v7m3-7v7m3-7v7M6 17h12"/>'),
    pinpad: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 5h6v4H9zM9 13h1m3 0h2m-6 4h1m3 0h2"/>'),
    scale: svg('<path d="M4 9h16v12H4zM12 3v6M6 3h12M8 12h8v4H8z"/>')
  };
  const iconFor = row => {
    const text = model.norm(row.equipment || row.title || '');
    return icons[row.icon] || (/impress/.test(text) ? icons.printer : /switch|rede/.test(text) ? icons.network
      : /leitor|scanner/.test(text) ? icons.scanner : /pin pad/.test(text) ? icons.pinpad
      : /balanc/.test(text) ? icons.scale : row.module === 'nfe' ? icons.fiscal
      : row.module === 'supplies' ? icons.stock : row.module === 'control' ? icons.tool : row.module === 'flux' ? icons.transfer : icons.computer);
  };
  const navigateTo = target => {
    if (!target) return;
    try {
      const url = new URL(target, window.location.href);
      if (url.origin !== window.location.origin || !/\/(inventory|management|control|flux|nfe|supplies|settings)\.html$/.test(url.pathname)) return;
      if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate(url.pathname.split('/').pop() + url.search + url.hash);
      else window.location.href = url.href;
    } catch { /* Destino inválido permanece visível para revisão. */ }
  };
  window.go = module => navigateTo(({ inventory: 'inventory.html', management: 'management.html', control: 'control.html',
    flux: 'flux.html', nfe: 'nfe.html', supplies: 'supplies.html' })[module]);
  const moduleCards = [
    { id: 'inventory', title: 'Inventário', description: 'Controle de equipamentos, patrimônio e localização.', tags: ['Patrimônio', 'Localização', 'Status'] },
    { id: 'management', title: 'Gestão TI', description: 'Computadores, posições físicas e periféricos.', tags: ['Computadores', 'PDVs', 'Histórico'] },
    { id: 'control', title: 'Controle TI', description: 'Central de manutenção e gestão de chamados.', tags: ['Manutenção', 'Chamados', 'Histórico'] },
    { id: 'flux', title: 'Flux', description: 'Envio e recebimento de equipamentos.', tags: ['Transferência', 'Recebimento', 'Histórico'] },
    { id: 'nfe', title: 'Fiscal NF-e', description: 'Registro e consulta de ocorrências fiscais.', tags: ['NF-e', 'Cupom fiscal', 'Auditoria'] },
    { id: 'supplies', title: 'Suprimentos', description: 'Estoque rastreável de materiais e componentes de TI.', tags: ['Estoque', 'Componentes', 'Manutenção'] }
  ];
  const nav = document.getElementById('nav');
  if (nav) {
    nav.innerHTML = moduleCards.map(card => '<button class="module-nav-card module-' + card.id + '" type="button" data-module-card="' + card.id + '">'
      + '<span class="module-card-copy"><b>' + card.title + '</b><small>' + card.description + '</small><span class="module-card-tags">'
      + card.tags.map(tag => '<i>' + tag + '</i>').join('') + '</span></span><span class="module-card-art" aria-hidden="true"></span><span class="module-card-arrow" aria-hidden="true">›</span></button>').join('');
    nav.addEventListener('click', event => { const card = event.target.closest('[data-module-card]'); if (card) window.go(card.dataset.moduleCard); });
  }
  const root = document.querySelector('.home-reference');
  if (!root || !model || !queries) { releaseHomeRender?.(); return; }
  document.body.classList.add('home-operational');
  const heading = (title, icon, action, text = 'Ver todos') => '<header class="home-panel-head"><h2>' + icons[icon] + title + '</h2>'
    + (action ? '<button class="home-small-button" type="button" data-home-set="' + action + '">' + text + '</button>' : '') + '</header>';
  root.innerHTML = '<div class="home-center"><div class="home-hero" aria-hidden="true"></div>'
    + '<div class="home-center-metrics"><section class="home-global home-panel" aria-label="Resumo Global">' + heading('Resumo Global', 'summary', 'equipment', 'Ver detalhes')
    + '<div data-home-summary><p class="home-state aldeckot-inline-loading" role="status">Carregando equipamentos…</p></div></section>'
    + '<section class="home-operations home-panel" aria-label="Central de Operações"><header class="home-panel-head"><h2>' + icons.operations + 'Central de Operações</h2>'
    + '<div class="home-operations-actions"><button class="home-small-button" data-home-operation-clear type="button">Limpar</button>'
    + '<button class="home-small-button home-refresh" data-home-refresh type="button" aria-label="Atualizar indicadores">↻ Atualizar</button></div></header>'
    + '<div data-home-operations class="home-operations-analytic"></div></section></div>'
    + '</div>'
    + '<aside class="home-side"><section class="home-calendar home-panel" aria-label="Calendário"></section>'
    + '<section class="agenda-upcoming-panel home-panel" aria-label="Próximos agendamentos"></section>'
    + '<section class="home-recent-panel home-panel" data-home-recent-items aria-label="Últimos itens atualizados">' + heading('Últimos itens atualizados', 'clock', '')
    + '<div data-home-recent-list></div></section>'
    + '<section class="home-alert-panel home-panel" aria-label="Alertas críticos">' + heading('Alertas críticos', 'alert', 'alerts') + '<div data-home-alerts></div></section>'
    + '</aside>';
  let current = model.build({});
  let source = {};
  const defaultOperationsFilters = { mode: 'open', module: 'all', type: 'all', period: 'all', from: '', to: '' };
  let operationsFilters;
  try { operationsFilters = { ...defaultOperationsFilters, ...JSON.parse(sessionStorage.getItem('aldeckot-home-operations-filters') || '{}') }; }
  catch { operationsFilters = { ...defaultOperationsFilters }; }
  let operations = operationsModel?.build(source, operationsFilters);
  let operationHistoryRequest = null;
  async function loadOperationsHistory() {
    if (!queries.operationsPeriod || operationsFilters.mode !== 'activity' || operationsFilters.period !== 'custom' || operations?.invalidPeriod) return;
    const { from, to } = operationsModel.periodBounds('custom', new Date(), operationsFilters.from, operationsFilters.to);
    const floor = model.previousMonth(model.monthKey(new Date())) + '-01';
    if (!from || !to || from >= floor || source.operationsHistory?.from === from && source.operationsHistory?.to === to) return;
    const key = from + ':' + to;
    if (operationHistoryRequest?.key === key) return operationHistoryRequest.promise;
    const requestedSource = source;
    const promise = queries.operationsPeriod(from, to).then(history => {
      if (source !== requestedSource) return;
      requestedSource.operationsHistory = history;
      requestedSource.operationsHistoryError = '';
      renderOperations();
    }).catch(error => {
      if (source !== requestedSource) return;
      requestedSource.operationsHistoryError = error.message || 'Histórico indisponível.';
      renderOperations();
    }).finally(() => { if (operationHistoryRequest?.key === key) operationHistoryRequest = null; });
    operationHistoryRequest = { key, promise };
    return promise;
  }
  let loading = false;
  let refreshAgain = false;
  let refreshTimer;
  let dialog;
  let focusBeforeDialog;
  const recordMap = new Map();
  const statusClass = value => model.norm(value).replace(/^em manutencao$/, 'manutencao').replace(/\s+/g, '-');
  const at = value => model.epoch(value) == null ? 'Data não informada' : new Intl.DateTimeFormat('pt-BR',
    { timeZone: model.ZONE, dateStyle: 'short', ...(/^\d{4}-\d{2}-\d{2}$/.test(value) ? {} : { timeStyle: 'short' }) }).format(model.epoch(value));
  const relative = value => {
    const stamp = model.epoch(value);
    if (stamp == null) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - stamp) / 60000));
    return minutes < 1 ? 'agora' : minutes < 60 ? 'há ' + minutes + ' min'
      : minutes < 1440 ? 'há ' + Math.floor(minutes / 60) + ' h' : 'há ' + Math.floor(minutes / 1440) + ' dias';
  };
  const patch = (selector, html) => {
    const node = root.querySelector(selector);
    if (node && node.innerHTML !== html) node.innerHTML = html;
  };
  const stateNote = key => {
    const state = current.availability[key];
    const partial = state?.partial ? '<p class="home-source-note" role="status">' + escape(state.reason) + '</p>' : '';
    return partial + (!state?.available ? '<p class="home-source-note" role="status">Consulta incompleta. Use Atualizar para tentar novamente.</p>'
      : state.stale ? '<p class="home-source-note" role="status">Dados da última consulta válida; atualização não confirmada.</p>' : '');
  };
  const count = key => current.availability[key]?.available ? current.sets[key].length + (current.availability[key]?.partial ? '†' : '') : '—';
  const listRow = (row, mode = 'recent') => {
    recordMap.set(row.key, row);
    const stamp = row.occurredAt || row.updatedAt;
    const tag = mode === 'alerts' ? ['Investigação', 'Baixa', 'Média', 'Alta'][row.priority ?? 0]
      : row.status || model.labels[row.module] || 'Sistema';
    return '<button class="home-data-row ' + (mode === 'alerts' ? 'home-alert-row priority-' + row.priority : '') + '" type="button" data-home-record="' + escape(row.key)
      + '"><span class="home-row-icon">' + (mode === 'alerts' ? [icons.investigation,icons.low,icons.medium,icons.alert][row.priority ?? 0] : iconFor(row)) + '</span><span class="home-row-copy"><b>' + escape(row.title)
      + '</b><small>' + escape(row.detail) + '</small></span><span class="home-row-date"><time title="' + escape(at(stamp)) + '">' + escape(relative(stamp) || 'Sem data') + '</time>'
      + '<small>' + escape(model.dateKey(stamp) || '') + '</small></span><span class="home-label status-' + statusClass(tag) + '">' + escape(tag) + '</span><span class="home-row-chevron" aria-hidden="true">›</span></button>';
  };
  function renderSummary() {
    const available = current.availability.equipment?.available;
    const total = current.sets.equipment.length;
    const groups = [...current.status];
    if (current.sets['status:Outros'].length) groups.push({ name: 'Outros', color: '#a08dec' });
    let cursor = 0;
    const slices = groups.map(group => {
      const size = total ? current.sets['status:' + group.name].length / total * 100 : 0;
      const start = cursor; cursor += size; return group.color + ' ' + start + '% ' + cursor + '%';
    });
    const gradient = available && total ? 'conic-gradient(' + slices.join(',') + ')' : 'conic-gradient(#244362 0% 100%)';
    patch('[data-home-summary]', '<div class="home-summary-body"><button class="home-donut" type="button" data-home-set="equipment" style="--home-donut:' + gradient + '" aria-label="Consultar todos os equipamentos"><span><strong>'
      + (available ? total : '—') + '</strong><small>Equipamentos</small></span></button><div class="home-summary-legend">'
      + groups.map(group => '<button type="button" data-home-set="status:' + group.name + '" style="--status-color:' + group.color + '"><i></i><span>' + group.name + '</span><b>'
        + (available ? current.sets['status:' + group.name].length : '—') + '</b><small>' + (available ? (total ? Math.round(current.sets['status:' + group.name].length / total * 100) : 0) + '%' : '—') + '</small></button>').join('')
      + '</div></div>' + stateNote('equipment'));
  }
  function renderOperations() {
    if (!operationsModel) return;
    operations = operationsModel.build(source, operationsFilters);
    const available = Boolean(source.loadedAt);
    const moduleLabels = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', flux: 'Flux', nfe: 'Fiscal NF-e' };
    const selected = (value, expected) => value === expected ? ' selected' : '';
    const modes = '<select data-home-operation-filter="mode" aria-label="Modo da Central de Operações">'
      + '<option value="open"' + selected(operations.mode, 'open') + '>Em andamento</option>'
      + '<option value="activity"' + selected(operations.mode, 'activity') + '>Atividades no período</option></select>';
    const modules = '<select data-home-operation-filter="module" aria-label="Filtrar por módulo"><option value="all">Todos os módulos</option>'
      + operations.modules.map(module => '<option value="' + module + '"' + selected(operationsFilters.module, module) + '>' + moduleLabels[module] + '</option>').join('') + '</select>';
    const types = '<select data-home-operation-filter="type" aria-label="Filtrar por tipo"><option value="all">Todas as operações</option>'
      + operations.types.map(type => '<option value="' + type + '"' + selected(operationsFilters.type, type) + '>' + escape(operations.definitions[type].label) + '</option>').join('') + '</select>';
    const periods = [['all', operations.mode === 'open' ? 'Todas as aberturas' : 'Histórico disponível'], ['month', 'Este mês'], ['last30', 'Últimos 30 dias'], ['custom', 'Intervalo']]
      .map(([value, label]) => '<option value="' + value + '"' + selected(operations.period, value) + '>' + label + '</option>').join('');
    const period = '<select data-home-operation-filter="period" aria-label="Filtrar por período">' + periods + '</select>';
    let offset = 0;
    const circles = operations.total ? operations.categories.filter(group => group.rows.length).map(group => {
      const length = group.rows.length / operations.total * 100;
      const html = '<circle tabindex="0" role="button" aria-label="' + escape(group.label + ': ' + group.rows.length)
        + '" data-home-set="operation:' + group.key + '" cx="50" cy="50" r="40" pathLength="100" fill="none" stroke="' + group.color
        + '" stroke-width="12" stroke-dasharray="' + length + ' ' + (100 - length) + '" stroke-dashoffset="' + (-offset)
        + '" transform="rotate(-90 50 50)"></circle>';
      offset += length;
      return html;
    }).join('') : '';
    const donut = '<div class="home-operations-donut"><svg viewBox="0 0 100 100" aria-label="Distribuição das operações">'
      + '<circle cx="50" cy="50" r="40" fill="none" stroke="#3e647c66" stroke-width="12"></circle>' + circles + '</svg>'
      + '<button type="button" data-home-set="operations" aria-label="Ver todas as operações filtradas"><strong>'
      + (operations.invalidPeriod || available && operations.missing.length === operations.categories.reduce((all,group) => all.concat(group.deps), []).filter((value,index,array)=>array.indexOf(value)===index).length && !operations.total ? '—' : operations.total)
      + (operations.partial ? '†' : '') + '</strong><small>operações</small></button></div>';
    const legend = '<div class="home-operations-legend">' + operations.categories.map(group =>
      '<button type="button" data-home-set="operation:' + group.key + '" style="--operation-color:' + group.color
      + '"><i></i><span>' + escape(group.label) + '</span><b>' + (available ? group.rows.length : '—') + '</b></button>').join('')
      + '</div>';
    const note = !available ? 'Carregando dados operacionais…'
      : operations.invalidPeriod ? 'Informe a data inicial e final de um intervalo válido.'
      : operations.missing.length ? 'Cobertura parcial: ' + operations.missing.join(', ') + ' indisponível(is).'
      : operations.historyPartial ? (source.operationsHistoryError || 'Histórico anterior ao mês passado não está integralmente carregado.') : '';
    const html = '<div class="home-operations-filters">' + modes + modules + types + period
      + (operations.period === 'custom' ? '<input type="date" data-home-operation-filter="from" aria-label="Data inicial" value="' + escape(operationsFilters.from || '') + '">'
        + '<input type="date" data-home-operation-filter="to" aria-label="Data final" value="' + escape(operationsFilters.to || '') + '">' : '')
      + '</div>'
      + '<div class="home-operations-chart">' + donut + legend + '</div>'
      + (note ? '<p class="home-operation-note" role="status">' + escape(note) + '</p>' : '')
      + (operations.mode === 'open' && operations.period !== 'all' ? '<p class="home-operation-note">Período aplicado à data de abertura. Pendências antigas podem estar fora do filtro.</p>' : '');
    patch('[data-home-operations]', html);
    current.sets.operations = operations.rows;
    current.availability.operations = { available, partial: operations.partial, reason: note };
    for (const group of operations.categories) {
      current.sets['operation:' + group.key] = group.rows;
      current.availability['operation:' + group.key] = { available, partial: operations.partial, reason: note };
    }
  }
  function render() {
    recordMap.clear();
    renderSummary();
    renderOperations();
    patch('[data-home-recent-list]', stateNote('recent') + (current.sets.recent.length
      ? current.sets.recent.slice(0, 3).map(row => listRow(row)).join('') : '<p class="home-state">Nenhum registro atualizado disponível.</p>'));
    patch('[data-home-alerts]', stateNote('alerts') + (current.sets.alerts.length ? current.sets.alerts.slice(0, 3).map(row => listRow(row, 'alerts')).join('')
      : '<p class="home-state">' + (current.availability.alerts?.available ? 'Nenhum alerta ativo nas fontes consultadas.' : 'Alertas aguardando consulta completa.') + '</p>'));
    patch('[data-home-monthly]', current.metrics.map(metric => {
      const key = 'monthly:' + metric.key;
      return '<button class="home-month-indicator" type="button" data-home-set="' + key + '">' + icons[({ new: 'computer', maintenance: 'check', transfers: 'transfer', fiscal: 'fiscal' })[metric.key]]
        + '<strong>' + count(key) + '</strong><small>' + metric.label + '</small><em class="' + (metric.change < 0 ? 'down' : '') + '">'
        + (!current.availability[key]?.available ? 'Indisponível' : current.availability[key]?.stale ? 'Desatualizado' : current.availability[key]?.partial ? 'Datas incompletas' : metric.change == null ? 'Sem base' : (metric.change >= 0 ? '↑ ' : '↓ ') + Math.abs(metric.change).toFixed(0) + '%') + '</em></button>';
    }).join(''));
    window.AldeckotOperationalAlerts = current.sets.alerts.map(row => ({ ...row, id: row.key,
      level: ['Investigação', 'Baixa', 'Média', 'Alta'][row.priority ?? 0], urgent: row.priority === 3,
      description: [row.detail, ...(row.reasons || []).map(reason => reason.text)].filter(Boolean).join(' · ') }));
    window.dispatchEvent(new CustomEvent('aldeckot:operational-alerts', { detail: { alerts: window.AldeckotOperationalAlerts } }));
    window.dispatchEvent(new CustomEvent('aldeckot:home-operational-ready'));
  }
  function closeDialog() {
    dialog?.remove(); dialog = null;
    focusBeforeDialog?.focus?.();
  }
  function makeDialog(title, text) {
    closeDialog();
    focusBeforeDialog = document.activeElement;
    dialog = document.createElement('div');
    dialog.className = 'home-browser-modal';
    dialog.innerHTML = '<section class="home-browser-dialog" role="dialog" aria-modal="true" aria-labelledby="home-browser-title"><header><div><h2 id="home-browser-title">'
      + escape(title) + '</h2><p>' + escape(text || '') + '</p></div><button type="button" class="home-small-button" data-home-dialog-close aria-label="Fechar">×</button></header><div data-home-dialog-body></div></section>';
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog || event.target.closest('[data-home-dialog-close]')) closeDialog();
      const destination = event.target.closest('[data-home-navigate]')?.dataset.homeNavigate;
      if (destination) { closeDialog(); navigateTo(destination); return; }
      const key = event.target.closest('[data-home-record]')?.dataset.homeRecord;
      if (key) openRecord(recordMap.get(key) || Object.values(current.sets).flat().find(row => row.key === key));
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeDialog();
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]),input,a[href]')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    dialog.querySelector('[data-home-dialog-close]').focus();
    return dialog.querySelector('[data-home-dialog-body]');
  }
  function openRecord(row) {
    if (!row) return;
    if (row.identityConflict) {
      const body=makeDialog('Vínculo de identidade ambíguo',row.detail);
      body.innerHTML='<p class="home-state">Este computador aparece em mais de uma posição. Confira os vínculos antes de abrir uma posição como destino.</p>'; return;
    }
    if (row.targetUrl && !row.technical && !Array.isArray(row.reasons)) { navigateTo(row.targetUrl); return; }
    const body = makeDialog(row.title, row.detail);
    if (Array.isArray(row.reasons)) {
      const level = ['Investigação', 'Baixo', 'Médio', 'Alto/Crítico'][row.priority ?? 0];
      body.innerHTML = '<p class="home-alert-level priority-' + (row.priority ?? 0) + '">' + level + '</p>'
        + '<dl class="home-technical-details"><div><dt>Origem</dt><dd>' + escape(model.labels[row.module] || row.module) + '</dd></div>'
        + '<div><dt>Identidade</dt><dd>' + escape([row.equipment || row.title, row.tag && 'TAG ' + row.tag, row.serial && 'Série ' + row.serial].filter(Boolean).join(' · ')) + '</dd></div>'
        + row.reasons.map(reason => '<div><dt>Motivo · ' + escape(reason.code || 'Acompanhamento') + '</dt><dd>' + escape(reason.text)
          + (reason.startedAt ? '<br>Referência: ' + escape(at(reason.startedAt)) : '') + '</dd></div>').join('')
        + '</dl>' + (row.targetUrl ? '<button type="button" class="home-small-button" data-home-navigate="' + escape(row.targetUrl) + '">Abrir registro original</button>'
          : '<p class="home-state">Registro de origem sem destino direto seguro; consulte o módulo indicado.</p>');
      return;
    }
    const details = { 'Evento': row.eventId || row.id, 'Origem': model.labels[row.module] || row.module,
      'Resultado': row.status || 'Backup persistido', 'Data': at(row.occurredAt || row.createdAt),
      'Detalhe': row.errorMessage || row.label || 'Execução confirmada pelo registro persistido.' };
    body.innerHTML = '<dl class="home-technical-details">' + Object.entries(details).map(([label, value]) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value || '—') + '</dd></div>').join('') + '</dl>';
  }
  function openSet(key) {
    if (key === 'month') {
      const body = makeDialog('Indicadores do mês', current.month + ' · comparação com ' + current.priorMonth);
      body.innerHTML = current.metrics.map(metric => '<button class="home-browser-result" type="button" data-month-key="monthly:' + metric.key + '"><b>'
        + escape(metric.label) + '</b><span>' + count('monthly:' + metric.key) + ' no mês · ' + metric.previous + ' no mês anterior</span></button>').join('');
      body.querySelectorAll('[data-month-key]').forEach(button => button.addEventListener('click', () => openSet(button.dataset.monthKey)));
      return;
    }
    const title = key.startsWith('status:') ? 'Equipamentos · ' + key.slice(7) : ({
      equipment: 'Resumo Global', operations: 'Central de Operações', recent: 'Últimos itens atualizados', alerts: 'Alertas críticos',
      activities: 'Últimas atividades do sistema', maintenance: 'Manutenções abertas', tickets: 'Chamados em andamento',
      transfers: 'Transferências em curso', fiscal: 'Ocorrências fiscais do mês', completed: 'Operações concluídas no mês'
    })[key] || (key.startsWith('operation:') ? operations.definitions[key.slice(10)]?.label : '')
      || current.metrics.find(row => 'monthly:' + row.key === key)?.label || 'Registros';
    const entries = current.sets[key] || [];
    const context = key === 'operations' || key.startsWith('operation:')
      ? (operations.mode === 'open' ? 'Processos em andamento' : 'Atividades no período') + ' · '
        + (operationsFilters.module === 'all' ? 'Todos os módulos' : model.labels[operationsFilters.module]) + ' · '
        + (operations.from || 'sem início') + ' a ' + (operations.to || 'sem fim') + ' · ' : '';
    const body = makeDialog(title, context + entries.length + ' registro(s) disponíveis');
    const alertFilters = key === 'alerts' ? '<div class="home-alert-filters"><label>Gravidade<select data-home-alert-severity><option value="all">Todas</option>'
      + ['Investigação','Baixa','Média','Alta'].map((label, index) => '<option value="' + index + '">' + label + '</option>').join('') + '</select></label>'
      + '<label>Origem<select data-home-alert-module><option value="all">Todos os módulos</option>'
      + [...new Set(entries.map(row => row.module))].map(module => '<option value="' + escape(module) + '">' + escape(model.labels[module] || module) + '</option>').join('')
      + '</select></label></div>' : '';
    body.innerHTML = stateNote(key) + alertFilters + '<label class="home-browser-search">Filtrar resultados<input type="search" placeholder="Nome, TAG, série, situação ou módulo" data-home-filter></label><div data-home-browser-results></div><footer class="home-browser-pagination"><button type="button" class="home-small-button" data-home-page="prev">Anterior</button><span data-home-page-label role="status" aria-live="polite"></span><button type="button" class="home-small-button" data-home-page="next">Próxima</button></footer>';
    let page = 0;
    const input = body.querySelector('[data-home-filter]');
    const update = () => {
      const severity = body.querySelector('[data-home-alert-severity]')?.value || 'all';
      const module = body.querySelector('[data-home-alert-module]')?.value || 'all';
      const list = entries.filter(row => (severity === 'all' || String(row.priority ?? 0) === severity)
        && (module === 'all' || row.module === module)
        && model.norm([row.title, row.detail, row.status, row.module, ...(row.reasons || []).map(reason => reason.text)].join(' ')).includes(model.norm(input.value)));
      page = Math.max(0, Math.min(page, Math.ceil(list.length / 25) - 1));
      body.querySelector('[data-home-browser-results]').innerHTML = list.length ? list.slice(page * 25, page * 25 + 25).map(row => listRow(row, key === 'alerts' ? 'alerts' : 'recent')).join('')
        : '<p class="home-state">' + (current.availability[key]?.available ? 'Nenhum registro encontrado.' : 'Não há resultados confirmados para esta consulta.') + '</p>';
      body.querySelector('[data-home-page-label]').textContent = (page + 1) + ' / ' + Math.max(1, Math.ceil(list.length / 25)) + ' · ' + list.length + ' resultados';
      body.querySelector('[data-home-page="prev"]').disabled = page === 0;
      body.querySelector('[data-home-page="next"]').disabled = (page + 1) * 25 >= list.length;
    };
    input.addEventListener('input', () => { page = 0; update(); });
    body.querySelectorAll('[data-home-alert-severity],[data-home-alert-module]').forEach(control => control.addEventListener('change', () => { page = 0; update(); }));
    body.querySelectorAll('[data-home-page]').forEach(button => button.addEventListener('click', () => { page += button.dataset.homePage === 'prev' ? -1 : 1; update(); }));
    update();
  }
  async function refresh(selected) {
    if (loading) { refreshAgain = true; return; }
    loading = true;
    const button = root.querySelector('[data-home-refresh]');
    button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Atualizando…';
    try {
      await (window.AldeckotAuthReady || Promise.resolve());
      if (!window.AldeckotAuth?.session) return;
      const hadData = Boolean(source.loadedAt);
      source = await queries.load(selected);
      if (hadData) calendarMonths.clear();
      current = model.build(source);
      render();
      void loadOperationsHistory();
      // Contrato de leitura mantido para os componentes compartilhados da Home.
      const tableSets = module => ({ tables: [...new Set((source[module] || []).map(row => row.tableId))].map(id => ({
        id, name: (source[module] || []).find(row => row.tableId === id)?.tableName || '',
        items: (source[module] || []).filter(row => row.tableId === id)
      })) });
      window.AldeckotHomeData = { inventory: tableSets('inventory'), management: { items: source.management || [] },
        control: tableSets('control'), flux: tableSets('flux'), nfeAlerts: [] };
      finishData(window.AldeckotHomeData);
      window.dispatchEvent(new CustomEvent('aldeckot:home-data', { detail: window.AldeckotHomeData }));
    } finally {
      loading = false; button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = '↻ Atualizar';
      releaseHomeRender?.();
      if (refreshAgain) { refreshAgain = false; window.setTimeout(() => refresh(), 200); }
    }
  }
  const calendarMonths = new Map();
  async function ensureCalendarMonth(month) {
    if (calendarMonths.has(month)) return;
    const entry = { loading:true,data:null };
    calendarMonths.set(month,entry);
    try {
      await window.AldeckotHomeDataReady;
      let data;
      if (queries.calendarMonth) data = await queries.calendarMonth(month);
      else {
        const control = (source.control || []).filter(row => String(row.entryDate || '').startsWith(month));
        data = { maintenance:control.filter(row=>row.followUpKind!=='verification'),
          technical:control.filter(row=>row.followUpKind==='verification'),
          transfers:(source.flux || []).filter(row=>String(row.receivedDate || '').startsWith(month)
            && ['recebido','entregue'].includes(model.norm(row.status))),
          fiscal:(source.nfe || []).filter(row=>model.monthKey(row.occurredAt)===month) };
      }
      if (calendarMonths.get(month)!==entry) return;
      entry.data=data;entry.loading=false;entry.error=Object.values(data).some(rows=>!Array.isArray(rows));
    } catch {
      if (calendarMonths.get(month)!==entry) return;
      entry.loading=false;entry.error=true;entry.data={maintenance:null,technical:null,transfers:null,fiscal:null};
    }
    if (calendarMonths.size>24) calendarMonths.delete(calendarMonths.keys().next().value);
    window.dispatchEvent(new CustomEvent('aldeckot:home-calendar-ready'));
  }
  function calendarEntries(date) {
    const data = calendarMonths.get(date.slice(0,7))?.data;
    const result = {};
    for (const key of ['maintenance','technical','transfers','fiscal']) {
      const field = key==='fiscal' ? 'occurredAt' : key==='transfers' ? 'receivedDate' : 'entryDate';
      result[key] = Array.isArray(data?.[key]) ? data[key].filter(row=>model.dateKey(row[field])===date)
        .map(row=>model.viewRow({...row,occurredAt:row[field]})) : null;
    }
    return result;
  }
  window.AldeckotHomeDashboard = {
    refresh, openSet, icons, calendarEntries, ensureCalendarMonth,
    calendarState(month) { return calendarMonths.get(month) || { loading:true }; },
    openAlert(key) { openRecord(current.sets.alerts.find(row => row.key === key)); },
    openCalendar(kind, date) {
      const entries = calendarEntries(date)[kind];
      current.sets['calendar'] = entries || []; current.availability.calendar = { available: Array.isArray(entries) };
      openSet('calendar');
    },
    get model() { return current; }
  };
  root.addEventListener('change', event => {
    const control = event.target.closest('[data-home-operation-filter]');
    if (!control) return;
    operationsFilters[control.dataset.homeOperationFilter] = control.value;
    if (control.dataset.homeOperationFilter === 'mode') {
      operationsFilters.type = 'all';
      operationsFilters.period = control.value === 'open' ? 'all' : 'month';
    }
    if (control.dataset.homeOperationFilter === 'module') operationsFilters.type = 'all';
    sessionStorage.setItem('aldeckot-home-operations-filters', JSON.stringify(operationsFilters));
    renderOperations();
    void loadOperationsHistory();
  });
  root.addEventListener('keydown', event => {
    const slice = event.target.closest('circle[data-home-set]');
    if (slice && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openSet(slice.dataset.homeSet); }
  });
  root.addEventListener('click', event => {
    if (event.target.closest('[data-home-refresh]')) refresh();
    if (event.target.closest('[data-home-operation-clear]')) {
      operationsFilters = { ...defaultOperationsFilters };
      sessionStorage.setItem('aldeckot-home-operations-filters', JSON.stringify(operationsFilters));
      renderOperations();
    }
    const key = event.target.closest('[data-home-set]')?.dataset.homeSet;
    if (key) openSet(key);
    const record = event.target.closest('[data-home-record]')?.dataset.homeRecord;
    if (record) openRecord(recordMap.get(record) || Object.values(current.sets).flat().find(row => row.key === record));
  });
  const search = document.querySelector('[data-central-search-input]');
  if (search) {
    search.placeholder = 'Buscar no sistema…';
    search.dataset.homeSearch = 'true';
    const key = document.createElement('kbd'); key.textContent = 'Ctrl + K';
    search.parentElement.append(key);
  }
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); search?.focus();
    }
  });
  render();
  refresh();
  const changes = {
    inventory_items: ['inventory', 'stock', 'events', 'effects'], inventory_item_logs: ['inventory', 'events'],
    module_records: ['management', 'control', 'events', 'effects'], control_items: ['control', 'controlLogs', 'inventory', 'management', 'events', 'effects'], control_item_logs: ['controlLogs'], flux_items: ['flux', 'events', 'effects'],
    nfe_occurrences: ['nfe', 'nfeRecurring'], sync_events: ['events', 'effects', 'backups'], equipment_events: ['events'], equipment_event_effects: ['effects'],
    supply_units: ['stock'], supply_variants: ['stock'], supplies: ['stock']
  };
  const dirty = new Set();
  window.addEventListener('aldeckot:realtime-change', event => {
    const keys = changes[event.detail?.table];
    if (!keys && event.detail?.table !== 'module_tables') return;
    (keys || Object.values(changes).flat()).forEach(key => dirty.add(key));
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => { const selected = [...dirty]; dirty.clear(); refresh(selected); }, 300);
  });
  // Revalidação ao retornar à aba; o intervalo é conservador e suspenso em segundo plano.
  let lastVisibleRefresh = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastVisibleRefresh > 60000) { lastVisibleRefresh = Date.now(); refresh(); }
  });
  window.setInterval(() => { if (!document.hidden) refresh(); }, 5 * 60 * 1000);
})();
