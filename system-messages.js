(() => {
  if (window.AldeckotMessage) return;

  const labels = {
    success: 'Concluído',
    error: 'Não foi possível concluir',
    warning: 'Atenção',
    info: 'ALDECKOT'
  };
  const icons = {
    success: '✓',
    error: '!',
    warning: '!',
    info: 'i'
  };
  let center;

  const text = value => String(value ?? '').trim() || 'O sistema não retornou uma mensagem.';

  function inferType(message) {
    const value = text(message).toLocaleLowerCase('pt-BR');
    if (/(não foi possível|erro|falha|inválid|rejeitad|indisponível|não está|não carreg)/.test(value)) return 'error';
    if (/(sucesso|concluíd|restaurad|salvo|atualizad|criad|excluíd)/.test(value)) return 'success';
    if (/(selecione|permita|atenção|informe|verifique|não há)/.test(value)) return 'warning';
    return 'info';
  }

  function ensureCenter() {
    if (center?.isConnected) return center;
    center = document.createElement('section');
    center.className = 'aldeckot-message-center';
    center.setAttribute('aria-live', 'polite');
    center.setAttribute('aria-relevant', 'additions');
    center.setAttribute('aria-label', 'Mensagens do sistema');
    (document.body || document.documentElement).appendChild(center);
    return center;
  }

  function removeMessage(element) {
    if (!element || element.dataset.closing === 'true') return;
    element.dataset.closing = 'true';
    element.classList.add('is-closing');
    window.setTimeout(() => element.remove(), 180);
  }

  function show(message, options = {}) {
    const type = ['success', 'error', 'warning', 'info'].includes(options.type) ? options.type : inferType(message);
    const duration = Number.isFinite(options.duration) ? options.duration : (type === 'error' ? 7000 : 4800);
    const item = document.createElement('article');
    item.className = `aldeckot-message is-${type}`;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const symbol = document.createElement('span');
    symbol.className = 'aldeckot-message-icon';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = icons[type];
    const content = document.createElement('div');
    content.className = 'aldeckot-message-content';
    const title = document.createElement('b');
    title.textContent = options.title || labels[type];
    const body = document.createElement('p');
    body.textContent = text(message);
    content.append(title, body);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'aldeckot-message-close';
    close.setAttribute('aria-label', 'Fechar mensagem');
    close.textContent = '×';
    close.addEventListener('click', () => removeMessage(item));
    item.append(symbol, content, close);

    const host = ensureCenter();
    host.appendChild(item);
    while (host.children.length > 4) removeMessage(host.firstElementChild);
    if (duration > 0) window.setTimeout(() => removeMessage(item), duration);
    return item;
  }

  function confirm(message, options = {}) {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'aldeckot-confirm-backdrop';
      backdrop.innerHTML = '<section class="aldeckot-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="aldeckotConfirmTitle"><span class="aldeckot-confirm-icon" aria-hidden="true">!</span><div><h2 id="aldeckotConfirmTitle"></h2><p></p></div><footer><button type="button" class="aldeckot-confirm-cancel">Cancelar</button><button type="button" class="aldeckot-confirm-accept">Confirmar</button></footer></section>';
      const dialog = backdrop.querySelector('.aldeckot-confirm-dialog');
      const accept = backdrop.querySelector('.aldeckot-confirm-accept');
      const cancel = backdrop.querySelector('.aldeckot-confirm-cancel');
      dialog.querySelector('h2').textContent = options.title || 'Confirmar ação';
      dialog.querySelector('p').textContent = text(message);
      accept.textContent = options.confirmText || 'Confirmar';
      cancel.textContent = options.cancelText || 'Cancelar';
      if (options.danger !== false) accept.classList.add('is-danger');

      const finish = answer => {
        document.removeEventListener('keydown', onKeydown);
        backdrop.classList.add('is-closing');
        window.setTimeout(() => backdrop.remove(), 160);
        resolve(answer);
      };
      const onKeydown = event => {
        if (event.key === 'Escape') finish(false);
        if (event.key === 'Enter' && document.activeElement !== cancel) finish(true);
      };
      accept.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      backdrop.addEventListener('click', event => { if (event.target === backdrop) finish(false); });
      document.addEventListener('keydown', onKeydown);
      (document.body || document.documentElement).appendChild(backdrop);
      window.setTimeout(() => cancel.focus(), 0);
    });
  }

  const api = {
    show,
    confirm,
    success: (message, options = {}) => show(message, { ...options, type: 'success' }),
    error: (message, options = {}) => show(message, { ...options, type: 'error' }),
    warning: (message, options = {}) => show(message, { ...options, type: 'warning' }),
    info: (message, options = {}) => show(message, { ...options, type: 'info' })
  };
  window.AldeckotMessage = api;

  try {
    window.alert = message => api.show(message);
  } catch (_) {
    // Em navegadores restritos, os módulos ainda podem usar a API diretamente.
  }
  window.addEventListener('aldeckot:message', event => api.show(event.detail?.message, event.detail || {}));
})();
