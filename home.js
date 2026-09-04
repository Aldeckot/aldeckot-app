(() => {
  const releaseHomeRender = window.AldeckotHomeStage?.hold?.('recent-items');
  let homeRenderReleased = false;
  const completeHomeRender = () => {
    if (homeRenderReleased) return;
    homeRenderReleased = true;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => releaseHomeRender?.()));
  };
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const statusClass = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-');
  const navigateTo = target => {
    if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate(target);
    else window.location.href = target;
  };
  const latestLogText = entry => {
    if (entry.description) return entry.description;
    const logEntry = Array.isArray(entry.logs) ? entry.logs[0] : null;
    if (!logEntry) return 'Nenhum registro no histórico.';
    if (typeof logEntry === 'string') return logEntry;
    return logEntry.text || logEntry.message || logEntry.action || 'Registro atualizado.';
  };
  const moduleInfo = module => ({
    inventory: { label: 'Inventário', page: 'inventory.html' },
    management: { label: 'Gestão TI', page: 'management.html' },
    control: { label: 'Controle TI', page: 'control.html' },
    flux: { label: 'Flux', page: 'flux.html' },
    nfe: { label: 'Fiscal NF-e', page: 'nfe.html' }
  })[module] || { label: 'Módulo', page: '' };
  const activityTime = entry => entry.occurredAt || entry.updatedAt || entry.date || '';
  const itemKey = entry => `${entry.module || 'inventory'}:${entry.id || ''}`;
  const itemTarget = entry => {
    const page = moduleInfo(entry.module).page;
    if (!page || !entry.tableId) return '';
    const query = new URLSearchParams({ table: entry.tableId });
    if (entry.id) query.set('item', entry.id);
    return `${page}?${query.toString()}`;
  };
  const itemEntry = (module, table, item) => ({
    ...item,
    module,
    tableId: table.id,
    tableName: `${moduleInfo(module).label} · ${table.name}`,
    occurredAt: item.updatedAt || item.date || '',
    targetUrl: itemTarget({ ...item, module, tableId: table.id })
  });
  const eventEntry = event => {
    const details = event.details || {};
    const module = event.module || 'inventory';
    const targetUrl = details.targetUrl || '';
    if (!details.itemId || !details.equipment || !targetUrl) return null;
    return {
      id: details.itemId,
      module,
      tableId: details.tableId || '',
      tableName: `${moduleInfo(module).label} · ${details.tableName || 'Tabela'}`,
      equipment: details.equipment,
      brand: details.brand || '',
      tag: details.tag || '',
      status: details.status || 'Ativo',
      description: details.description || 'Registro atualizado.',
      occurredAt: event.created_at || '',
      targetUrl
    };
  };

  function updateClock() {
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderRecentItems(items) {
    const panel = document.querySelector('[data-home-recent-items]');
    if (!panel) return;
    if (!items.length) {
      panel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Todos os módulos</p></div></div><p class="home-recent-empty">Nenhum equipamento adicionado ou editado ainda.</p>`;
      return;
    }
    panel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Todos os módulos · clique para abrir</p></div></div><div class="home-recent-list">${items.map(entry => `<button class="home-recent-item" type="button" data-home-recent-target="${escape(entry.targetUrl)}"><span class="home-recent-main"><b>${escape(entry.equipment || 'Equipamento sem nome')}</b><small>${escape(entry.brand || 'Marca não informada')} · TAG ${escape(entry.tag || '—')}</small></span><span class="home-recent-log" title="${escape(latestLogText(entry))}"><i>Último log</i><b>${escape(latestLogText(entry))}</b></span><span class="home-recent-meta"><em>${escape(entry.tableName)}</em><i class="home-recent-status ${statusClass(entry.status)}">${escape(entry.status || 'Ativo')}</i></span></button>`).join('')}</div>`;
    panel.querySelectorAll('[data-home-recent-target]').forEach(button => {
      button.addEventListener('click', () => openRecentItem(button.dataset.homeRecentTarget));
    });
  }

  async function loadRecentItems() {
    const panel = document.querySelector('[data-home-recent-items]');
    const api = window.AldeckotSupabase;
    try {
      await (window.AldeckotAuthReady || Promise.resolve());
      if (!window.AldeckotAuth?.session) return;
      if (!panel || !api) {
        renderRecentItems([]);
        return;
      }
      await (window.AldeckotHomeStage?.ready?.() || api.init?.() || Promise.resolve());
      const [inventoryResult, managementResult, controlResult, fluxResult, nfeAlertResult, eventsResult] = await Promise.allSettled([
        api.inventory.load(),
        api.management?.load?.() || Promise.resolve({ table: null, items: [] }),
        api.control?.load?.() || Promise.resolve({ tables: [] }),
        api.flux?.load?.() || Promise.resolve({ tables: [] }),
        api.nfe?.recurringPdvAlerts?.() || Promise.resolve([]),
        api.events?.recentActivity?.(12) || Promise.resolve([])
      ]);
      const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value : { tables: [] };
      const management = managementResult.status === 'fulfilled' ? managementResult.value : { table: null, items: [] };
      const control = controlResult.status === 'fulfilled' ? controlResult.value : { tables: [] };
      const flux = fluxResult.status === 'fulfilled' ? fluxResult.value : { tables: [] };
      const nfeAlerts = nfeAlertResult.status === 'fulfilled' ? nfeAlertResult.value : [];
      window.dispatchEvent(new CustomEvent('aldeckot:home-data', { detail: { inventory, management, control, flux, nfeAlerts } }));
      const storedEvents = eventsResult.status === 'fulfilled' ? eventsResult.value : [];
      const activityEvents = (storedEvents || []).map(eventEntry).filter(Boolean);
      const updatedKeys = new Set(activityEvents.map(itemKey));
      const currentItems = [
        ...(inventory.tables || []).flatMap(table => (table.items || []).map(item => itemEntry('inventory', table, item))),
        ...(management.items || []).map(item => itemEntry('management', { id: item.tableId || management.table?.id || '', name: management.table?.name || 'Infraestrutura ALDECKOT' }, item)),
        ...(control.tables || []).flatMap(table => (table.items || []).map(item => itemEntry('control', table, item))),
        ...(flux.tables || []).flatMap(table => (table.items || []).map(item => itemEntry('flux', table, item)))
      ].filter(entry => !updatedKeys.has(itemKey(entry)));
      const recentItems = [...activityEvents, ...currentItems]
        .sort((first, second) => String(activityTime(second)).localeCompare(String(activityTime(first))))
        .slice(0, 3);
      renderRecentItems(recentItems);
    } catch (error) {
      console.warn('Atualizações recentes indisponíveis:', error.message || error);
      window.dispatchEvent(new CustomEvent('aldeckot:home-data', { detail: { error: true } }));
      renderRecentItems([]);
    } finally {
      completeHomeRender();
    }
  }

  function openRecentInventoryItem(tableId, itemId) {
    navigateTo(`inventory.html?table=${encodeURIComponent(tableId)}&item=${encodeURIComponent(itemId)}`);
  }
  function openRecentItem(targetUrl) {
    if (targetUrl) navigateTo(targetUrl);
  }

  updateClock();
  window.setInterval(updateClock, 30000);
  window.openRecentInventoryItem = openRecentInventoryItem;
  window.openRecentItem = openRecentItem;

  window.go = module => {
    if (module === 'inventory') navigateTo('inventory.html');
    else if (module === 'management') navigateTo('management.html');
    else if (module === 'control') navigateTo('control.html');
    else if (module === 'flux') navigateTo('flux.html');
    else if (module === 'nfe') navigateTo('nfe.html');
    else window.alert('A interface deste módulo será conectada às tabelas próprias do Supabase na próxima etapa.');
  };

  const moduleCardIcon = {
    inventory: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 7 9-4 9 4-9 4-9-4Z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/><path d="M16.5 14.2h2.7v3.2h-2.7z"/></svg>',
    management: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="4.2"/><path d="M14.9 9.1 21 3l-2 6.1 2 2-6.1 6.1"/></svg>',
    control: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M6.5 11.2h2l1.4-3.1 2.2 6 1.6-3h2.8"/></svg>',
    flux: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13M14 3l4 4-4 4M20 17H7M10 13l-4 4 4 4"/><rect x="2.5" y="4" width="3" height="6" rx="1"/><rect x="18.5" y="14" width="3" height="6" rx="1"/></svg>',
    nfe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8.5 12h7M8.5 16h7"/><path d="M4 7v12a2 2 0 0 0 2 2h8"/></svg>'
  };
  const moduleCards = [
    { id: 'inventory', title: 'Inventário', description: 'Controle de equipamentos, patrimônio e localização.', tags: ['Patrimônio', 'Localização', 'Status'] },
    { id: 'management', title: 'Gestão TI', description: 'Central de manutenção e gestão de chamados.', tags: ['Manutenção', 'Chamados', 'Equipe'] },
    { id: 'control', title: 'Controle TI', description: 'Monitoramento de PCs ativos em tempo real.', tags: ['Monitoramento', 'Status', 'Desempenho'] },
    { id: 'flux', title: 'Flux', description: 'Envio e recebimento de equipamentos.', tags: ['Transferência', 'Recebimento', 'Histórico'] },
    { id: 'nfe', title: 'Fiscal NF-e', description: 'Registro e consulta de notas fiscais e cupons.', tags: ['NF-e', 'Cupom fiscal', 'Auditoria'] }
  ];
  const renderModuleCards = navigation => {
    navigation.innerHTML = moduleCards.map(card => `
      <button class="module-nav-card module-${card.id}" type="button" data-module-card="${card.id}" ${card.id === 'nfe' ? 'data-home-nfe-module="true"' : ''}>
        <span class="module-card-icon">${moduleCardIcon[card.id]}</span>
        <span class="module-card-copy"><b>${card.title}</b><small>${card.description}</small><span class="module-card-tags">${card.tags.map(tag => `<i>${tag}</i>`).join('')}</span></span>
        <span class="module-card-art" aria-hidden="true"></span>
        <span class="module-card-arrow" aria-hidden="true">›</span>
      </button>`).join('');
    navigation.querySelectorAll('[data-module-card]').forEach(button => {
      button.addEventListener('click', () => window.go(button.dataset.moduleCard));
    });
  };

  const homeNavigation = document.getElementById('nav');
  if (homeNavigation) renderModuleCards(homeNavigation);

  const homeReference = document.querySelector('.home-reference');
  if (homeReference) {
    const recentPanel = document.createElement('section');
    recentPanel.className = 'home-recent-panel';
    recentPanel.dataset.homeRecentItems = 'true';
    recentPanel.setAttribute('aria-live', 'polite');
    recentPanel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Carregando atualizações…</p></div></div>`;
    homeReference.appendChild(recentPanel);
    loadRecentItems();
  } else completeHomeRender();
  let homeRealtimeTimer;
  window.addEventListener('aldeckot:realtime-change', event => {
    if (!['module_tables', 'inventory_items', 'inventory_item_logs', 'module_records', 'control_items', 'control_item_logs', 'flux_items', 'flux_item_logs', 'nfe_occurrences', 'sync_events'].includes(event.detail?.table)) return;
    window.clearTimeout(homeRealtimeTimer);
    homeRealtimeTimer = window.setTimeout(loadRecentItems, 180);
  });
})();
