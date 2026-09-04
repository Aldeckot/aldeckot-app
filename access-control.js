(() => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const writeText = /(adicionar|editar|excluir|nova tabela|criar tabela|nova nf-?e|registrar nf-?e|salvar altera|salvar log|salvar no historico|restaurar|backup|sincronizar|acao da tabela|^acao$)/;
  const inventoryWrites = new Set(['add-item', 'add-log', 'add-table', 'backup', 'confirm-backup-restore', 'create-backup', 'delete-active-table', 'delete-log', 'edit-active-table', 'edit-log', 'prepare-network-restore', 'restore-backup', 'sync', 'toggle-active-table-actions', 'toggle-auto-backup', 'toggle-item-actions', 'backup-local-create', 'backup-local-restore', 'backup-network-create', 'backup-network-restore']);
  const managementWrites = new Set(['add-area', 'add-log', 'backup', 'confirm-backup-restore', 'confirm-delete', 'confirm-delete-log', 'create-backup', 'delete', 'delete-log', 'edit', 'edit-log', 'prepare-network-restore', 'restore-backup', 'sync', 'toggle-actions', 'toggle-backup-automatic', 'backup-local-create', 'backup-local-restore', 'backup-network-create', 'backup-network-restore']);
  const nfeBackupWrites = new Set(['create', 'restore', 'create-local', 'create-network', 'restore-local', 'restore-network', 'confirm-restore', 'toggle-auto']);
  const writeForms = '[data-inv-table-form], [data-inv-item-form], [data-inv-log-form], [data-management-form], [data-management-log-form], [data-nfe-form], [data-nfe-resolution-form]';

  const isStandard = () => document.body.classList.contains('is-standard');
  const isAgendaException = element => Boolean(element?.closest?.('.agenda-modal, .home-calendar, .agenda-today-panel, .agenda-upcoming-panel'));
  const hasDataWriteAction = element => {
    const invAction = element.dataset?.invAction;
    if (invAction && inventoryWrites.has(invAction)) return true;
    if (element.hasAttribute?.('data-inv-edit-table') || element.hasAttribute?.('data-inv-delete-table') || element.hasAttribute?.('data-inv-edit-item') || element.hasAttribute?.('data-inv-delete-item')) return true;

    const managementAction = element.dataset?.managementAction;
    if (managementAction && managementWrites.has(managementAction)) return true;

    if (element.hasAttribute?.('data-nfe-new') || element.hasAttribute?.('data-nfe-edit') || element.hasAttribute?.('data-nfe-delete') || element.hasAttribute?.('data-nfe-submit') || element.hasAttribute?.('data-nfe-confirm-delete') || element.hasAttribute?.('data-nfe-backup') || element.hasAttribute?.('data-nfe-backup-restore')) return true;
    const nfeBackupAction = element.dataset?.nfeBackupAction;
    return Boolean(nfeBackupAction && nfeBackupWrites.has(nfeBackupAction));
  };
  const isRestricted = element => {
    if (!element || element.closest?.('[data-auth-allow-write]') || isAgendaException(element)) return false;
    if (hasDataWriteAction(element)) return true;
    const text = normalize(`${element.textContent || ''} ${element.getAttribute?.('title') || ''} ${element.getAttribute?.('aria-label') || ''}`);
    return writeText.test(text);
  };
  const controlsIn = root => {
    if (!root) return [];
    const controls = [...(root.querySelectorAll?.('button, [role="button"]') || [])];
    if (root.matches?.('button, [role="button"]')) controls.unshift(root);
    return controls;
  };
  const lock = control => {
    if (!isRestricted(control) || control.dataset.authLocked === 'true') return;
    control.dataset.authLocked = 'true';
    control.setAttribute('aria-disabled', 'true');
    control.setAttribute('title', 'Ação disponível apenas para administradores');
    control.classList.add('auth-action-locked');
    if ('disabled' in control) control.disabled = true;
    else control.tabIndex = -1;
  };
  const lockRestricted = root => {
    if (!isStandard()) return;
    controlsIn(root).forEach(lock);
  };
  const blockWrite = event => {
    if (!isStandard()) return;
    const control = event.target.closest?.('button, [role="button"]');
    if (control && isRestricted(control)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const blockFormWrite = event => {
    if (!isStandard() || !event.target.matches?.(writeForms)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const addLockStyles = () => {
    if (document.getElementById('aldeckot-access-control-styles')) return;
    const style = document.createElement('style');
    style.id = 'aldeckot-access-control-styles';
    style.textContent = `
      .auth-action-locked,
      button[data-auth-locked="true"] {
        cursor: not-allowed !important;
        opacity: .46 !important;
        filter: grayscale(.7) saturate(.55) !important;
        box-shadow: none !important;
      }
      .auth-action-locked:hover,
      .auth-action-locked:focus-visible {
        transform: none !important;
        animation: none !important;
      }
      .auth-action-locked svg { opacity: .7; }
    `;
    document.head.append(style);
  };
  const start = () => {
    if (!isStandard()) return;
    addLockStyles();
    lockRestricted(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) lockRestricted(node);
    }))).observe(document.body, { childList: true, subtree: true });
  };

  document.addEventListener('click', blockWrite, true);
  document.addEventListener('submit', blockFormWrite, true);
  if (window.AldeckotAuthReady) window.AldeckotAuthReady.then(start);
  else window.addEventListener('aldeckot:auth-ready', start, { once: true });
})();
