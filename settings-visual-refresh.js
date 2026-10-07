(() => {
  'use strict';

  const paths = {
    general: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    online: '<path d="M3 12h4l2.3-5 4.1 10 2.2-5H21"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2H3Zm12-14a3 3 0 0 1 0 6m2 3a5 5 0 0 1 4 5h-4"/>',
    security: '<path d="M12 2 4 5v6c0 5.4 3.4 9 8 11 4.6-2 8-5.6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    appearance: '<path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 1.5-3.3 1.9 1.9 0 0 1 1.5-3.2H18A3 3 0 0 0 21 11a9 9 0 0 0-9-8Z"/><circle cx="7.5" cy="10" r=".7" fill="currentColor" stroke="none"/><circle cx="10" cy="6.5" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r=".7" fill="currentColor" stroke="none"/><circle cx="17.5" cy="11" r=".7" fill="currentColor" stroke="none"/>',
    integrations: '<rect x="3" y="9" width="5" height="6" rx="1"/><rect x="16" y="3" width="5" height="6" rx="1"/><rect x="16" y="15" width="5" height="6" rx="1"/><path d="M8 12h4c2 0 4-2 4-6m-4 6c2 0 4 2 4 6"/>',
    notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
    backup: '<path d="M7 18a5 5 0 0 1-1-9.9A7 7 0 0 1 19 9a4.5 4.5 0 0 1 0 9h-2"/><path d="M12 11v10m-4-4 4 4 4-4"/>',
    audit: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6m-6 4h6m-6 4h4"/>',
    settings: '<path d="M10 2h4l.6 2.2 1.8.8 2-.9 2.8 2.8-.9 2 .8 1.8L23 11v4l-2.2.6-.8 1.8.9 2-2.8 2.8-2-.9-1.8.8L14 24h-4l-.6-2.2-1.8-.8-2 .9-2.8-2.8.9-2-.8-1.8L1 15v-4l2.2-.6.8-1.8-.9-2L5.9 3.8l2 .9 1.8-.8L10 2Z" transform="translate(0 -1) scale(.96)"/><circle cx="12" cy="12" r="3"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="M9 21v-7h6v7"/>',
    logout: '<path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m5-4 4-4-4-4m-8 4h12"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    role: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M13 10h5m-5 4h4"/>',
    status: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    version: '<path d="M3 4h10l8 8-9 9-9-9V4Z"/><circle cx="8" cy="9" r="1"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    layers: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
    motion: '<path d="M4 12a8 8 0 0 1 14-5m2 5a8 8 0 0 1-14 5"/><path d="m18 3 1 4-4 1M6 21l-1-4 4-1"/>'
  };

  const svg = key => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[key]}</svg>`;
  function setIcon(node, key) {
    if (!node || !paths[key] || node.dataset.iconKey === key) return;
    node.innerHTML = svg(key);
    node.dataset.iconKey = key;
    node.setAttribute('aria-hidden', 'true');
  }

  const normalized = value => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function iconForLabel(label, fallback = 'general') {
    const value = normalized(label);
    if (/backup|copia|recuperacao|restauracao/.test(value)) return 'backup';
    if (/auditoria|historico|relatorio/.test(value)) return 'audit';
    if (/notificac|alerta/.test(value)) return 'notifications';
    if (/perfil de acesso/.test(value)) return 'role';
    if (/usuario|permiss/.test(value)) return 'users';
    if (/seguranca|credencia|sessao|protecao/.test(value)) return 'security';
    if (/aparencia|personaliz|tema|identidade visual|superficie/.test(value)) return 'appearance';
    if (/operacao e dados/.test(value)) return 'database';
    if (/integrac|sincroniz|dados compartilhados|concilia/.test(value)) return 'integrations';
    if (/banco|postgres|supabase/.test(value)) return 'database';
    if (/versao/.test(value)) return 'version';
    if (/estado da conta|status|online/.test(value)) return 'status';
    if (/conta conectada|nome de usuario/.test(value)) return 'account';
    if (/movimento/.test(value)) return 'motion';
    if (/divergencia|conflito/.test(value)) return 'warning';
    return fallback;
  }

  document.querySelectorAll('.settings-nav-item').forEach(button => {
    const label = [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
    button.title = label;
    button.setAttribute('aria-label', label);
    setIcon(button.querySelector('.nav-symbol'), button.dataset.settingsTab);
  });
  document.querySelectorAll('.overview-card').forEach(card => {
    const key = [...card.classList].find(name => ['online', 'database', 'users', 'backup'].includes(name));
    setIcon(card.querySelector('.overview-icon'), key);
  });
  setIcon(document.querySelector('.title-icon'), 'settings');
  setIcon(document.querySelector('.sidebar-home span'), 'home');
  setIcon(document.querySelector('.sidebar-logout span'), 'logout');
  setIcon(document.querySelector('.settings-search > span'), 'search');
  setIcon(document.querySelector('.settings-sidebar-toggle span'), 'menu');

  const content = document.getElementById('settingsContent');
  function hydrateContent() {
    content.querySelectorAll('.settings-detail.is-button').forEach(item => setIcon(item.querySelector(':scope > i'), iconForLabel(item.querySelector(':scope > span')?.textContent, 'account')));
    content.querySelectorAll('.panel-heading-icon').forEach(item => setIcon(item, iconForLabel(item.parentElement?.querySelector('h2')?.textContent, 'layers')));
    content.querySelectorAll('.settings-option .option-icon').forEach(item => {
      const label = item.parentElement?.querySelector('.option-copy b')?.textContent;
      setIcon(item, iconForLabel(label, item.textContent.trim() === '!' ? 'warning' : 'layers'));
    });
  }
  if (content) {
    hydrateContent();
    new MutationObserver(hydrateContent).observe(content, { childList: true, subtree: true });
  }

  const toggle = document.getElementById('settingsSidebarToggle');
  toggle?.addEventListener('click', () => {
    const expanded = document.body.classList.toggle('settings-sidebar-expanded');
    document.body.classList.toggle('settings-sidebar-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    const label = expanded ? 'Recolher menu de configurações' : 'Expandir menu de configurações';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  });
})();
