(() => {
  const HOME_URL = 'index.html';
  const TRANSITION_KEY = 'aldeckot-home-transition';
  const DURATION = 460;
  const homeTasks = new Set();
  let isNavigating = false;
  let homeDomReady = document.readyState !== 'loading';
  let homeRevealQueued = false;
  let homeRevealed = false;
  let homeDataReady = null;
  let moduleRevealQueued = false;
  let moduleRevealed = false;

  const nextFrame = () => new Promise(resolve => window.requestAnimationFrame(resolve));
  const isHome = () => document.body?.classList.contains('home-page');
  const isModule = () => Boolean(document.body?.matches('[data-inventory-page], [data-management-page]'));

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
    if (!isHome() || homeRevealed || homeRevealQueued || !homeDomReady || homeTasks.size) return;
    homeRevealQueued = true;
    try {
      await (document.fonts?.ready || Promise.resolve()).catch(() => {});
      await nextFrame();
      await nextFrame();
      if (!isHome() || homeRevealed || homeTasks.size) return;
      homeRevealed = true;
      const root = document.documentElement;
      root.classList.remove('aldeckot-home-booting', 'aldeckot-home-transition-pending');
      root.classList.add('aldeckot-home-revealing');
      document.body.classList.add('aldeckot-home-entering');
      window.setTimeout(() => {
        root.classList.remove('aldeckot-home-revealing');
        document.body.classList.remove('aldeckot-home-entering');
      }, 640);
    } finally {
      homeRevealQueued = false;
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
      await (document.fonts?.ready || Promise.resolve()).catch(() => {});
      await nextFrame();
      await nextFrame();
      if (!isModule() || moduleRevealed) return;
      moduleRevealed = true;
      const root = document.documentElement;
      root.classList.remove('aldeckot-module-booting');
      root.classList.add('aldeckot-module-revealing');
      window.setTimeout(() => root.classList.remove('aldeckot-module-revealing'), 520);
    } finally {
      moduleRevealQueued = false;
    }
  }

  function holdHomeRender(name = 'pending') {
    if (!isHome()) return () => {};
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

  function goHome() {
    if (isNavigating) return;
    isNavigating = true;
    storeHomeEntrance();
    const destination = new URL(HOME_URL, window.location.href);
    destination.searchParams.set('aldeckotTransition', 'home');
    document.body.classList.add('aldeckot-page-leaving');
    addRouteCurtain();
    window.setTimeout(() => { window.location.href = destination.href; }, DURATION);
  }

  function isHomeLink(anchor) {
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
    const href = anchor.getAttribute('href');
    if (!href) return false;
    try {
      const target = new URL(href, window.location.href);
      return target.origin === window.location.origin && /\/index\.html$/i.test(target.pathname);
    } catch { return false; }
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const homeLink = event.target.closest('a[href]');
    if (!isHomeLink(homeLink)) return;
    event.preventDefault();
    goHome();
  }, true);

  window.AldeckotRoute = { goHome };
  window.AldeckotHomeStage = { hold: holdHomeRender, ready: ensureHomeDataReady };
  window.AldeckotModuleStage = { reveal: revealModuleWhenStable };

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
