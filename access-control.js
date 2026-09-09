(() => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const inventoryCreates = new Set(['add-item', 'add-table']);
  const inventoryUpdates = new Set(['add-log', 'edit-active-table', 'edit-log', 'sync', 'toggle-item-actions', 'toggle-active-table-actions']);
  const inventoryDeletes = new Set(['delete-active-table', 'delete-log']);
  const backupActions = new Set(['backup', 'confirm-backup-restore', 'create-backup', 'prepare-network-restore', 'restore-backup', 'toggle-auto-backup', 'backup-local-create', 'backup-local-restore', 'backup-network-create', 'backup-network-restore']);
  const managementCreates = new Set(['add-area']);
  const managementUpdates = new Set(['add-log', 'edit', 'edit-log', 'sync', 'toggle-actions']);
  const managementDeletes = new Set(['confirm-delete', 'confirm-delete-log', 'delete', 'delete-log']);
  const managementBackups = new Set(['backup', 'confirm-backup-restore', 'create-backup', 'prepare-network-restore', 'restore-backup', 'toggle-backup-automatic', 'backup-local-create', 'backup-local-restore', 'backup-network-create', 'backup-network-restore']);
  const nfeBackups = new Set(['create', 'restore', 'create-local', 'create-network', 'restore-local', 'restore-network', 'confirm-restore', 'toggle-auto']);
  const moduleFromLocation = () => ({ 'inventory.html': 'inventory', 'management.html': 'management', 'control.html': 'control', 'flux.html': 'flux', 'nfe.html': 'nfe' })[window.location.pathname.split('/').pop().toLowerCase()] || '';
  const isStandard = () => document.body.classList.contains('is-standard');
  const isAgendaException = element => Boolean(element?.closest?.('.agenda-modal, .home-calendar, .agenda-today-panel, .agenda-upcoming-panel'));

  const permissionFor = element => {
    if (!element || isAgendaException(element) || element.closest?.('[data-auth-allow-write]')) return '';
    const invAction = element.dataset?.invAction;
    if (invAction) {
      if (backupActions.has(invAction)) return 'backup';
      if (inventoryCreates.has(invAction)) return 'create';
      if (inventoryUpdates.has(invAction)) return 'update';
      if (inventoryDeletes.has(invAction)) return 'delete';
    }
    if (element.hasAttribute?.('data-inv-edit-table') || element.hasAttribute?.('data-inv-edit-item')) return 'update';
    if (element.hasAttribute?.('data-inv-delete-table') || element.hasAttribute?.('data-inv-delete-item')) return 'delete';
    const managementAction = element.dataset?.managementAction;
    if (managementAction) {
      if (managementBackups.has(managementAction)) return 'backup';
      if (managementCreates.has(managementAction)) return 'create';
      if (managementUpdates.has(managementAction)) return 'update';
      if (managementDeletes.has(managementAction)) return 'delete';
    }
    if (element.hasAttribute?.('data-nfe-new') || element.hasAttribute?.('data-nfe-submit')) return 'create';
    if (element.hasAttribute?.('data-nfe-edit')) return 'update';
    if (element.hasAttribute?.('data-nfe-delete') || element.hasAttribute?.('data-nfe-confirm-delete')) return 'delete';
    if (element.hasAttribute?.('data-nfe-backup') || element.hasAttribute?.('data-nfe-backup-restore')) return 'backup';
    if (nfeBackups.has(element.dataset?.nfeBackupAction)) return 'backup';
    const text = normalize(`${element.textContent || ''} ${element.getAttribute?.('title') || ''} ${element.getAttribute?.('aria-label') || ''}`);
    if (/(backup|restaurar|copia)/.test(text)) return 'backup';
    if (/(excluir|remover|apagar)/.test(text)) return 'delete';
    if (/(adicionar|nova tabela|criar tabela|nova nf-?e|registrar nf-?e)/.test(text)) return 'create';
    if (/(editar|salvar altera|salvar log|salvar no historico|sincronizar|acao da tabela|^acao$)/.test(text)) return 'update';
    return '';
  };
  const formPermission = form => {
    if (form.matches?.('[data-inv-table-form], [data-inv-item-form], [data-management-form], [data-nfe-form]')) return 'create';
    if (form.matches?.('[data-inv-log-form], [data-management-log-form], [data-nfe-resolution-form]')) return 'update';
    return permissionFor(form);
  };
  const hasPermission = (module, action) => !isStandard() || Boolean(module && action && window.AldeckotAuth?.profile?.module_permissions?.[module]?.[action]);
  const lockMessage = action => ({ create: 'Sem permissão para criar neste módulo', update: 'Sem permissão para editar neste módulo', delete: 'Sem permissão para excluir neste módulo', backup: 'Sem permissão para gerenciar backups neste módulo' })[action] || 'Ação não permitida para esta conta';
  const isRestricted = element => { const action = permissionFor(element); return isStandard() && Boolean(action && !hasPermission(moduleFromLocation(), action)); };
  const controlsIn = root => { const controls = [...(root?.querySelectorAll?.('button, [role="button"]') || [])]; if (root?.matches?.('button, [role="button"]')) controls.unshift(root); return controls; };
  const lock = control => {
    if (!isRestricted(control) || control.dataset.authLocked === 'true') return;
    control.dataset.authLocked = 'true'; control.setAttribute('aria-disabled', 'true'); control.setAttribute('title', lockMessage(permissionFor(control))); control.classList.add('auth-action-locked');
    if ('disabled' in control) control.disabled = true; else control.tabIndex = -1;
  };
  const lockRestricted = root => { if (isStandard()) controlsIn(root).forEach(lock); };
  const blockWrite = event => { const control = event.target.closest?.('button, [role="button"]'); if (control && isRestricted(control)) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const blockFormWrite = event => { const action = formPermission(event.target); if (isStandard() && action && !isAgendaException(event.target) && !hasPermission(moduleFromLocation(), action)) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const addLockStyles = () => {
    if (document.getElementById('aldeckot-access-control-styles')) return;
    const style = document.createElement('style'); style.id = 'aldeckot-access-control-styles';
    style.textContent = `.auth-action-locked,button[data-auth-locked="true"]{cursor:not-allowed!important;opacity:.46!important;filter:grayscale(.7) saturate(.55)!important;box-shadow:none!important}.auth-action-locked:hover,.auth-action-locked:focus-visible{transform:none!important;animation:none!important}.auth-action-locked svg{opacity:.7}`;
    document.head.append(style);
  };
  const start = () => {
    if (!isStandard()) return;
    addLockStyles(); lockRestricted(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE) lockRestricted(node); }))).observe(document.body, { childList: true, subtree: true });
  };
  document.addEventListener('click', blockWrite, true);
  document.addEventListener('submit', blockFormWrite, true);
  if (window.AldeckotAuthReady) window.AldeckotAuthReady.then(start);
  else window.addEventListener('aldeckot:auth-ready', start, { once: true });
})();
