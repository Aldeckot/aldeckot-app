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
    flux: { label: 'Flux', page: 'flux.html' }
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
      const [inventoryResult, managementResult, controlResult, fluxResult, eventsResult] = await Promise.allSettled([
        api.inventory.load(),
        api.management?.load?.() || Promise.resolve({ table: null, items: [] }),
        api.control?.load?.() || Promise.resolve({ tables: [] }),
        api.flux?.load?.() || Promise.resolve({ tables: [] }),
        api.events?.recentActivity?.(12) || Promise.resolve([])
      ]);
      const inventory = inventoryResult.status === 'fulfilled' ? inventoryResult.value : { tables: [] };
      const management = managementResult.status === 'fulfilled' ? managementResult.value : { table: null, items: [] };
      const control = controlResult.status === 'fulfilled' ? controlResult.value : { tables: [] };
      const flux = fluxResult.status === 'fulfilled' ? fluxResult.value : { tables: [] };
      window.dispatchEvent(new CustomEvent('aldeckot:home-data', { detail: { inventory, management, control, flux } }));
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
    window.location.href = `inventory.html?table=${encodeURIComponent(tableId)}&item=${encodeURIComponent(itemId)}`;
  }
  function openRecentItem(targetUrl) {
    if (targetUrl) window.location.href = targetUrl;
  }

  updateClock();
  window.setInterval(updateClock, 30000);
  window.openRecentInventoryItem = openRecentInventoryItem;
  window.openRecentItem = openRecentItem;

  window.go = module => {
    if (module === 'inventory') window.location.href = 'inventory.html';
    else if (module === 'management') window.location.href = 'management.html';
    else if (module === 'control') window.location.href = 'control.html';
    else if (module === 'flux') window.location.href = 'flux.html';
    else window.alert('A interface deste módulo será conectada às tabelas próprias do Supabase na próxima etapa.');
  };

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
    if (!['module_tables', 'inventory_items', 'inventory_item_logs', 'module_records', 'control_items', 'control_item_logs', 'flux_items', 'flux_item_logs', 'sync_events'].includes(event.detail?.table)) return;
    window.clearTimeout(homeRealtimeTimer);
    homeRealtimeTimer = window.setTimeout(loadRecentItems, 180);
  });
})();
