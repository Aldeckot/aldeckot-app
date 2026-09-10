(() => {
  if (window.AldeckotLoading) return;

  const visibleTasks = new Map();
  let serial = 0;
  let hideTimer = 0;
  let revealFrame = 0;
  let shownAt = 0;
  let overlay;
  let label;
  const minimumVisibleDuration = 340;

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
    const active = [...visibleTasks.values()].filter(task => task.shown);
    if (!active.length) {
      window.clearTimeout(hideTimer);
      window.cancelAnimationFrame(revealFrame);
      revealFrame = 0;
      const remaining = Math.max(0, minimumVisibleDuration - (Date.now() - shownAt));
      hideTimer = window.setTimeout(() => {
        if (![...visibleTasks.values()].some(task => task.shown)) {
          overlay?.classList.remove('is-visible');
          shownAt = 0;
        }
      }, remaining);
      return;
    }

    window.clearTimeout(hideTimer);
    const current = ensureOverlay();
    label.textContent = active.at(-1)?.message || 'Carregando…';
    if (current.classList.contains('is-visible') || revealFrame) return;
    revealFrame = window.requestAnimationFrame(() => {
      revealFrame = 0;
      if (![...visibleTasks.values()].some(task => task.shown)) return;
      current.classList.add('is-visible');
      shownAt = Date.now();
    });
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
    refresh();
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
