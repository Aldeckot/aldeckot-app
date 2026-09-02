(() => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const isAgendaException = element => Boolean(element.closest('.agenda-modal, .home-calendar, .agenda-today-panel, .agenda-upcoming-panel'));
  const isRestricted = element => {
    if (!element || element.closest('[data-auth-allow-write]')) return false;
    const text = normalize(`${element.textContent || ''} ${element.getAttribute('title') || ''} ${element.getAttribute('aria-label') || ''}`);
    return /(adicionar|editar|excluir|nova tabela|criar tabela|restaurar|backup|sincronizar|acao da tabela|^acao$|toggle-active-table-actions)/.test(text);
  };
  const hideRestricted = root => {
    if (!document.body.classList.contains('is-standard')) return;
    root.querySelectorAll?.('button, [role="button"]').forEach(button => {
      if (!isAgendaException(button) && isRestricted(button)) button.hidden = true;
    });
  };
  const blockWrite = event => {
    if (!document.body.classList.contains('is-standard')) return;
    const action = event.target.closest('button, [role="button"]');
    if (action && !isAgendaException(action) && isRestricted(action)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const start = () => {
    hideRestricted(document);
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) { hideRestricted(node); hideRestricted(node.parentElement || document); }
    }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', blockWrite, true);
  };
  if (window.AldeckotAuthReady) window.AldeckotAuthReady.then(start);
  else window.addEventListener('aldeckot:auth-ready', start, { once: true });
})();
