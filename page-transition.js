(() => {
  const HOME_URL = 'index.html';
  const TRANSITION_KEY = 'aldeckot-home-transition';
  const DURATION = 430;
  const HOME_RENDER_MAX_WAIT = 600;
  const APP_ROUTE_FILES = new Set(['index.html', 'inventory.html', 'management.html', 'control.html', 'flux.html', 'nfe.html', 'settings.html']);
  const homeTasks = new Set();
  let isNavigating = false;
  let homeDomReady = document.readyState !== 'loading';
  let homeRevealQueued = false;
  let homeRevealed = false;
  let homeDataReady = null;
  let moduleRevealQueued = false;
  let moduleRevealed = false;
  let homeWaitTimer = 0;
  let homeWaitExpired = false;
  let navigationTimer = 0;

  // No retorno de um módulo, a estrutura da Home já existe no HTML. Ela não
  // precisa aguardar uma nova consulta ao banco para começar a transição.
  // Agenda e itens recentes continuam a ser atualizados em segundo plano.
  const hasPendingHomeTransition = () => {
    try {
      return new URLSearchParams(window.location.search).get('aldeckotTransition') === 'home'
        || sessionStorage.getItem(TRANSITION_KEY) === '1';
    } catch { return false; }
  };
  const homeTransitionReturn = hasPendingHomeTransition();

  const nextFrame = () => new Promise(resolve => window.requestAnimationFrame(resolve));
  const isHome = () => document.body?.classList.contains('home-page');
  const isModule = () => Boolean(document.body?.matches('[data-inventory-page], [data-management-page], .settings-page'));

  function storeHomeEntrance() {
    try { sessionStorage.setItem(TRANSITION_KEY, '1'); }
    catch { /* A transição de saída continua mesmo sem armazenamento temporário. */ }
  }

  function consumeHomeEntrance() {
    try {
      if (sessionStorage.getItem(TRANSITION_KEY) !== '1') return false;
      sessionStorage.removeItem(TRANSITION_KEY);
      return true;
    } catch { return false; }
  }

  function cleanHomeRouteMarker() {
    const locationUrl = new URL(window.location.href);
    if (locationUrl.searchParams.get('aldeckotTransition') !== 'home') return;
    locationUrl.searchParams.delete('aldeckotTransition');
    window.history.replaceState(window.history.state, '', `${locationUrl.pathname}${locationUrl.search}${locationUrl.hash}`);
  }

  async function revealHomeWhenStable() {
    if (!isHome() || homeRevealed || homeRevealQueued || !homeDomReady) return;
    if (homeTasks.size && !homeWaitExpired) {
      if (!homeWaitTimer) homeWaitTimer = window.setTimeout(() => {
        homeWaitTimer = 0;
        homeWaitExpired = true;
        revealHomeWhenStable();
      }, HOME_RENDER_MAX_WAIT);
      return;
    }
    window.clearTimeout(homeWaitTimer);
    homeWaitTimer = 0;
    homeRevealQueued = true;
    try {
      await Promise.race([
        (document.fonts?.ready || Promise.resolve()).catch(() => {}),
        new Promise(resolve => window.setTimeout(resolve, 300))
      ]);
      await nextFrame();
      await nextFrame();
      if (!isHome() || homeRevealed || (homeTasks.size && !homeWaitExpired)) return;
      homeRevealed = true;
      const root = document.documentElement;
      root.classList.remove('aldeckot-home-booting', 'aldeckot-home-transition-pending');
      root.classList.add('aldeckot-home-revealing');
      document.body.classList.add('aldeckot-home-entering');
      window.setTimeout(() => {
        root.classList.remove('aldeckot-home-revealing');
        document.body.classList.remove('aldeckot-home-entering');
      }, 620);
    } finally {
      homeRevealQueued = false;
      if (!homeRevealed && homeTasks.size) revealHomeWhenStable();
    }
  }

  function ensureHomeDataReady() {
    if (!homeDataReady) {
      homeDataReady = Promise.resolve().then(() => {
        const api = window.AldeckotSupabase;
        return typeof api?.init === 'function' ? api.init() : null;
      });
    }
    return homeDataReady;
  }

  async function revealModuleWhenStable() {
    if (!isModule() || moduleRevealed || moduleRevealQueued) return;
    moduleRevealQueued = true;
    try {
      await Promise.race([
        (document.fonts?.ready || Promise.resolve()).catch(() => {}),
        new Promise(resolve => window.setTimeout(resolve, 300))
      ]);
      await nextFrame();
      await nextFrame();
      if (!isModule() || moduleRevealed) return;
      moduleRevealed = true;
      const root = document.documentElement;
      root.classList.remove('aldeckot-module-booting');
      root.classList.add('aldeckot-module-revealing');
      window.setTimeout(() => root.classList.remove('aldeckot-module-revealing'), 600);
    } finally {
      moduleRevealQueued = false;
    }
  }

  function holdHomeRender(name = 'pending') {
    if (!isHome()) return () => {};
    if (homeTransitionReturn) return () => {};
    const token = `${name}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    homeTasks.add(token);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      homeTasks.delete(token);
      revealHomeWhenStable();
    };
  }

  function prepareHomeEntrance() {
    if (!isHome()) return;
    consumeHomeEntrance();
    cleanHomeRouteMarker();
    revealHomeWhenStable();
  }

  function addRouteCurtain() {
    const curtain = document.createElement('div');
    curtain.className = 'aldeckot-route-curtain';
    curtain.setAttribute('aria-hidden', 'true');
    document.body.appendChild(curtain);
  }

  function restoreCachedPage() {
    window.clearTimeout(navigationTimer);
    window.clearTimeout(homeWaitTimer);
    homeWaitTimer = 0;
    isNavigating = false;
    document.body?.classList.remove('aldeckot-page-leaving', 'aldeckot-home-entering');
    document.querySelectorAll('.aldeckot-route-curtain').forEach(curtain => curtain.remove());
    const root = document.documentElement;
    root.classList.remove('aldeckot-home-revealing', 'aldeckot-module-revealing');
    if (isHome()) {
      homeRevealed = true;
      root.classList.remove('aldeckot-home-booting', 'aldeckot-home-transition-pending');
    }
    if (isModule()) {
      moduleRevealed = true;
      root.classList.remove('aldeckot-module-booting');
    }
    window.AldeckotLoading?.reset?.();
  }

  function navigate(destination) {
    if (isNavigating) return;
    const target = destination instanceof URL ? destination : new URL(destination, window.location.href);
    if (target.href === window.location.href) return;
    isNavigating = true;
    if (/\/index\.html$/i.test(target.pathname)) {
      storeHomeEntrance();
      target.searchParams.set('aldeckotTransition', 'home');
    }
    document.body.classList.add('aldeckot-page-leaving');
    addRouteCurtain();
    const delay = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 0 : DURATION;
    navigationTimer = window.setTimeout(() => { window.location.href = target.href; }, delay);
  }

  function goHome() { navigate(HOME_URL); }

  function isAppLink(anchor) {
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
    const href = anchor.getAttribute('href');
    if (!href) return false;
    try {
      const target = new URL(href, window.location.href);
      return target.origin === window.location.origin && APP_ROUTE_FILES.has(target.pathname.split('/').pop().toLowerCase());
    } catch { return false; }
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const appLink = event.target.closest('a[href]');
    if (!isAppLink(appLink)) return;
    event.preventDefault();
    navigate(appLink.href);
  }, true);

  window.AldeckotRoute = { goHome, navigate };
  window.AldeckotHomeStage = { hold: holdHomeRender, ready: ensureHomeDataReady };
  window.AldeckotModuleStage = { reveal: revealModuleWhenStable };

  window.addEventListener('pageshow', event => {
    if (event.persisted) restoreCachedPage();
  });

  if (isModule()) {
    // Evita que uma conexão lenta deixe a interface vazia indefinidamente.
    window.setTimeout(revealModuleWhenStable, 1400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      homeDomReady = true;
      prepareHomeEntrance();
    }, { once: true });
  } else prepareHomeEntrance();
})();
