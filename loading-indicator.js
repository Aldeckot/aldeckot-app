(() => {
  if (window.AldeckotLoading) return;

  const visibleTasks = new Map();
  let serial = 0;
  let hideTimer = 0;
  let overlay;
  let label;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'aldeckot-loading-indicator';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Carregando');
    overlay.innerHTML = '<div class="aldeckot-loading-card"><span class="aldeckot-loading-orbit" aria-hidden="true"></span><p class="aldeckot-loading-label">Carregando…</p><span class="aldeckot-loading-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>';
    label = overlay.querySelector('.aldeckot-loading-label');
    document.body.appendChild(overlay);
    return overlay;
  }

  function refresh() {
    const active = [...visibleTasks.values()];
    if (!active.length) {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (!visibleTasks.size) overlay?.classList.remove('is-visible');
      }, 150);
      return;
    }

    window.clearTimeout(hideTimer);
    const current = ensureOverlay();
    label.textContent = active.at(-1)?.message || 'Carregando…';
    current.classList.add('is-visible');
  }

  function begin(message = 'Carregando…', delay = 0) {
    const token = `loading-${++serial}`;
    const task = { message, shown: delay <= 0, timer: 0 };
    visibleTasks.set(token, task);
    if (task.shown) refresh();
    else {
      task.timer = window.setTimeout(() => {
        const pending = visibleTasks.get(token);
        if (!pending) return;
        pending.shown = true;
        refresh();
      }, delay);
    }
    return token;
  }

  function end(token) {
    const task = visibleTasks.get(token);
    if (!task) return;
    window.clearTimeout(task.timer);
    visibleTasks.delete(token);
    if ([...visibleTasks.values()].some(item => item.shown)) refresh();
    else overlay?.classList.remove('is-visible');
  }

  function track(promise, message = 'Sincronizando dados…') {
    const token = begin(message, 180);
    return Promise.resolve(promise).finally(() => end(token));
  }

  function beginSave(message = 'Salvando informações…', minimumDuration = 260) {
    const startedAt = Date.now();
    const token = begin(message);
    return async () => {
      const remaining = Math.max(0, Number(minimumDuration) - (Date.now() - startedAt));
      if (remaining) await new Promise(resolve => window.setTimeout(resolve, remaining));
      end(token);
    };
  }

  window.AldeckotLoading = { show: begin, hide: end, track, beginSave };

  const startup = begin('Preparando sistema…');
  window.addEventListener('load', () => window.setTimeout(() => end(startup), 260), { once: true });
  window.addEventListener('beforeunload', () => begin('Abrindo módulo…'));

  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = (...args) => track(nativeFetch(...args));
  }
})();
