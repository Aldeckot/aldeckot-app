(() => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const route = page => window.AldeckotRoute?.navigate ? window.AldeckotRoute.navigate(page) : (window.location.href = page);
  let homeData = window.AldeckotHomeData || null;
  let refreshTimer;
  let animationTimer;
  const currentHomeData = () => window.AldeckotHomeData || homeData;

  const isMaintenanceOpen = item => {
    const status = normalize(item?.status);
    return status === 'em manutencao' || status === 'manutencao' || status === 'defeito';
  };
  const isTransferOpen = item => ['pendente', 'em transito'].includes(normalize(item?.status));
  const modulePages = { inventory: 'inventory.html', control: 'control.html', management: 'management.html', flux: 'flux.html', nfe: 'nfe.html' };

  const fallbackMetrics = source => {
    const inventory = (source?.inventory?.tables || []).flatMap(table => table.items || []);
    const control = (source?.control?.tables || []).flatMap(table => table.items || []);
    const management = source?.management?.items || [];
    const flux = (source?.flux?.tables || []).flatMap(table => table.items || []);
    return {
      inventoryTotal: inventory.length,
      inventoryActive: inventory.filter(item => normalize(item.status) === 'ativo').length,
      maintenanceOpen: [...control, ...management].filter(isMaintenanceOpen).length,
      transfersOpen: flux.filter(isTransferOpen).length,
      nfeMonth: (source?.nfeAlerts || []).length,
      agendaOverdue: 0,
      identityConflicts: 0
    };
  };

  // Os itens apresentados na Central precisam ser os mesmos que estão nas
  // tabelas visíveis dos módulos, mesmo se uma consulta consolidada estiver
  // momentaneamente defasada.
  const reconcileVisibleMetrics = metrics => {
    const source = currentHomeData();
    if (!source || source.error) return metrics;
    const visible = fallbackMetrics(source);
    return {
      ...metrics,
      inventoryTotal: visible.inventoryTotal,
      inventoryActive: visible.inventoryActive,
      maintenanceOpen: visible.maintenanceOpen,
      transfersOpen: visible.transfersOpen
    };
  };

  const metric = (key, label, value, tone, detail) => `<button class="operations-metric ${tone}" type="button" data-operations-metric="${key}" ${Number(value || 0) ? '' : 'disabled'}><small>${label}</small><strong>${Number(value || 0)}</strong><span>${detail}</span></button>`;

  function metricEntries(key) {
    const source = currentHomeData();
    if (!source || source.error) return [];
    const rows = [];
    const addTables = (module, predicate) => {
      (source[module]?.tables || []).forEach(table => {
        (table.items || []).filter(predicate).forEach(item => rows.push({ module, page: modulePages[module], tableId: table.id, tableName: table.name || 'Tabela', item }));
      });
    };
    if (key === 'inventory-active') addTables('inventory', item => normalize(item.status) === 'ativo');
    if (key === 'maintenance-open') {
      addTables('control', isMaintenanceOpen);
      const management = source.management || {};
      (management.items || []).filter(isMaintenanceOpen).forEach(item => rows.push({ module: 'management', page: modulePages.management, tableId: item.tableId || management.table?.id || '', tableName: management.table?.name || 'Gestão TI', item }));
    }
    if (key === 'transfers-open') addTables('flux', isTransferOpen);
    return rows;
  }

  const operationFor = key => ({
    'inventory-active': 'inventory-active',
    'maintenance-open': 'maintenance-open',
    'transfers-open': 'transfers-open'
  })[key] || '';

  function targetForEntry(entry, key, openItem = false) {
    const params = new URLSearchParams();
    if (entry.tableId && entry.module !== 'management') params.set('table', entry.tableId);
    if (openItem && entry.item?.id) params.set('item', entry.item.id);
    else if (operationFor(key)) params.set('operation', operationFor(key));
    const query = params.toString();
    return `${entry.page}${query ? `?${query}` : ''}`;
  }

  function closeTargetPicker() {
    document.querySelector('[data-operations-target-picker]')?.remove();
  }

  function chooseTarget(key, entries) {
    const groups = [...entries.reduce((map, entry) => {
      const groupKey = `${entry.module}:${entry.tableId || 'main'}`;
      const group = map.get(groupKey) || { ...entry, items: [] };
      group.items.push(entry.item);
      map.set(groupKey, group);
      return map;
    }, new Map()).values()];

    if (groups.length === 1) return route(targetForEntry(groups[0], key));

    closeTargetPicker();
    const picker = document.createElement('section');
    picker.className = 'operations-target-picker';
    picker.dataset.operationsTargetPicker = 'true';
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-modal', 'true');
    picker.setAttribute('aria-label', 'Selecionar tabela');
    picker.innerHTML = `<div class="operations-target-dialog"><header><div><small>Central de Operações</small><h3>Selecione a tabela para abrir</h3></div><button type="button" data-operations-picker-close aria-label="Fechar">×</button></header><p>Há itens em mais de uma tabela.</p><div class="operations-target-list">${groups.map(group => `<button type="button" data-operations-target="${escape(targetForEntry(group, key))}"><b>${escape(({ inventory: 'Inventário', control: 'Controle TI', management: 'Gestão TI', flux: 'Flux' })[group.module] || 'Módulo')} · ${escape(group.tableName)}</b><span>${group.items.length} ${group.items.length === 1 ? 'item' : 'itens'} encontrado${group.items.length === 1 ? '' : 's'} ›</span></button>`).join('')}</div></div>`;
    document.body.appendChild(picker);
    picker.querySelector('[data-operations-picker-close]')?.addEventListener('click', closeTargetPicker);
    picker.addEventListener('click', event => {
      if (event.target === picker) closeTargetPicker();
      const target = event.target.closest('[data-operations-target]')?.dataset.operationsTarget;
      if (target) route(target);
    });
  }

  async function openNfeMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    try {
      const items = await window.AldeckotSupabase?.nfe?.all?.({ dateFrom: start, dateTo: end });
      if (items?.length === 1) return route(`nfe.html?item=${encodeURIComponent(items[0].id)}`);
    } catch (error) {
      console.warn('Não foi possível detalhar as ocorrências fiscais:', error);
    }
    route(`nfe.html?dateFrom=${encodeURIComponent(start)}&dateTo=${encodeURIComponent(end)}`);
  }

  function openMetric(key) {
    if (key === 'nfe-month') return openNfeMonth();
    const entries = metricEntries(key);
    if (entries.length === 1) return route(targetForEntry(entries[0], key, true));
    if (entries.length > 1) return chooseTarget(key, entries);
    const fallback = { 'inventory-active': 'inventory.html', 'maintenance-open': 'control.html', 'transfers-open': 'flux.html' }[key];
    if (fallback) route(fallback);
  }

  function publishAlerts(metrics) {
    const alerts = [
      metrics.agendaOverdue ? {
        id: 'agenda-overdue', count: Number(metrics.agendaOverdue), level: 'Alta', urgent: true,
        title: `${metrics.agendaOverdue} tarefa(s) ou evento(s) aguardam conclusão`,
        description: 'Há atividades vencidas que ainda não foram marcadas como concluídas.', targetUrl: 'index.html'
      } : null,
      metrics.maintenanceOpen ? {
        id: 'maintenance-open', count: Number(metrics.maintenanceOpen), level: 'Alta', urgent: true,
        title: `${metrics.maintenanceOpen} equipamento(s) em manutenção ou com defeito`,
        description: 'Acompanhe os itens abertos no Controle TI e na Gestão TI.', targetUrl: 'control.html'
      } : null,
      metrics.transfersOpen ? {
        id: 'transfers-open', count: Number(metrics.transfersOpen), level: 'Média', urgent: false,
        title: `${metrics.transfersOpen} transferência(s) ainda em andamento`,
        description: 'Existem movimentações pendentes ou em trânsito no Flux.', targetUrl: 'flux.html'
      } : null,
      metrics.identityConflicts ? {
        id: 'identity-conflicts', count: Number(metrics.identityConflicts), level: 'Alta', urgent: true,
        title: `${metrics.identityConflicts} conflito(s) de TAG ou número de série`,
        description: 'Revise os identificadores duplicados na área de Integrações.', targetUrl: 'settings.html#integrations'
      } : null
    ].filter(Boolean);
    window.AldeckotOperationalAlerts = alerts;
    window.dispatchEvent(new CustomEvent('aldeckot:operational-alerts', { detail: { alerts } }));
  }

  const render = (metrics, isFallback = false, animate = false) => {
    const host = document.querySelector('[data-operational-dashboard]');
    if (!host) return;
    host.innerHTML = `<header class="operations-heading"><div><span>▥</span><div><h2>Central de Operações</h2><p>${isFallback ? 'Indicadores carregados da visão atual.' : 'Indicadores consolidados em tempo real.'}</p></div></div><button class="operations-refresh" type="button" data-operations-refresh title="Atualizar indicadores">↻ Atualizar</button></header><div class="operations-metrics">${metric('inventory-active', 'Equipamentos ativos', metrics.inventoryActive, 'active', `de ${metrics.inventoryTotal || 0} no inventário`)}${metric('maintenance-open', 'Manutenções abertas', metrics.maintenanceOpen, 'warn', 'Controle TI e Gestão TI')}${metric('transfers-open', 'Transferências em curso', metrics.transfersOpen, 'info', 'Flux pendente ou em trânsito')}${metric('nfe-month', 'Ocorrências fiscais', metrics.nfeMonth, 'violet', 'registradas neste mês')}</div>`;
    host.querySelectorAll('[data-operations-metric]').forEach(button => button.addEventListener('click', () => openMetric(button.dataset.operationsMetric)));
    host.querySelector('[data-operations-refresh]')?.addEventListener('click', () => load({ animate: true }));
    publishAlerts(metrics);
    if (animate) {
      window.clearTimeout(animationTimer);
      host.classList.remove('is-updating');
      void host.offsetWidth;
      host.classList.add('is-updating');
      animationTimer = window.setTimeout(() => host.classList.remove('is-updating'), 950);
    }
  };

  async function load({ animate = false } = {}) {
    if (!currentHomeData() && window.AldeckotHomeDataReady) await window.AldeckotHomeDataReady;
    const api = window.AldeckotSupabase;
    if (!api?.operations) return render(fallbackMetrics(currentHomeData()), true, animate);
    try {
      const metrics = await api.operations.dashboard();
      render(metrics ? reconcileVisibleMetrics(metrics) : fallbackMetrics(currentHomeData()), !metrics, animate);
    } catch (error) {
      console.warn('Indicadores operacionais indisponíveis:', error);
      render(fallbackMetrics(currentHomeData()), true, animate);
    }
  }

  const addPanel = () => {
    const slot = document.querySelector('[data-home-operations-slot]');
    if (!slot || slot.querySelector('[data-operational-dashboard]')) return false;
    const panel = document.createElement('section');
    panel.className = 'operations-panel';
    panel.dataset.operationalDashboard = 'true';
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<p class="operations-loading">Carregando indicadores operacionais…</p>';
    slot.appendChild(panel);
    return true;
  };

  const restorePanel = () => {
    if (addPanel()) load();
  };

  window.addEventListener('aldeckot:home-data', event => {
    homeData = event.detail || homeData;
    restorePanel();
    load();
  });
  window.addEventListener('aldeckot:home-recent-rendered', restorePanel);
  window.addEventListener('aldeckot:realtime-change', event => {
    if (!['inventory_items', 'control_items', 'module_records', 'flux_items', 'nfe_occurrences', 'agenda_entries', 'sync_events', 'equipment_identity_conflict_resolutions'].includes(event.detail?.table)) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => load({ animate: true }), 250);
  });
  restorePanel();
})();
