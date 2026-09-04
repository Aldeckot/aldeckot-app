(() => {
  const moduleInfo = module => ({
    inventory: 'Inventário',
    management: 'Gestão TI',
    control: 'Controle TI',
    flux: 'Flux',
    nfe: 'Fiscal NF-e'
  })[module] || 'Módulo';
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
  let root;
  let button;
  let panel;
  let badge;
  let notifications = [];
  let allNotifications = [];
  let dismissed = new Set();
  let acknowledgementsLoaded = false;
  let dataError = false;

  const bell = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';

  function itemEntry(module, table, item) {
    return { ...item, module, tableId: table?.id || item.tableId || '', tableName: table?.name || '', updatedAt: item.updatedAt || item.date || '' };
  }

  function dataEntries(data) {
    return [
      ...(data.inventory?.tables || []).flatMap(table => (table.items || []).map(item => itemEntry('inventory', table, item))),
      ...(data.management?.items || []).map(item => itemEntry('management', data.management.table, item)),
      ...(data.control?.tables || []).flatMap(table => (table.items || []).map(item => itemEntry('control', table, item))),
      ...(data.flux?.tables || []).flatMap(table => (table.items || []).map(item => itemEntry('flux', table, item)))
    ].filter(item => item.id && String(item.equipment || '').trim());
  }

  function notificationFor(item) {
    const status = normalize(item.status);
    const priority = normalize(item.priority);
    const age = daysSince(item.updatedAt || item.createdAt || item.date);

    // Apenas regras operacionais reais entram na Central de Notificações.
    if (priority === 'alta' && /manutenc/.test(status) && age > 3) {
      return {
        item,
        level: 'Alta',
        weight: 200 + age,
        age,
        urgent: true,
        updatedAt: item.updatedAt,
        description: `🚨 Em manutenção há ${age} dias sem resposta.`
      };
    }
    if (priority === 'media' && /atenc/.test(status) && age > 5) {
      return {
        item,
        level: 'Média',
        weight: 100 + age,
        age,
        urgent: false,
        updatedAt: item.updatedAt,
        description: `Em Atenção há ${age} dias; acompanhamento necessário.`
      };
    }
    return null;
  }

  function importantNotifications(data) {
    const grouped = new Map();
    dataEntries(data).map(notificationFor).filter(Boolean).forEach(notification => {
      const item = notification.item;
      const key = normalize(item.tag) || normalize(item.serial) || `${item.module}:${item.id}`;
      const previous = grouped.get(key);
      if (!previous || notification.weight > previous.weight || (notification.weight === previous.weight && dateValue(notification.updatedAt) > dateValue(previous.updatedAt))) grouped.set(key, notification);
    });
    const recurringNfe = (data.nfeAlerts || []).filter(alert => alert?.id && alert?.pdv).map(alert => ({
      item: { id: alert.id, module: 'nfe', equipment: `PDV ${alert.pdv}`, pdv: alert.pdv, updatedAt: alert.latestAt },
      level: 'Alta',
      weight: 260 + Number(alert.occurrences || 0),
      age: 0,
      urgent: true,
      updatedAt: alert.latestAt,
      description: `🚨 ${alert.occurrences} ocorrências neste PDV nesta semana. Investigação recomendada.`
    }));
    return [...grouped.values(), ...recurringNfe]
      .sort((first, second) => second.weight - first.weight || second.age - first.age);
  }

  const notificationKey = notification => {
    const item = notification.item;
    const identity = item.id || item.tag || item.serial || item.equipment;
    return `${item.module}:${identity}:${normalize(item.status)}:${normalize(item.priority)}:${item.updatedAt || item.createdAt || item.date || ''}`;
  };
  const showCurrentNotifications = () => {
    notifications = allNotifications.filter(notification => !dismissed.has(notificationKey(notification))).slice(0, 4);
  };

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
    const key = notificationKey(notification);
    dismissed.add(key);
    showCurrentNotifications();
    render();
    const request = window.AldeckotSupabase?.notificationAcknowledgements?.acknowledge({
      module: notification.item.module,
      itemId: notification.item.id,
      stateKey: key
    });
    if (!request?.catch) return;
    request.catch(error => {
      dismissed.delete(key);
      showCurrentNotifications();
      render();
      console.warn('Não foi possível reconhecer a notificação.', error);
    });
  }

  function render() {
    if (!root) return;
    const list = root.querySelector('[data-home-notification-list]');
    const count = notifications.length;
    badge.hidden = !count;
    badge.textContent = count;
    button.setAttribute('aria-label', count ? `Abrir ${count} notificações prioritárias` : 'Abrir Central de Notificações');
    root.dataset.hasNotifications = String(Boolean(count));
    root.dataset.hasUrgent = String(notifications.some(notification => notification.urgent));
    root.querySelector('[data-home-notification-count]').textContent = dataError ? 'Atualização indisponível' : (count ? `${count} alertas prioritários` : 'Sem alertas pendentes');
    const clear = root.querySelector('[data-home-notification-clear]');
    clear.hidden = !count;
    clear.setAttribute('aria-label', `Limpar ${count} notificações`);
    if (dataError) {
      list.innerHTML = '<div class="home-notification-empty"><span>!</span><div><b>Atualização indisponível</b><p>Não foi possível consultar os alertas neste momento.</p></div></div>';
      return;
    }
    if (!count) {
      list.innerHTML = '<div class="home-notification-empty"><span>✓</span><div><b>Tudo acompanhado</b><p>Nenhum alerta de equipamento exige atenção agora.</p></div></div>';
      return;
    }
    list.innerHTML = notifications.map((notification, index) => {
      const item = notification.item;
      const identifiers = item.module === 'nfe'
        ? `Ocorrências na semana: ${notification.item ? String(notification.description).match(/\d+/)?.[0] || '4+' : '4+'}`
        : ([item.tag && `TAG ${item.tag}`, item.serial && `Série ${item.serial}`].filter(Boolean).join(' · ') || 'TAG e série não informadas');
      const urgency = notification.urgent ? `<span class="home-notification-urgent" aria-label="Alerta urgente">${item.module === 'nfe' ? '⚠ Investigar PDV' : '🚨 Sem resposta'}</span>` : '';
      return `<button class="home-notification-item${notification.urgent ? ' is-urgent' : ''}" type="button" data-home-notification-item="${index}" data-level="${notification.level.toLowerCase()}" data-urgent="${notification.urgent}"><span class="home-notification-item-head"><span><b>${escape(item.equipment || 'Equipamento sem nome')}</b><small>${escape(identifiers)}</small></span><em>${notification.level}</em></span><span class="home-notification-description">${escape(notification.description)}</span>${urgency}<span class="home-notification-module">${escape(moduleInfo(item.module))}<i>›</i></span></button>`;
    }).join('');
    list.querySelectorAll('[data-home-notification-item]').forEach(item => item.addEventListener('click', () => {
      const notification = notifications[Number(item.dataset.homeNotificationItem)];
      acknowledge(notification);
      closePanel();
      if (notification?.item?.module === 'nfe') {
        const target = `nfe.html?pdv=${encodeURIComponent(notification.item.pdv || '')}`;
        if (window.AldeckotRoute?.navigate) window.AldeckotRoute.navigate(target);
        else window.location.href = target;
      } else window.openEquipmentCentral?.(notification?.item);
    }));
  }

  function closePanel() {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    panel.classList.remove('is-open');
    button?.setAttribute('data-open', 'false');
    button?.setAttribute('aria-expanded', 'false');
  }

  function togglePanel() {
    if (!panel) return;
    if (!panel.hidden) return closePanel();
    panel.hidden = false;
    panel.classList.add('is-open');
    button.setAttribute('data-open', 'true');
    button.setAttribute('aria-expanded', 'true');
  }

  function clearNotifications() {
    [...notifications].forEach(acknowledge);
  }

  function mount() {
    const anchor = document.querySelector('[data-central-search]');
    if (!anchor || document.querySelector('[data-home-notifications]')) return;
    root = document.createElement('section');
    root.className = 'home-notification-center';
    root.dataset.homeNotifications = 'true';
    root.innerHTML = `<button class="home-notification-toggle" type="button" data-home-notification-toggle aria-expanded="false" aria-controls="homeNotificationsPanel">${bell}<span data-home-notification-badge hidden></span></button><section class="home-notification-panel" id="homeNotificationsPanel" data-home-notification-panel hidden><header><div><p>Central de Notificações</p><h2>Equipamentos e ocorrências</h2></div><div class="home-notification-head-actions"><span data-home-notification-count>Carregando alertas…</span><button class="home-notification-clear" type="button" data-home-notification-clear title="Limpar notificações">×</button></div></header><div class="home-notification-list" data-home-notification-list><div class="home-notification-loading"><i></i>Verificando equipamentos…</div></div></section>`;
    anchor.insertAdjacentElement('afterend', root);
    button = root.querySelector('[data-home-notification-toggle]');
    panel = root.querySelector('[data-home-notification-panel]');
    badge = root.querySelector('[data-home-notification-badge]');
    button.addEventListener('click', event => { event.stopPropagation(); togglePanel(); });
    root.querySelector('[data-home-notification-clear]').addEventListener('click', clearNotifications);
    document.addEventListener('click', event => {
      if (!root.contains(event.target)) closePanel();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  }

  mount();
  window.addEventListener('aldeckot:home-data', async event => {
    dataError = Boolean(event.detail?.error);
    allNotifications = dataError ? [] : importantNotifications(event.detail || {});
    try { await hydrateAcknowledgements(); }
    catch (error) { console.warn('Não foi possível carregar os alertas reconhecidos.', error); }
    showCurrentNotifications();
    render();
  });
  window.addEventListener('aldeckot:realtime-change', event => {
    if (event.detail?.table !== 'notification_acknowledgements') return;
    hydrateAcknowledgements(true).then(() => { showCurrentNotifications(); render(); }).catch(() => {});
  });
})();
