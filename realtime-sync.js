(() => {
  let unsubscribe;
  let noticeTimer;
  let lastNoticeAt = 0;

  function showNotice() {
    const now = Date.now();
    if (now - lastNoticeAt < 1200) return;
    lastNoticeAt = now;
    let notice = document.querySelector('[data-aldeckot-realtime-notice]');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'aldeckot-realtime-notice';
      notice.dataset.aldeckotRealtimeNotice = 'true';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      document.body.append(notice);
    }
    notice.textContent = 'Dados atualizados em tempo real';
    notice.classList.add('show');
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => notice.classList.remove('show'), 2100);
  }

  async function connect() {
    await (window.AldeckotAuthReady || Promise.resolve());
    if (!window.AldeckotAuth?.session) return;
    const realtime = window.AldeckotSupabase?.realtime;
    if (!realtime?.subscribe) return;
    try {
      unsubscribe?.();
      unsubscribe = await realtime.subscribe(payload => {
        const detail = { table: payload.table, eventType: payload.eventType, record: payload.new || null, previous: payload.old || null };
        window.dispatchEvent(new CustomEvent('aldeckot:realtime-change', { detail }));
        showNotice();
      });
    } catch (error) {
      console.warn('Não foi possível iniciar as atualizações em tempo real.', error);
    }
  }

  window.addEventListener('beforeunload', () => unsubscribe?.(), { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', connect, { once: true });
  else connect();
})();
