(() => {
  const key = document.body.classList.contains('nfe-open') ? 'nfe'
    : document.body.classList.contains('management-open') ? 'management'
      : (document.body.dataset.module || 'inventory');
  const labels = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', flux: 'Flux', nfe: 'Fiscal NF-e' };
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dateValue = value => {
    const time = new Date(value || '').getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const daysSince = value => {
    const time = dateValue(value);
    return time ? Math.max(0, Math.floor((Date.now() - time) / 86400000)) : 0;
  };
  const bell = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
  let root;
  let panel;
  let notifications = [];
  let dismissed = new Set();
  let acknowledgementsLoaded = false;
  let loading = true;
  let error = false;
  let refreshTimer = 0;

  const notificationKey = notification => {
    const item = notification.item;
    const identity = item.id || item.tag || item.serial || item.equipment;
    return `${key}:${identity}:${normalize(item.status)}:${normalize(item.priority)}:${item.updatedAt || item.createdAt || item.date || ''}`;
  };

  function createRoot() {
    if (root) return;
    root = document.createElement('section');
    root.className = 'module-notification-center';
    root.dataset.moduleNotifications = key;
    root.innerHTML = `<section class="module-notification-panel" data-module-notification-panel hidden><header><div><p>Central de Notificações</p><h2>${escape(labels[key])}</h2></div><div class="module-notification-head-actions"><span data-module-notification-count>Carregando…</span><button type="button" class="module-notification-clear" data-module-notification-clear title="Limpar notificações" aria-label="Limpar notificações">×</button></div></header><div class="module-notification-list" data-module-notification-list><div class="module-notification-loading"><i></i>Verificando alertas do módulo…</div></div></section>`;
    document.body.append(root);
    panel = root.querySelector('[data-module-notification-panel]');
  }

  function moduleHeader() {
    if (key === 'nfe') return document.querySelector('.nfe-header');
    return document.querySelector(key === 'management' ? '.management-header' : '.inventory-header');
  }

  function ensureMascotDock() {
    if (key === 'nfe') return document.querySelector('.nfe-mascot-dock');
    const header = moduleHeader();
    if (!header) return null;
    let dock = header.querySelector('[data-module-mascot-dock]');
    if (dock) return dock;
    dock = document.createElement('span');
    dock.className = `module-mascot-dock module-mascot-dock-${key}`;
    dock.dataset.moduleMascotDock = 'true';
    dock.setAttribute('aria-label', 'Mascote ALDECKOT');
    dock.innerHTML = '<img class="module-mascot-image" src="assets/mascot-dark.png" alt="" aria-hidden="true">';
    const heading = header.querySelector(key === 'management' ? '.management-heading' : '.inventory-heading');
    if (heading) heading.insertAdjacentElement('afterend', dock);
    else header.prepend(dock);
    return dock;
  }

  function ensureToggle() {
    createRoot();
    let toggle = document.querySelector(key === 'nfe' ? '[data-nfe-notifications]' : '[data-module-notifications]');
    if (!toggle) {
      const dock = ensureMascotDock();
      if (!dock) return;
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'module-notification-toggle module-mascot-notification';
      toggle.dataset.moduleNotifications = 'true';
      toggle.title = 'Central de notificações';
      toggle.setAttribute('aria-label', 'Abrir Central de notificações');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = `${bell}<span class="module-notification-badge" hidden></span>`;
      dock.append(toggle);
    }
    toggle.dataset.moduleNotificationToggle = 'true';
    toggle.setAttribute('aria-controls', 'moduleNotificationsPanel');
    if (!toggle.querySelector('.module-notification-badge')) {
      const badge = document.createElement('span');
      badge.className = 'module-notification-badge';
      badge.hidden = true;
      toggle.append(badge);
    }
    updateToggle(toggle);
  }

  function toggles() {
    return [...document.querySelectorAll(key === 'nfe' ? '[data-nfe-notifications]' : '[data-module-notifications]')];
  }

  function updateToggle(toggle) {
    const badge = toggle.querySelector('.module-notification-badge');
    if (!badge) return;
    const visible = notifications.length > 0 && !error;
    toggle.hidden = !visible;
    toggle.setAttribute('aria-hidden', String(!visible));
    badge.hidden = !notifications.length;
    badge.textContent = notifications.length;
    toggle.dataset.hasNotifications = String(Boolean(notifications.length));
    toggle.dataset.hasUrgent = String(notifications.some(notification => notification.urgent));
    toggle.setAttribute('aria-label', notifications.length ? `Abrir ${notifications.length} alertas de ${labels[key]}` : `Abrir Central de notificações de ${labels[key]}`);
  }

  function render() {
    createRoot();
    ensureToggle();
    const list = root.querySelector('[data-module-notification-list]');
    const counter = root.querySelector('[data-module-notification-count]');
    const clear = root.querySelector('[data-module-notification-clear]');
    counter.textContent = error ? 'Atualização indisponível' : (notifications.length ? `${notifications.length} alerta${notifications.length === 1 ? '' : 's'} prioritário${notifications.length === 1 ? '' : 's'}` : 'Sem alertas pendentes');
    clear.hidden = !notifications.length;
    if (error) {
      list.innerHTML = '<div class="module-notification-empty"><span>!</span><div><b>Atualização indisponível</b><p>Não foi possível consultar os alertas deste módulo.</p></div></div>';
    } else if (loading) {
      list.innerHTML = '<div class="module-notification-loading"><i></i>Verificando alertas do módulo…</div>';
    } else if (!notifications.length) {
      list.innerHTML = '<div class="module-notification-empty"><span>✓</span><div><b>Tudo acompanhado</b><p>Nenhum item deste módulo exige atenção agora.</p></div></div>';
    } else {
      list.innerHTML = notifications.map((notification, index) => {
        const item = notification.item;
        const identifiers = key === 'nfe'
          ? `PDV ${item.pdv || 'não informado'} · ${notification.occurrences || '4+'} ocorrências na semana`
          : ([item.tag && `TAG ${item.tag}`, item.serial && `Série ${item.serial}`].filter(Boolean).join(' · ') || 'TAG e série não informadas');
        return `<button class="module-notification-item${notification.urgent ? ' is-urgent' : ''}" type="button" data-module-notification-item="${index}" data-level="${notification.level.toLowerCase()}"><span class="module-notification-item-head"><span><b>${escape(item.equipment || 'Equipamento sem nome')}</b><small>${escape(identifiers)}</small></span><em>${escape(notification.level)}</em></span><span class="module-notification-description">${escape(notification.description)}</span>${notification.urgent ? '<span class="module-notification-urgent">⚠ Atenção urgente</span>' : ''}<span class="module-notification-module">${escape(labels[key])}<i>›</i></span></button>`;
      }).join('');
      list.querySelectorAll('[data-module-notification-item]').forEach(button => button.addEventListener('click', () => openNotification(notifications[Number(button.dataset.moduleNotificationItem)])));
    }
    toggles().forEach(updateToggle);
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    panel.classList.remove('is-open');
    toggles().forEach(toggle => { toggle.dataset.open = 'false'; toggle.setAttribute('aria-expanded', 'false'); });
  }

  function togglePanel() {
    createRoot();
    if (!notifications.length || error) return closePanel();
    if (!panel.hidden) return closePanel();
    panel.hidden = false;
    panel.classList.add('is-open');
    toggles().forEach(toggle => { toggle.dataset.open = 'true'; toggle.setAttribute('aria-expanded', 'true'); });
  }

  async function hydrateAcknowledgements(force = false) {
    if (acknowledgementsLoaded && !force) return;
    const source = window.AldeckotSupabase?.notificationAcknowledgements;
    if (!source?.list) return;
    const rows = await source.list();
    dismissed = new Set(rows.map(row => row.state_key).filter(Boolean));
    acknowledgementsLoaded = true;
  }

  function acknowledge(notification) {
    if (!notification) return;
    const stateKey = notificationKey(notification);
    dismissed.add(stateKey);
    notifications = notifications.filter(entry => notificationKey(entry) !== stateKey);
    render();
    const request = window.AldeckotSupabase?.notificationAcknowledgements?.acknowledge({ module: key, itemId: notification.item.id, stateKey });
    request?.catch?.(requestError => {
      dismissed.delete(stateKey);
      console.warn('Não foi possível reconhecer a notificação do módulo.', requestError);
      refresh();
    });
  }

  function clear() { [...notifications].forEach(acknowledge); }

  function notificationFor(item) {
    const priority = normalize(item.priority);
    const status = normalize(item.status);
    const age = daysSince(item.updatedAt || item.createdAt || item.date);
    if (priority === 'alta' && /manutenc/.test(status) && age > 3) return { item, level: 'Alta', weight: 200 + age, urgent: true, description: `Em manutenção há ${age} dias sem resposta.` };
    if (priority === 'media' && /atenc/.test(status) && age > 5) return { item, level: 'Média', weight: 100 + age, urgent: false, description: `Em atenção há ${age} dias; acompanhamento necessário.` };
    return null;
  }

  function itemEntries(payload) {
    if (key === 'management') return (payload?.items || []).map(item => ({ ...item, module: key, updatedAt: item.updatedAt || item.date || '' }));
    return (payload?.tables || []).flatMap(table => (table.items || []).map(item => ({ ...item, module: key, tableId: table.id, tableName: table.name, updatedAt: item.updatedAt || item.date || item.sendDate || '' })));
  }

  async function fetchNotifications() {
    const api = window.AldeckotSupabase;
    if (!api) return [];
    await api.init?.();
    if (key === 'nfe') {
      const alerts = await api.nfe?.recurringPdvAlerts?.() || [];
      return alerts.map(alert => ({
        item: { id: alert.id, module: key, equipment: `PDV ${alert.pdv}`, pdv: alert.pdv, updatedAt: alert.latestAt },
        level: 'Alta', weight: 260 + Number(alert.occurrences || 0), urgent: true, occurrences: Number(alert.occurrences || 0),
        description: `${alert.occurrences} ocorrências neste PDV nesta semana. Investigação recomendada.`
      }));
    }
    const source = api[key];
    const payload = await source?.load?.();
    return itemEntries(payload).map(notificationFor).filter(Boolean).sort((first, second) => second.weight - first.weight);
  }

  async function refresh() {
    loading = true;
    error = false;
    render();
    try {
      const all = await fetchNotifications();
      await hydrateAcknowledgements();
      notifications = all.filter(notification => !dismissed.has(notificationKey(notification))).slice(0, 4);
    } catch (refreshError) {
      console.warn('Não foi possível atualizar a Central de Notificações do módulo.', refreshError);
      error = true;
      notifications = [];
    } finally {
      loading = false;
      render();
    }
  }

  function openNotification(notification) {
    if (!notification) return;
    acknowledge(notification);
    closePanel();
    const item = notification.item;
    if (key === 'nfe') window.AldeckotNfeOpenDetails?.(item.id);
    else if (key === 'management') window.AldeckotManagementOpenDetails?.(item.id);
    else window.AldeckotInventoryOpenDetails?.({ id: item.id, tableId: item.tableId });
  }

  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-nfe-notifications], [data-module-notifications]');
    if (toggle) { event.preventDefault(); event.stopPropagation(); togglePanel(); return; }
    if (!root?.contains(event.target)) closePanel();
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  document.addEventListener('click', event => { if (event.target.closest('[data-module-notification-clear]')) clear(); });
  new MutationObserver(() => window.requestAnimationFrame(ensureToggle)).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('aldeckot:realtime-change', event => {
    const relevant = key === 'nfe'
      ? ['nfe_occurrences', 'nfe_investigation_resolutions', 'notification_acknowledgements']
      : key === 'management'
        ? ['module_records', 'notification_acknowledgements']
        : ['module_tables', `${key}_items`, 'notification_acknowledgements'];
    if (!relevant.includes(event.detail?.table)) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => refresh(), 180);
  });

  ensureToggle();
  window.addEventListener('aldeckot:auth-ready', refresh, { once: true });
  (window.AldeckotAuthReady || Promise.resolve()).then(refresh).catch(() => {});
})();
