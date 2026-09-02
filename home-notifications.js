(() => {
  const moduleInfo = module => ({
    inventory: 'Inventário',
    management: 'Gestão TI',
    control: 'Controle TI',
    flux: 'Flux'
  })[module] || 'Módulo';
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const dateValue = value => {
    const time = new Date(value || '').getTime();
    return Number.isFinite(time) ? time : 0;
  };
  const daysSince = value => Math.max(0, Math.floor((Date.now() - dateValue(value)) / 86400000));
  const dismissedStorageKey = 'aldeckot-dismissed-notifications';
  const readDismissed = () => {
    try { return new Set(JSON.parse(sessionStorage.getItem(dismissedStorageKey) || '[]')); }
    catch { return new Set(); }
  };
  const saveDismissed = dismissed => {
    try { sessionStorage.setItem(dismissedStorageKey, JSON.stringify([...dismissed])); }
    catch { /* A limpeza continua funcionando durante esta sessão. */ }
  };
  let root;
  let button;
  let panel;
  let badge;
  let notifications = [];
  let allNotifications = [];
  let dismissed = readDismissed();
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
    ].filter(item => item.equipment || item.tag || item.serial);
  }

  function lastMaintenance(item) {
    return (item.logs || [])
      .filter(log => /manutenc|revis|reparo/.test(normalize(log.text || log.message)))
      .map(log => log.createdAt || log.at)
      .sort((first, second) => dateValue(second) - dateValue(first))[0] || item.updatedAt;
  }

  function notificationFor(item) {
    const state = normalize(item.status);
    const cleaning = normalize(item.cleaning || item.situation);
    const priority = normalize(item.priority);
    const maintenanceDays = daysSince(lastMaintenance(item));
    let level = 'Baixa';
    let weight = 20;
    let description = 'Monitoramento regular; acompanhe as próximas atualizações.';

    if (/defeito|descart/.test(state)) {
      level = 'Alta'; weight = 100;
      description = 'Status crítico: intervenção imediata recomendada.';
    } else if (/manutencao/.test(state) && maintenanceDays > 3) {
      level = 'Alta'; weight = 96;
      description = `Em manutenção há ${maintenanceDays} dias.`;
    } else if (priority === 'alta') {
      level = 'Alta'; weight = 92;
      description = 'Prioridade alta definida no cadastro.';
    } else if (maintenanceDays > 3) {
      level = 'Média'; weight = 72;
      description = `Mais de ${maintenanceDays} dias sem manutenção registrada.`;
    } else if (/nao realizada|pendente|sem limpeza/.test(cleaning)) {
      level = 'Média'; weight = 66;
      description = 'Limpeza pendente requer acompanhamento.';
    } else if (priority === 'media') {
      level = 'Média'; weight = 58;
      description = 'Prioridade média definida no cadastro.';
    } else if (/manutencao|reserva|pendente|atencao|verific/.test(state)) {
      level = 'Baixa'; weight = 34;
      description = 'Acompanhe o status operacional deste equipamento.';
    }
    return { item, level, weight, description, updatedAt: item.updatedAt };
  }

  function importantNotifications(data) {
    const grouped = new Map();
    dataEntries(data).map(notificationFor).forEach(notification => {
      const item = notification.item;
      const key = normalize(item.tag) || normalize(item.serial) || `${item.module}:${item.id}`;
      const previous = grouped.get(key);
      if (!previous || notification.weight > previous.weight || (notification.weight === previous.weight && dateValue(notification.updatedAt) > dateValue(previous.updatedAt))) grouped.set(key, notification);
    });
    return [...grouped.values()]
      .sort((first, second) => second.weight - first.weight || dateValue(second.updatedAt) - dateValue(first.updatedAt))
      .slice(0, 4);
  }

  const notificationKey = notification => `${notification.item.module}:${notification.item.id}:${notification.level}:${notification.description}`;
  const showCurrentNotifications = () => {
    notifications = allNotifications.filter(notification => !dismissed.has(notificationKey(notification)));
  };

  function render() {
    if (!root) return;
    const list = root.querySelector('[data-home-notification-list]');
    const count = notifications.length;
    badge.hidden = !count;
    badge.textContent = count;
    button.setAttribute('aria-label', count ? `Abrir ${count} notificações prioritárias` : 'Abrir Central de Notificações');
    root.dataset.hasNotifications = String(Boolean(count));
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
      const identifiers = [item.tag && `TAG ${item.tag}`, item.serial && `Série ${item.serial}`].filter(Boolean).join(' · ') || 'TAG e série não informadas';
      return `<button class="home-notification-item" type="button" data-home-notification-item="${index}" data-level="${notification.level.toLowerCase()}"><span class="home-notification-item-head"><span><b>${escape(item.equipment || 'Equipamento sem nome')}</b><small>${escape(identifiers)}</small></span><em>${notification.level}</em></span><span class="home-notification-description">${escape(notification.description)}</span><span class="home-notification-module">${escape(moduleInfo(item.module))}<i>›</i></span></button>`;
    }).join('');
    list.querySelectorAll('[data-home-notification-item]').forEach(item => item.addEventListener('click', () => {
      const notification = notifications[Number(item.dataset.homeNotificationItem)];
      closePanel();
      window.openEquipmentCentral?.(notification?.item);
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
    notifications.forEach(notification => dismissed.add(notificationKey(notification)));
    saveDismissed(dismissed);
    showCurrentNotifications();
    render();
  }

  function mount() {
    const anchor = document.querySelector('[data-central-search]');
    if (!anchor || document.querySelector('[data-home-notifications]')) return;
    root = document.createElement('section');
    root.className = 'home-notification-center';
    root.dataset.homeNotifications = 'true';
    root.innerHTML = `<button class="home-notification-toggle" type="button" data-home-notification-toggle aria-expanded="false" aria-controls="homeNotificationsPanel">${bell}<span data-home-notification-badge hidden></span></button><section class="home-notification-panel" id="homeNotificationsPanel" data-home-notification-panel hidden><header><div><p>Central de Notificações</p><h2>Equipamentos em atenção</h2></div><div class="home-notification-head-actions"><span data-home-notification-count>Carregando alertas…</span><button class="home-notification-clear" type="button" data-home-notification-clear title="Limpar notificações">×</button></div></header><div class="home-notification-list" data-home-notification-list><div class="home-notification-loading"><i></i>Verificando equipamentos…</div></div></section>`;
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
  window.addEventListener('aldeckot:home-data', event => {
    dataError = Boolean(event.detail?.error);
    allNotifications = dataError ? [] : importantNotifications(event.detail || {});
    showCurrentNotifications();
    render();
  });
})();
