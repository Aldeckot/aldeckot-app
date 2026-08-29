(() => {
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const statusClass = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '-');
  const latestLogText = entry => {
    const logEntry = Array.isArray(entry.logs) ? entry.logs[0] : null;
    if (!logEntry) return 'Nenhum registro no histórico.';
    if (typeof logEntry === 'string') return logEntry;
    return logEntry.text || logEntry.message || logEntry.action || 'Registro atualizado.';
  };

  function updateClock() {
    const clock = document.getElementById('clock');
    if (clock) clock.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderRecentItems(items) {
    const panel = document.querySelector('[data-home-recent-items]');
    if (!panel) return;
    if (!items.length) {
      panel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Inventário</p></div></div><p class="home-recent-empty">Nenhum equipamento adicionado ou editado ainda.</p>`;
      return;
    }
    panel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Inventário · clique para abrir</p></div></div><div class="home-recent-list">${items.map(entry => `<button class="home-recent-item" type="button" data-home-recent-table="${escape(entry.tableId)}" data-home-recent-item="${escape(entry.id)}"><span class="home-recent-main"><b>${escape(entry.equipment || 'Equipamento sem nome')}</b><small>${escape(entry.brand || 'Marca não informada')} · TAG ${escape(entry.tag || '—')}</small></span><span class="home-recent-log" title="${escape(latestLogText(entry))}"><i>Último log</i><b>${escape(latestLogText(entry))}</b></span><span class="home-recent-meta"><em>${escape(entry.tableName)}</em><i class="home-recent-status ${statusClass(entry.status)}">${escape(entry.status || 'Ativo')}</i></span></button>`).join('')}</div>`;
    panel.querySelectorAll('[data-home-recent-item]').forEach(button => {
      button.addEventListener('click', () => openRecentInventoryItem(button.dataset.homeRecentTable, button.dataset.homeRecentItem));
    });
  }

  async function loadRecentItems() {
    const panel = document.querySelector('[data-home-recent-items]');
    const api = window.AldeckotSupabase;
    if (!panel || !api) return;
    try {
      const inventory = await api.inventory.load();
      const recentItems = (inventory.tables || []).flatMap(table => (table.items || []).map(item => ({ ...item, tableId: table.id, tableName: table.name })))
        .sort((first, second) => String(second.updatedAt || second.date || '').localeCompare(String(first.updatedAt || first.date || '')))
        .slice(0, 3);
      renderRecentItems(recentItems);
    } catch (error) {
      panel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Inventário</p></div></div><p class="home-recent-empty">Os últimos itens estarão disponíveis quando o Inventário for conectado.</p>`;
    }
  }

  function openRecentInventoryItem(tableId, itemId) {
    window.location.href = `inventory.html?table=${encodeURIComponent(tableId)}&item=${encodeURIComponent(itemId)}`;
  }

  updateClock();
  window.setInterval(updateClock, 30000);
  window.openRecentInventoryItem = openRecentInventoryItem;

  window.go = module => {
    if (module === 'inventory') window.location.href = 'inventory.html';
    else window.alert('A interface deste módulo será conectada às tabelas próprias do Supabase na próxima etapa.');
  };

  const homeReference = document.querySelector('.home-reference');
  if (homeReference) {
    const recentPanel = document.createElement('section');
    recentPanel.className = 'home-recent-panel';
    recentPanel.dataset.homeRecentItems = 'true';
    recentPanel.setAttribute('aria-live', 'polite');
    recentPanel.innerHTML = `<div class="home-recent-heading"><span class="home-recent-icon">◈</span><div><h2>Últimos itens atualizados</h2><p>Carregando Inventário…</p></div></div>`;
    homeReference.appendChild(recentPanel);
    loadRecentItems();
  }
})();
