(() => {
  const defaultPageSize = 10;
  const reasons = ['Erro no SASII', 'Erro no Pin Pad', 'Travamento do PC', 'Erro no cartão'];
  const reasonClass = value => ({ 'Erro no SASII': 'sasii', 'Erro no Pin Pad': 'pin-pad', 'Travamento do PC': 'travamento', 'Erro no cartão': 'cartao' })[value] || '';
  const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const dateTime = value => {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  };
  const shortDate = value => {
    const date = new Date(value || '');
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : '—';
  };
  const number = value => new Intl.NumberFormat('pt-BR').format(Number(value || 0));
  const localDateTime = value => {
    const date = value ? new Date(value) : new Date();
    const pad = part => String(part).padStart(2, '0');
    return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  };
  const icon = name => {
    const paths = {
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      document: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
      bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
      moon: '<path d="M20 15.3A8.5 8.5 0 0 1 8.7 4 8.5 8.5 0 1 0 20 15.3Z"/>',
      home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
      backup: '<path d="M4 4h16v16H4zM8 4v6h8V4M8 17h8M9 13h6"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
      bars: '<path d="M5 20V11M11 20V4M17 20v-8M22 20H2"/>',
      alert: '<path d="M12 3 2.7 20h18.6L12 3ZM12 9v4M12 17h.01"/>',
      filter: '<path d="M4 5h16l-6.2 7v5l-3.6 2v-7z"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
      broom: '<path d="m4 20 8-8M10 4l10 10-4 4L6 8zM4 20l4-1-3-3z"/>',
      user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 3.4-6 8-6s7.2 2 8 6"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
      terminal: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
      monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
      server: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/><path d="M8 7h.01M8 17h.01"/>',
      file: '<path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h4"/>',
      more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
      chevron: '<path d="m9 18 6-6-6-6"/>',
      chevronsLeft: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
      chevronLeft: '<path d="m14 17-5-5 5-5"/>',
      chevronRight: '<path d="m10 17 5-5-5-5"/>',
      chevronsRight: '<path d="m6 17 5-5-5-5M13 17l5-5-5-5"/>'
    };
    return `<svg class="nfe-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  };
  const query = new URLSearchParams(window.location.search);
  const state = {
    page: 1,
    pageSize: defaultPageSize,
    items: [],
    total: 0,
    dashboard: { total: 0, today: 0, month: 0, reasons: {} },
    alerts: [],
    filters: { query: '', reason: '', pdv: query.get('pdv') || '', operator: '', dateFrom: '', dateTo: '' },
    advancedOpen: Boolean(query.get('pdv')),
    loading: true,
    error: '',
    modalFile: null,
    refreshTimer: 0,
    investigationFilters: { pdv: '', operator: '', dateFrom: '', dateTo: '' }
  };
  const root = document.getElementById('app');
  const modal = document.getElementById('nfeModal');
  const toastRoot = document.getElementById('nfeToast');
  const api = () => window.AldeckotSupabase?.nfe;
  const isAdmin = () => Boolean(window.AldeckotAuth?.isAdmin);

  function toast(message, error = false) {
    toastRoot.textContent = message;
    toastRoot.classList.toggle('error', error);
    toastRoot.classList.add('show');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => toastRoot.classList.remove('show'), 3600);
  }

  function go(target) {
    if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate(target);
    else window.location.href = target;
  }

  function reasonBadge(value) {
    return `<span class="nfe-reason ${reasonClass(value)}"><i>●</i>${escape(value || 'Não informado')}</span>`;
  }

  function metric(label, value, detail, icon) {
    return `<article class="nfe-metric"><span class="nfe-metric-icon">${icon}</span><small>${label}</small><b>${number(value)}</b><span>${escape(detail)}</span></article>`;
  }

  function visibleReasonCounts() {
    const all = state.dashboard.reasons || {};
    return reasons.map(reason => [reason, Number(all[reason] || 0)]);
  }

  function render() {
    const activeSearch = document.activeElement?.matches?.('[data-nfe-query]') ? {
      start: document.activeElement.selectionStart,
      end: document.activeElement.selectionEnd
    } : null;
    const dominant = visibleReasonCounts().sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const canManage = isAdmin();
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const tableBody = state.loading
      ? '<tr><td colspan="7" class="nfe-empty"><b>Atualizando ocorrências…</b>A Central Fiscal está consultando a base corporativa.</td></tr>'
      : state.error
        ? `<tr><td colspan="7" class="nfe-empty"><b>Não foi possível carregar a Central Fiscal</b>${escape(state.error)}</td></tr>`
        : !state.items.length
          ? '<tr><td colspan="7" class="nfe-empty"><b>Nenhuma ocorrência encontrada</b>Os filtros atuais não retornaram registros.</td></tr>'
          : state.items.map(item => `<tr class="nfe-row" data-nfe-open="${item.id}"><td><span class="nfe-row-name"><b>${escape(item.nfeNumber)}</b><small>${escape(item.pdv)}</small></span></td><td>${escape(item.operator)}</td><td>${escape(item.fiscal)}</td><td>${shortDate(item.occurredAt)}</td><td>${reasonBadge(item.reason)}</td><td>${escape(item.pdfName)}</td><td><button class="nfe-mini-button" type="button" data-nfe-open-action="${item.id}">Ver</button></td></tr>`).join('');
    const alertHtml = state.alerts.length
      ? state.alerts.map(alert => `<article class="nfe-alert-card"><b>🚨 ${escape(alert.pdv)}</b><span>${number(alert.occurrences)} ocorrências nesta semana</span><small>Última: ${dateTime(alert.latestAt)}</small></article>`).join('')
      : '<p class="nfe-empty" style="padding:20px 4px">Nenhum PDV atingiu o limite semanal.</p>';
    root.innerHTML = `<header class="nfe-header">
      <div class="nfe-header-icon">▧</div><div class="nfe-heading"><h1>Fiscal NF-e</h1><p>Central de Ocorrências NF-e · Liberação e monitoramento</p></div>
      <div class="nfe-header-actions"><span class="nfe-sync"><i></i>Tempo real</span><button class="nfe-icon-button" type="button" data-nfe-theme title="Alternar tema" aria-label="Alternar tema">◐</button><button class="nfe-icon-button" type="button" data-nfe-export="excel" title="Exportar Excel" aria-label="Exportar Excel">⇩</button><button class="nfe-icon-button" type="button" data-nfe-export="pdf" title="Exportar PDF" aria-label="Exportar PDF">▤</button>${canManage ? '<button class="nfe-icon-button" type="button" data-nfe-backup title="Backup Fiscal" aria-label="Backup Fiscal">◫</button>' : ''}<button class="nfe-icon-button" type="button" data-nfe-home title="Voltar para Home" aria-label="Voltar para Home">⌂</button></div>
    </header>
    <div class="nfe-grid"><section class="nfe-workspace">
      <section class="nfe-metrics">${metric('Total de ocorrências', state.dashboard.total, 'Base corporativa', '▦')}${metric('Registradas hoje', state.dashboard.today, 'Atualização em tempo real', '◷')}${metric('No mês atual', state.dashboard.month, 'Histórico fiscal', '◫')}${metric('Motivo mais recorrente', dominant[1], dominant[0] || 'Sem ocorrências', '◉')}</section>
      <section class="nfe-toolbar">
        <label class="nfe-search-wrap"><input class="nfe-input" data-nfe-query value="${escape(state.filters.query)}" placeholder="Buscar NF-e, PDV, operador, fiscal…" autocomplete="off"></label>
        <select class="nfe-select" data-nfe-reason><option value="">Motivo ▾</option>${reasons.map(reason => `<option value="${escape(reason)}"${state.filters.reason === reason ? ' selected' : ''}>${escape(reason)}</option>`).join('')}</select>
        <button class="nfe-action-button" type="button" data-nfe-advanced>Filtros avançados</button>
        ${canManage ? '<button class="nfe-action-button primary" type="button" data-nfe-new>＋ Nova NF-e</button>' : ''}
        <section class="nfe-advanced" ${state.advancedOpen ? '' : 'hidden'} data-nfe-advanced-panel><div class="nfe-advanced-grid"><label class="nfe-field">PDV<input class="nfe-input" data-nfe-filter="pdv" value="${escape(state.filters.pdv)}" placeholder="Ex.: Caixa 12"></label><label class="nfe-field">Operador<input class="nfe-input" data-nfe-filter="operator" value="${escape(state.filters.operator)}" placeholder="Nome do operador"></label><label class="nfe-field">De<input class="nfe-input" data-nfe-filter="dateFrom" value="${escape(state.filters.dateFrom)}" type="date"></label><label class="nfe-field">Até<input class="nfe-input" data-nfe-filter="dateTo" value="${escape(state.filters.dateTo)}" type="date"></label></div></section>
      </section>
      <section class="nfe-table-panel"><header class="nfe-table-head"><div><h2>Últimas ocorrências</h2><p>${state.loading ? 'Carregando dados…' : `${number(state.total)} registro${state.total === 1 ? '' : 's'} localizado${state.total === 1 ? '' : 's'} na base`}</p></div><button class="nfe-action-button" type="button" data-nfe-clear-filters>Limpar filtros</button></header><div class="nfe-table-wrap"><table class="nfe-table"><thead><tr><th>NF-e / PDV</th><th>Operador</th><th>Fiscal</th><th>Data</th><th>Motivo</th><th>PDF</th><th></th></tr></thead><tbody>${tableBody}</tbody></table></div><footer class="nfe-pagination"><span>Página ${state.page} de ${totalPages}</span><button type="button" data-nfe-page="prev" ${state.page === 1 || state.loading ? 'disabled' : ''}>‹</button><button type="button" data-nfe-page="next" ${state.page >= totalPages || state.loading ? 'disabled' : ''}>›</button></footer></section>
    </section><aside class="nfe-side"><section class="nfe-side-panel"><h2>Ocorrências por motivo</h2><p>Selecione um motivo para filtrar a tabela</p><div class="nfe-reason-list">${visibleReasonCounts().map(([reason, count]) => `<div class="nfe-reason-row"><button type="button" data-nfe-quick-reason="${escape(reason)}"><i class="nfe-reason-dot"></i>${escape(reason)}</button><b>${number(count)}</b></div>`).join('')}</div></section><section class="nfe-side-panel nfe-side-alert"><h2>PDVs para investigar</h2><p>Mais de três ocorrências no mesmo PDV nesta semana</p><div class="nfe-alert-list">${alertHtml}</div></section></aside></div>`;
    bindEvents();
  }

  function bindEvents() {
    root.querySelector('[data-nfe-home]')?.addEventListener('click', () => go('index.html'));
    root.querySelector('[data-nfe-theme]')?.addEventListener('click', () => document.getElementById('themeSwitch')?.click());
    root.querySelector('[data-nfe-new]')?.addEventListener('click', () => openForm());
    root.querySelector('[data-nfe-backup]')?.addEventListener('click', openBackup);
    root.querySelector('[data-nfe-advanced]')?.addEventListener('click', () => { state.advancedOpen = !state.advancedOpen; render(); });
    root.querySelector('[data-nfe-clear-filters]')?.addEventListener('click', () => { state.filters = { query: '', reason: '', pdv: '', operator: '', dateFrom: '', dateTo: '' }; state.page = 1; state.advancedOpen = false; refresh(); });
    root.querySelector('[data-nfe-query]')?.addEventListener('input', event => {
      state.filters.query = event.target.value;
      window.clearTimeout(state.searchTimer);
      state.searchTimer = window.setTimeout(() => { state.page = 1; refresh(); }, 260);
    });
    root.querySelector('[data-nfe-reason]')?.addEventListener('change', event => { state.filters.reason = event.target.value; state.page = 1; refresh(); });
    root.querySelectorAll('[data-nfe-filter]').forEach(input => input.addEventListener('change', event => { state.filters[event.target.dataset.nfeFilter] = event.target.value; state.page = 1; refresh(); }));
    root.querySelectorAll('[data-nfe-quick-reason]').forEach(button => button.addEventListener('click', () => { state.filters.reason = button.dataset.nfeQuickReason; state.page = 1; refresh(); }));
    root.querySelectorAll('[data-nfe-open]').forEach(button => button.addEventListener('click', () => openDetails(button.dataset.nfeOpen)));
    root.querySelectorAll('[data-nfe-open-action]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openDetails(button.dataset.nfeOpenAction); }));
    root.querySelector('[data-nfe-page="prev"]')?.addEventListener('click', () => { state.page -= 1; refresh(); });
    root.querySelector('[data-nfe-page="next"]')?.addEventListener('click', () => { state.page += 1; refresh(); });
    root.querySelectorAll('[data-nfe-export]').forEach(button => button.addEventListener('click', () => button.dataset.nfeExport === 'excel' ? exportExcel() : exportPdf()));
  }

  /* Composição visual corporativa: mantém as mesmas operações, mas organiza tudo
     em uma hierarquia única e com ícones SVG consistentes. */
  function metric(label, value, detail, iconName, tone) {
    return `<article class="nfe-metric nfe-metric-${tone}"><div class="nfe-metric-main"><span class="nfe-metric-icon">${icon(iconName)}</span><div><small>${escape(label)}</small><b>${number(value)}</b><span>${escape(detail)}</span></div><span class="nfe-metric-mark">${icon('chart')}</span></div><footer><span><i>↗</i> Dados em tempo real</span><svg viewBox="0 0 150 32" aria-hidden="true"><path d="M1 26C14 24 16 17 27 20s11 7 22 3 12-13 23-8 13 13 25 7 12-10 22-6 10 8 20 3 10-12 20-11"/></svg></footer></article>`;
  }

  function render() {
    const counts = visibleReasonCounts();
    const dominant = [...counts].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const canManage = isAdmin();
    const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
    const tableBody = state.loading
      ? '<tr><td colspan="8" class="nfe-empty"><b>Atualizando ocorrências…</b>A Central Fiscal está consultando a base corporativa.</td></tr>'
      : state.error
        ? `<tr><td colspan="8" class="nfe-empty"><b>Não foi possível carregar a Central Fiscal</b>${escape(state.error)}</td></tr>`
        : !state.items.length
          ? '<tr><td colspan="8" class="nfe-empty"><b>Nenhuma ocorrência encontrada</b>Os filtros atuais não retornaram registros.</td></tr>'
          : state.items.map(item => {
            const moment = localDateTime(item.occurredAt);
            return `<tr class="nfe-row" data-nfe-open="${item.id}"><td><span class="nfe-row-name"><b>${escape(item.nfeNumber)}</b><small>${escape(item.pdv)}</small></span></td><td><span class="nfe-person">${icon('user')}<b>${escape(item.operator)}</b></span></td><td>${escape(item.operatorCode)}</td><td>${escape(item.fiscal)}</td><td><span class="nfe-date-cell">${icon('calendar')}<b>${moment.date.split('-').reverse().join('/')}</b><small>${icon('clock')}${moment.time}</small></span></td><td>${reasonBadge(item.reason)}</td><td><button class="nfe-file-chip" type="button" data-nfe-open-action="${item.id}">${icon('file')}<span>${escape(item.pdfName)}</span></button></td><td><button class="nfe-more-button" type="button" data-nfe-open-action="${item.id}" aria-label="Abrir ações da NF-e ${escape(item.nfeNumber)}">${icon('more')}</button></td></tr>`;
          }).join('');
    const alertHtml = state.alerts.length
      ? state.alerts.map(alert => `<article class="nfe-alert-card"><b>${icon('monitor')}${escape(alert.pdv)}</b><span>${number(alert.occurrences)} ocorrências nesta semana</span><small>Última: ${dateTime(alert.latestAt)}</small></article>`).join('')
      : `<div class="nfe-alert-empty">${icon('alert')}<b>Nenhum PDV atingiu<br>o limite semanal.</b></div>`;
    root.innerHTML = `<header class="nfe-header">
      <span class="nfe-header-icon">${icon('document')}</span><div class="nfe-heading"><h1>Fiscal NF-e</h1><p>Central de Ocorrências NF-e • Liberação e monitoramento</p></div>
      <label class="nfe-global-search">${icon('search')}<input class="nfe-input" data-nfe-query value="${escape(state.filters.query)}" placeholder="Buscar NF-e, PDV, operador, fiscal…" autocomplete="off"><kbd>Ctrl + K</kbd></label>
      <div class="nfe-header-actions"><span class="nfe-sync"><i></i>Tempo real</span><button class="nfe-icon-button" type="button" data-nfe-notifications title="Central de notificações" aria-label="Abrir Central de notificações">${icon('bell')}<em>•</em></button>${canManage ? `<button class="nfe-icon-button" type="button" data-nfe-backup title="Backup Fiscal" aria-label="Backup Fiscal">${icon('backup')}</button>` : ''}<button class="nfe-icon-button" type="button" data-nfe-home title="Voltar para Home" aria-label="Voltar para Home">${icon('home')}</button></div>
    </header>
    <div class="nfe-grid"><section class="nfe-workspace">
      <section class="nfe-metrics">${metric('Total de ocorrências', state.dashboard.total, 'Base corporativa', 'document', 'blue')}${metric('Registradas hoje', state.dashboard.today, 'Atualização em tempo real', 'calendar', 'blue')}${metric('No mês atual', state.dashboard.month, 'Histórico fiscal', 'bars', 'green')}${metric('Motivo mais recorrente', dominant[1], dominant[0] || 'Sem ocorrências', 'alert', 'gold')}</section>
      <section class="nfe-toolbar"><div class="nfe-quick-filters"><button class="nfe-filter-chip ${!state.filters.reason ? 'is-active' : ''}" type="button" data-nfe-quick-all>${icon('filter')}Todos</button>${reasons.map(reason => `<button class="nfe-filter-chip ${reasonClass(reason)} ${state.filters.reason === reason ? 'is-active' : ''}" type="button" data-nfe-quick-reason="${escape(reason)}"><i></i>${escape(reason)}</button>`).join('')}</div><div class="nfe-toolbar-actions"><button class="nfe-action-button" type="button" data-nfe-advanced>${icon('filter')}Filtros avançados</button>${canManage ? `<button class="nfe-action-button primary" type="button" data-nfe-new>${icon('plus')}Nova NF-e</button>` : ''}</div><section class="nfe-advanced" ${state.advancedOpen ? '' : 'hidden'} data-nfe-advanced-panel><div class="nfe-advanced-grid"><label class="nfe-field">PDV<input class="nfe-input" data-nfe-filter="pdv" value="${escape(state.filters.pdv)}" placeholder="Ex.: Caixa 12"></label><label class="nfe-field">Operador<input class="nfe-input" data-nfe-filter="operator" value="${escape(state.filters.operator)}" placeholder="Nome do operador"></label><label class="nfe-field">De<input class="nfe-input" data-nfe-filter="dateFrom" value="${escape(state.filters.dateFrom)}" type="date"></label><label class="nfe-field">Até<input class="nfe-input" data-nfe-filter="dateTo" value="${escape(state.filters.dateTo)}" type="date"></label></div></section></section>
      <section class="nfe-table-panel"><header class="nfe-table-head"><div class="nfe-table-title">${icon('server')}<div><h2>Últimas ocorrências</h2><p>${state.loading ? 'Carregando dados…' : `${number(state.total)} registro${state.total === 1 ? '' : 's'} localizado${state.total === 1 ? '' : 's'} na base`}</p></div></div><div class="nfe-table-actions"><div class="nfe-export-wrap"><button class="nfe-action-button" type="button" data-nfe-export-toggle>${icon('download')}Exportar${icon('chevron')}</button><div class="nfe-export-menu" data-nfe-export-menu hidden><button type="button" data-nfe-export="excel">${icon('document')}Excel</button><button type="button" data-nfe-export="pdf">${icon('file')}PDF</button></div></div><button class="nfe-action-button" type="button" data-nfe-clear-filters>${icon('broom')}Limpar filtros</button></div></header><div class="nfe-table-wrap"><table class="nfe-table"><thead><tr><th>NF-e / PDV</th><th>Operador</th><th>Código</th><th>Fiscal</th><th>Data / Hora</th><th>Motivo</th><th>PDF</th><th>Ações</th></tr></thead><tbody>${tableBody}</tbody></table></div><footer class="nfe-pagination"><label><select class="nfe-page-size" data-nfe-page-size>${[10, 15, 25, 50].map(size => `<option value="${size}"${state.pageSize === size ? ' selected' : ''}>${size}</option>`).join('')}</select> por página</label><span>Página ${state.page} de ${totalPages}</span><button type="button" data-nfe-page="first" ${state.page === 1 || state.loading ? 'disabled' : ''}>${icon('chevronsLeft')}</button><button type="button" data-nfe-page="prev" ${state.page === 1 || state.loading ? 'disabled' : ''}>${icon('chevronLeft')}</button><b>${state.page}</b><button type="button" data-nfe-page="next" ${state.page >= totalPages || state.loading ? 'disabled' : ''}>${icon('chevronRight')}</button><button type="button" data-nfe-page="last" ${state.page >= totalPages || state.loading ? 'disabled' : ''}>${icon('chevronsRight')}</button></footer></section>
    </section><aside class="nfe-side"><section class="nfe-side-panel nfe-reasons-panel"><header>${icon('filter')}<div><h2>Ocorrências por motivo</h2><p>Selecione um motivo para filtrar a tabela</p></div></header><div class="nfe-reason-list">${counts.map(([reason, count]) => `<button class="nfe-reason-row ${reasonClass(reason)}" type="button" data-nfe-quick-reason="${escape(reason)}"><span class="nfe-side-reason-icon">${icon({ sasii: 'server', 'pin-pad': 'terminal', travamento: 'monitor', cartao: 'card' }[reasonClass(reason)])}</span><span>${escape(reason)}</span><b>${number(count)}</b></button>`).join('')}</div></section><section class="nfe-side-panel nfe-side-alert"><header>${icon('monitor')}<div><h2>PDVs para investigar</h2><p>Mais de 3 ocorrências do mesmo PDV nesta semana</p></div></header><div class="nfe-alert-list">${alertHtml}</div><button class="nfe-alert-history" type="button" data-nfe-alert-history>Ver histórico completo${icon('chevron')}</button></section></aside></div>`;
    bindEvents();
    if (activeSearch) {
      const input = root.querySelector('[data-nfe-query]');
      input?.focus({ preventScroll: true });
      if (input && Number.isInteger(activeSearch.start) && Number.isInteger(activeSearch.end)) input.setSelectionRange(activeSearch.start, activeSearch.end);
    }
  }

  function bindEvents() {
    root.querySelectorAll('[data-nfe-home], [data-nfe-notifications]').forEach(button => button.addEventListener('click', () => go('index.html')));
    root.querySelector('[data-nfe-new]')?.addEventListener('click', () => openForm());
    root.querySelector('[data-nfe-backup]')?.addEventListener('click', openBackup);
    root.querySelector('[data-nfe-advanced]')?.addEventListener('click', () => { state.advancedOpen = !state.advancedOpen; render(); });
    root.querySelector('[data-nfe-clear-filters]')?.addEventListener('click', () => { state.filters = { query: '', reason: '', pdv: '', operator: '', dateFrom: '', dateTo: '' }; state.page = 1; state.advancedOpen = false; refresh(); });
    root.querySelector('[data-nfe-query]')?.addEventListener('input', event => { state.filters.query = event.target.value; window.clearTimeout(state.searchTimer); state.searchTimer = window.setTimeout(() => { state.page = 1; refresh(); }, 260); });
    root.querySelectorAll('[data-nfe-filter]').forEach(input => input.addEventListener('change', event => { state.filters[event.target.dataset.nfeFilter] = event.target.value; state.page = 1; refresh(); }));
    root.querySelector('[data-nfe-quick-all]')?.addEventListener('click', () => { state.filters.reason = ''; state.page = 1; refresh(); });
    root.querySelectorAll('[data-nfe-quick-reason]').forEach(button => button.addEventListener('click', () => { state.filters.reason = button.dataset.nfeQuickReason; state.page = 1; refresh(); }));
    root.querySelectorAll('[data-nfe-open]').forEach(button => button.addEventListener('click', () => openDetails(button.dataset.nfeOpen)));
    root.querySelectorAll('[data-nfe-open-action]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); openDetails(button.dataset.nfeOpenAction); }));
    root.querySelector('[data-nfe-page-size]')?.addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; refresh(); });
    root.querySelectorAll('[data-nfe-page]').forEach(button => button.addEventListener('click', () => { const page = button.dataset.nfePage; const total = Math.max(1, Math.ceil(state.total / state.pageSize)); if (page === 'first') state.page = 1; if (page === 'prev') state.page -= 1; if (page === 'next') state.page += 1; if (page === 'last') state.page = total; refresh(); }));
    root.querySelectorAll('[data-nfe-export]').forEach(button => button.addEventListener('click', () => button.dataset.nfeExport === 'excel' ? exportExcel() : exportPdf()));
    root.querySelector('[data-nfe-export-toggle]')?.addEventListener('click', () => { const menu = root.querySelector('[data-nfe-export-menu]'); menu.hidden = !menu.hidden; });
    root.querySelector('[data-nfe-alert-history]')?.addEventListener('click', openInvestigationHistory);
    if (!state.shortcutsBound) { state.shortcutsBound = true; document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); root.querySelector('[data-nfe-query]')?.focus(); } }); }
  }

  async function refresh({ quiet = false } = {}) {
    if (!api()) return;
    if (!quiet) { state.loading = true; state.error = ''; render(); }
    try {
      const [records, dashboard, alerts] = await Promise.all([
        api().load({ ...state.filters, page: state.page, pageSize: state.pageSize }),
        api().dashboard(),
        api().recurringPdvAlerts()
      ]);
      state.items = records.items;
      state.total = records.count;
      state.dashboard = dashboard;
      state.alerts = alerts;
      state.error = '';
    } catch (error) {
      state.error = error.message || 'Falha na comunicação com o Supabase.';
      if (!quiet) state.items = [];
    } finally {
      state.loading = false;
      render();
      window.AldeckotModuleStage?.reveal?.();
    }
  }

  function openModal(content) {
    modal.innerHTML = content;
    modal.hidden = false;
    modal.querySelector('[data-nfe-close]')?.addEventListener('click', closeModal);
    modal.onclick = closeOnBackdrop;
  }
  function closeOnBackdrop(event) { if (event.target === modal) closeModal(); }
  function closeModal() { modal.hidden = true; modal.innerHTML = ''; state.modalFile = null; }

  function formContent(item = null) {
    const current = localDateTime(item?.occurredAt);
    const title = item ? 'Editar ocorrência NF-e' : 'Nova NF-e';
    const documentName = item?.pdfName || 'PDF obrigatório · até 10 MB';
    return `<section class="nfe-dialog"><header class="nfe-dialog-head"><div><p class="nfe-dialog-eyebrow">Fiscal NF-e</p><h2>${title}</h2><p>Registre a ocorrência com o documento fiscal correspondente.</p></div><button class="nfe-dialog-close" type="button" data-nfe-close>×</button></header><form data-nfe-form><div class="nfe-form-grid">
      <label class="nfe-field">Operador<input class="nfe-input" name="operator" required maxlength="140" value="${escape(item?.operator || '')}" placeholder="Nome do operador"></label>
      <label class="nfe-field">Código do operador<input class="nfe-input" name="operatorCode" required maxlength="80" value="${escape(item?.operatorCode || '')}" placeholder="Código interno"></label>
      <label class="nfe-field">Fiscal<input class="nfe-input" name="fiscal" required maxlength="140" value="${escape(item?.fiscal || '')}" placeholder="Responsável fiscal"></label>
      <label class="nfe-field">PDV<input class="nfe-input" name="pdv" required maxlength="120" value="${escape(item?.pdv || '')}" placeholder="Ex.: Caixa 12"></label>
      <label class="nfe-field">Data<input class="nfe-input" name="date" type="date" required value="${current.date}"></label>
      <label class="nfe-field">Hora<input class="nfe-input" name="time" type="time" required value="${current.time}"></label>
      <label class="nfe-field">Número da NF-e<input class="nfe-input" name="nfeNumber" required maxlength="120" value="${escape(item?.nfeNumber || '')}" placeholder="Número da nota"></label>
      <label class="nfe-field">Motivo<select class="nfe-select" name="reason" required>${reasons.map(reason => `<option value="${escape(reason)}"${item?.reason === reason ? ' selected' : ''}>${escape(reason)}</option>`).join('')}</select></label>
      <label class="nfe-field full">Observação<textarea class="nfe-textarea" name="notes" maxlength="5000" placeholder="Descreva a ocorrência, liberação ou providência tomada…">${escape(item?.notes || '')}</textarea></label>
      <label class="nfe-upload ${item ? 'has-file' : ''} full" data-nfe-upload><input type="file" accept="application/pdf,.pdf" data-nfe-file ${item ? '' : 'required'}><span class="nfe-upload-icon">⌑</span><span><b data-nfe-file-name>${escape(documentName)}</b><span data-nfe-file-note>${item ? 'Envie outro PDF apenas se precisar substituí-lo.' : 'Somente PDF, com tamanho máximo de 10 MB.'}</span></span><span class="nfe-upload-progress"><i></i></span></label>
    </div><footer class="nfe-modal-actions"><button class="nfe-action-button" type="button" data-nfe-close>Cancelar</button><button class="nfe-action-button primary" type="submit" data-nfe-submit>${item ? 'Salvar alterações' : 'Registrar NF-e'}</button></footer></form></section>`;
  }

  function openForm(item = null) {
    if (!isAdmin()) return toast('Seu perfil possui somente acesso de consulta.', true);
    openModal(formContent(item));
    const form = modal.querySelector('[data-nfe-form]');
    const upload = modal.querySelector('[data-nfe-upload]');
    const fileInput = modal.querySelector('[data-nfe-file]');
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      state.modalFile = file || null;
      const valid = file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) && file.size <= 10485760;
      upload.classList.toggle('has-file', Boolean(valid));
      modal.querySelector('[data-nfe-file-name]').textContent = file ? file.name : (item?.pdfName || 'PDF obrigatório · até 10 MB');
      modal.querySelector('[data-nfe-file-note]').textContent = !file ? (item ? 'Envie outro PDF apenas se precisar substituí-lo.' : 'Somente PDF, com tamanho máximo de 10 MB.') : valid ? `${(file.size / 1024 / 1024).toFixed(2)} MB · pronto para envio` : 'Arquivo inválido: envie um PDF de até 10 MB.';
    });
    form.addEventListener('submit', event => saveForm(event, item));
  }

  async function saveForm(event, existing) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[data-nfe-submit]');
    const values = Object.fromEntries(new FormData(form));
    const selected = state.modalFile;
    if (!existing && !selected) return toast('Anexe o PDF obrigatório antes de registrar a NF-e.', true);
    if (selected && (selected.type !== 'application/pdf' && !/\.pdf$/i.test(selected.name) || selected.size > 10485760)) return toast('Envie um PDF válido com até 10 MB.', true);
    submit.disabled = true;
    submit.textContent = selected ? 'Enviando PDF…' : 'Salvando…';
    let uploadedPath = '';
    let saved = false;
    try {
      let documentData = existing ? { path: existing.pdfPath, name: existing.pdfName, size: existing.pdfSize } : null;
      if (selected) {
        modal.querySelector('.nfe-upload-progress i').style.width = '58%';
        documentData = await api().uploadPdf(selected);
        uploadedPath = documentData.path;
        modal.querySelector('.nfe-upload-progress i').style.width = '92%';
      }
      const occurredAt = new Date(`${values.date}T${values.time}`).toISOString();
      const payload = { operator: values.operator, operatorCode: values.operatorCode, fiscal: values.fiscal, occurredAt, pdv: values.pdv, nfeNumber: values.nfeNumber, reason: values.reason, notes: values.notes, pdfPath: documentData.path, pdfName: documentData.name, pdfSize: documentData.size };
      if (existing) await api().update(existing.id, payload);
      else await api().create(payload);
      saved = true;
      closeModal();
      toast(existing ? 'Ocorrência NF-e atualizada e auditada.' : 'Nova NF-e registrada e sincronizada.');
      refresh();
    } catch (error) {
      if (uploadedPath && !saved) api().discardPdf(uploadedPath).catch(() => {});
      toast(error.message || 'Não foi possível salvar a ocorrência.', true);
      submit.disabled = false;
      submit.textContent = existing ? 'Salvar alterações' : 'Registrar NF-e';
    }
  }

  async function openDetails(id) {
    try {
      const result = await api().get(id);
      const item = result.item;
      let pdfUrl = '';
      try { pdfUrl = await api().signedPdfUrl(item.pdfPath); }
      catch (error) { console.warn('Visualização do PDF indisponível:', error); }
      const details = [['Operador', item.operator], ['Código', item.operatorCode], ['Fiscal', item.fiscal], ['PDV', item.pdv], ['Data e hora', dateTime(item.occurredAt)], ['NF-e', item.nfeNumber], ['Motivo', item.reason], ['Documento', item.pdfName]];
      openModal(`<section class="nfe-dialog"><header class="nfe-dialog-head"><div><p class="nfe-dialog-eyebrow">Detalhe da ocorrência</p><h2>NF-e ${escape(item.nfeNumber)}</h2><p>${escape(item.pdv)} · registro auditado em tempo real</p></div><button class="nfe-dialog-close" type="button" data-nfe-close>×</button></header><section class="nfe-detail-grid">${details.map(([label, value]) => `<article class="nfe-detail"><small>${escape(label)}</small><b>${label === 'Motivo' ? reasonBadge(value) : escape(value || '—')}</b></article>`).join('')}<article class="nfe-detail full"><small>Observação</small><b>${escape(item.notes || 'Sem observação registrada.')}</b></article></section>${pdfUrl ? `<section class="nfe-preview"><header class="nfe-preview-head"><span>Visualização segura do PDF</span><button class="nfe-mini-button" type="button" data-nfe-download>Baixar PDF</button></header><iframe title="PDF da NF-e ${escape(item.nfeNumber)}" src="${escape(pdfUrl)}"></iframe></section>` : '<section class="nfe-preview"><header class="nfe-preview-head">O PDF não está disponível para visualização.</header></section>'}<section><p class="nfe-dialog-eyebrow" style="margin-top:17px">Auditoria</p><div class="nfe-log-list">${result.logs.length ? result.logs.map(log => `<div class="nfe-log"><i>◌</i><div><b>${escape({ created: 'Ocorrência criada', updated: 'Ocorrência atualizada', deleted: 'Ocorrência excluída', investigation_resolved: 'Solução de investigação registrada' }[log.action] || log.action)}</b><small>${dateTime(log.created_at)} · ${escape(log.details?.pdv || item.pdv)}</small></div></div>`).join('') : '<p class="nfe-empty" style="padding:12px">Nenhum log disponível.</p>'}</div></section><footer class="nfe-modal-actions">${isAdmin() ? `<button class="nfe-action-button danger" type="button" data-nfe-delete>Excluir</button><button class="nfe-action-button" type="button" data-nfe-edit>Editar</button>` : ''}<button class="nfe-action-button primary" type="button" data-nfe-close>Fechar</button></footer></section>`);
      modal.querySelector('[data-nfe-download]')?.addEventListener('click', () => window.open(pdfUrl, '_blank', 'noopener'));
      modal.querySelector('[data-nfe-edit]')?.addEventListener('click', () => openForm(item));
      modal.querySelector('[data-nfe-delete]')?.addEventListener('click', () => confirmDelete(item));
    } catch (error) { toast(error.message || 'Não foi possível abrir a ocorrência.', true); }
  }

  function confirmDelete(item) {
    openModal(`<section class="nfe-dialog small"><header class="nfe-dialog-head"><div><p class="nfe-dialog-eyebrow">Ação irreversível</p><h2>Excluir esta ocorrência?</h2><p>A NF-e ${escape(item.nfeNumber)} será removida da Central. O PDF privado permanece somente para retenção de backup e o log de auditoria é preservado.</p></div><button class="nfe-dialog-close" type="button" data-nfe-close>×</button></header><footer class="nfe-modal-actions"><button class="nfe-action-button" type="button" data-nfe-close>Cancelar</button><button class="nfe-action-button danger" type="button" data-nfe-confirm-delete>Excluir ocorrência</button></footer></section>`);
    modal.querySelector('[data-nfe-confirm-delete]').addEventListener('click', async () => {
      try { await api().remove(item); closeModal(); toast('Ocorrência excluída e registrada na auditoria.'); refresh(); }
      catch (error) { toast(error.message || 'Não foi possível excluir a ocorrência.', true); }
    });
  }

  function investigationFiltersContent(filters) {
    return `<form class="nfe-history-filters" data-nfe-history-filter><label class="nfe-field">PDV<input class="nfe-input" name="pdv" value="${escape(filters.pdv)}" placeholder="Ex.: Caixa 12"></label><label class="nfe-field">Operador<input class="nfe-input" name="operator" value="${escape(filters.operator)}" placeholder="Nome do operador"></label><label class="nfe-field">De<input class="nfe-input" name="dateFrom" value="${escape(filters.dateFrom)}" type="date"></label><label class="nfe-field">Até<input class="nfe-input" name="dateTo" value="${escape(filters.dateTo)}" type="date"></label><button class="nfe-action-button primary" type="submit">${icon('search')}Buscar histórico</button></form>`;
  }

  function investigationHistoryContent(entries, filters, loading = false) {
    const rows = loading
      ? '<div class="nfe-history-empty"><i></i><b>Consultando histórico de PDVs…</b></div>'
      : !entries.length
        ? `<div class="nfe-history-empty">${icon('monitor')}<b>Nenhum PDV está pendente de investigação para estes filtros.</b><span>Registros já solucionados também aparecem quando o período correspondente é informado.</span></div>`
        : `<div class="nfe-history-list">${entries.map(entry => {
          const item = entry.item;
          const resolution = entry.resolution;
          return `<button class="nfe-history-row" type="button" data-nfe-investigation-open="${item.id}"><span class="nfe-history-row-icon">${icon(resolution ? 'document' : 'alert')}</span><span class="nfe-history-row-main"><b>${escape(item.pdv)} <small>• NF-e ${escape(item.nfeNumber)}</small></b><span>${escape(item.operator)} · ${dateTime(item.occurredAt)} · ${escape(item.reason)}</span></span><span class="nfe-history-state ${resolution ? 'done' : 'pending'}">${resolution ? 'Concluído' : 'Pendente'}</span>${icon('chevron')}</button>`;
        }).join('')}</div>`;
    return `<section class="nfe-dialog nfe-history-dialog"><header class="nfe-dialog-head"><div><p class="nfe-dialog-eyebrow">Central Fiscal NF-e</p><h2>Histórico completo de investigações</h2><p>Consulte PDVs sinalizados, filtre por período e registre a solução aplicada em cada ocorrência.</p></div><button class="nfe-dialog-close" type="button" data-nfe-close>×</button></header>${investigationFiltersContent(filters)}<section class="nfe-history-results"><header><span>${icon('monitor')}</span><div><b>PDVs para investigar</b><small>${loading ? 'Atualizando resultado…' : `${entries.length} ocorrência${entries.length === 1 ? '' : 's'} no levantamento`}</small></div></header>${rows}</section></section>`;
  }

  async function openInvestigationHistory() {
    const filters = { ...state.investigationFilters };
    openModal(investigationHistoryContent([], filters, true));
    try {
      const entries = await api().investigationHistory(filters);
      openModal(investigationHistoryContent(entries, filters));
      modal.querySelector('[data-nfe-history-filter]')?.addEventListener('submit', event => {
        event.preventDefault();
        state.investigationFilters = Object.fromEntries(new FormData(event.currentTarget));
        openInvestigationHistory();
      });
      modal.querySelectorAll('[data-nfe-investigation-open]').forEach(button => button.addEventListener('click', () => {
        const entry = entries.find(candidate => candidate.item.id === button.dataset.nfeInvestigationOpen);
        if (entry) openInvestigationResolution(entry);
      }));
    } catch (error) {
      toast(error.message || 'Não foi possível consultar o histórico de investigações.', true);
      closeModal();
    }
  }

  function openInvestigationResolution(entry) {
    const { item, resolution } = entry;
    const readOnly = !isAdmin();
    const actionLabel = resolution ? 'Atualizar solução' : 'Registrar solução';
    const content = `<section class="nfe-dialog nfe-history-dialog"><header class="nfe-dialog-head"><div><p class="nfe-dialog-eyebrow">Investigação de PDV</p><h2>${escape(item.pdv)} · NF-e ${escape(item.nfeNumber)}</h2><p>Os dados originais são mantidos como foram registrados na abertura da ocorrência.</p></div><button class="nfe-dialog-close" type="button" data-nfe-close>×</button></header><section class="nfe-detail-grid nfe-history-context"><div class="nfe-detail"><small>Operador</small><b>${escape(item.operator)} · ${escape(item.operatorCode)}</b></div><div class="nfe-detail"><small>Fiscal</small><b>${escape(item.fiscal)}</b></div><div class="nfe-detail"><small>Data e hora</small><b>${dateTime(item.occurredAt)}</b></div><div class="nfe-detail"><small>Motivo</small><b>${escape(item.reason)}</b></div><div class="nfe-detail"><small>NF-e</small><b>${escape(item.nfeNumber)}</b></div><div class="nfe-detail"><small>Observação original</small><b>${escape(item.notes || 'Sem observação registrada.')}</b></div></section>${readOnly ? `<section class="nfe-history-readonly"><b>${resolution ? 'Solução registrada' : 'Pendente de resolução'}</b><p>${resolution ? escape(resolution.solution) : 'Apenas administradores podem registrar a solução desta investigação.'}</p></section>` : `<form data-nfe-resolution-form><div class="nfe-form-grid"><label class="nfe-field full">Solução encontrada<textarea class="nfe-textarea" name="solution" required maxlength="5000" placeholder="Descreva a solução aplicada e o resultado obtido…">${escape(resolution?.solution || '')}</textarea></label><label class="nfe-field">Necessária troca do PC?<select class="nfe-select" name="pcReplacement" required><option value="">Selecione</option><option value="true"${resolution?.pcReplacement === true ? ' selected' : ''}>Sim</option><option value="false"${resolution?.pcReplacement === false ? ' selected' : ''}>Não</option></select></label><label class="nfe-field">NF-e paga em POS?<select class="nfe-select" name="nfePaidPos" required><option value="">Selecione</option><option value="true"${resolution?.nfePaidPos === true ? ' selected' : ''}>Sim</option><option value="false"${resolution?.nfePaidPos === false ? ' selected' : ''}>Não</option></select></label></div><footer class="nfe-modal-actions"><button class="nfe-action-button" type="button" data-nfe-history-back>Voltar ao histórico</button><button class="nfe-action-button primary" type="submit">${actionLabel}</button></footer></form>`}</section>`;
    openModal(content);
    modal.querySelector('[data-nfe-history-back]')?.addEventListener('click', openInvestigationHistory);
    modal.querySelector('[data-nfe-resolution-form]')?.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = event.currentTarget.querySelector('[type="submit"]');
      submit.disabled = true;
      submit.textContent = 'Salvando…';
      try {
        const values = Object.fromEntries(new FormData(event.currentTarget));
        await api().saveInvestigationResolution(item.id, values);
        toast('Solução registrada e auditada no histórico Fiscal NF-e.');
        await openInvestigationHistory();
        refresh({ quiet: true });
      } catch (error) {
        submit.disabled = false;
        submit.textContent = actionLabel;
        toast(error.message || 'Não foi possível registrar a solução.', true);
      }
    });
  }

  async function openBackup() {
    if (!isAdmin()) return;
    try {
      const backups = await api().backups();
      openModal(`<section class="nfe-dialog small"><header class="nfe-dialog-head"><div><p class="nfe-dialog-eyebrow">Sistema de backup</p><h2>Backup Fiscal NF-e</h2><p>O snapshot preserva os registros e referências dos PDFs privados.</p></div><button class="nfe-dialog-close" type="button" data-nfe-close>×</button></header><button class="nfe-action-button primary" type="button" data-nfe-create-backup>◫ Criar backup agora</button><section class="nfe-log-list">${backups.length ? backups.map(backup => `<div class="nfe-log"><i>◫</i><div><b>${escape(backup.label)}</b><small>${dateTime(backup.created_at)}</small></div><button class="nfe-mini-button" type="button" data-nfe-restore="${backup.id}">Restaurar</button></div>`).join('') : '<p class="nfe-empty" style="padding:15px">Nenhum backup criado ainda.</p>'}</section></section>`);
      modal.querySelector('[data-nfe-create-backup]')?.addEventListener('click', async () => {
        try { await api().createBackup(); toast('Backup Fiscal NF-e criado com sucesso.'); openBackup(); }
        catch (error) { toast(error.message || 'Não foi possível criar o backup.', true); }
      });
      modal.querySelectorAll('[data-nfe-restore]').forEach(button => button.addEventListener('click', async () => {
        const backup = backups.find(row => row.id === button.dataset.nfeRestore);
        if (!backup || !window.confirm('Restaurar este backup substituirá as ocorrências atuais. Continuar?')) return;
        try { await api().restoreBackup(backup); closeModal(); toast('Backup restaurado. A Central Fiscal foi atualizada.'); refresh(); }
        catch (error) { toast(error.message || 'Não foi possível restaurar o backup.', true); }
      }));
    } catch (error) { toast(error.message || 'Não foi possível carregar os backups.', true); }
  }

  async function exportRows() {
    try { return await api().all(state.filters); }
    catch (error) { toast(error.message || 'Não foi possível exportar os registros.', true); return null; }
  }
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 700);
  }
  async function exportExcel() {
    const rows = await exportRows(); if (!rows) return;
    const columns = [['Número NF-e', 'nfeNumber'], ['PDV', 'pdv'], ['Operador', 'operator'], ['Código do operador', 'operatorCode'], ['Fiscal', 'fiscal'], ['Data/Hora', 'occurredAt'], ['Motivo', 'reason'], ['Observação', 'notes'], ['PDF', 'pdfName']];
    const csv = [columns.map(column => column[0]).join(';'), ...rows.map(row => columns.map(([, key]) => `"${String(key === 'occurredAt' ? dateTime(row[key]) : row[key] || '').replaceAll('"', '""')}"`).join(';'))].join('\n');
    download(`\ufeff${csv}`, `aldeckot-fiscal-nfe-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
    toast('Planilha exportada respeitando os filtros atuais.');
  }
  async function exportPdf() {
    const rows = await exportRows(); if (!rows) return;
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) return toast('O gerador de PDF não foi carregado. Tente novamente.', true);
    const pdf = new JsPdf({ unit: 'pt', format: 'a4' });
    pdf.setFillColor(7, 25, 43); pdf.rect(0, 0, 595, 88, 'F'); pdf.setTextColor(235, 248, 255); pdf.setFontSize(19); pdf.text('ALDECKOT · Fiscal NF-e', 40, 44); pdf.setFontSize(10); pdf.setTextColor(148, 191, 214); pdf.text(`Relatório gerado em ${dateTime(new Date())} · ${rows.length} ocorrência(s)`, 40, 65);
    let y = 112; pdf.setTextColor(32, 54, 76); pdf.setFontSize(9);
    rows.forEach((row, index) => { if (y > 760) { pdf.addPage(); y = 48; } pdf.setFont('helvetica', 'bold'); pdf.text(`${row.nfeNumber} · ${row.pdv}`, 40, y); pdf.setFont('helvetica', 'normal'); pdf.text(`${dateTime(row.occurredAt)}  |  ${row.operator}  |  ${row.fiscal}`, 40, y + 14); pdf.text(`${row.reason} — ${String(row.notes || 'Sem observação').slice(0, 94)}`, 40, y + 28); pdf.setDrawColor(205, 220, 232); pdf.line(40, y + 37, 555, y + 37); y += 52; });
    pdf.save(`aldeckot-fiscal-nfe-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast('PDF exportado respeitando os filtros atuais.');
  }

  async function initialize() {
    try {
      await (window.AldeckotAuthReady || Promise.resolve());
      if (!window.AldeckotAuth?.session) return;
      await window.AldeckotSupabase?.init?.();
      await refresh();
    } catch (error) {
      state.loading = false; state.error = error.message || 'Não foi possível iniciar o módulo.'; render(); window.AldeckotModuleStage?.reveal?.();
    }
  }
  window.addEventListener('aldeckot:realtime-change', event => {
    if (!['nfe_occurrences', 'nfe_occurrence_logs', 'nfe_investigation_resolutions', 'nfe_backups'].includes(event.detail?.table)) return;
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => refresh({ quiet: true }), 180);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeModal(); });
  initialize();
})();
