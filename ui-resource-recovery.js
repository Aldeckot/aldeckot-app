(() => {
  const failedStyles = new Set();
  const failedScripts = new Set();
  const failedImages = new Set();
  const styleAttempts = new WeakMap();
  const imageAttempts = new WeakMap();
  const reloadKey = `aldeckot:ui-resource-reload:${window.location.pathname}`;
  const maxStyleAttempts = 3;
  let retryTimer = 0;
  let imageTimer = 0;
  let scriptTimer = 0;
  let lastResumeRetry = 0;
  let notice = null;
  let userEdited = false;

  function readReloadCount() {
    try { return Number(window.sessionStorage.getItem(reloadKey)) || 0; }
    catch { return 1; }
  }

  function writeReloadCount(value) {
    try { window.sessionStorage.setItem(reloadKey, String(value)); return true; }
    catch { return false; }
  }

  function clearReloadCount() {
    try { window.sessionStorage.removeItem(reloadKey); }
    catch { /* A página continua utilizável sem armazenamento de sessão. */ }
  }

  function hasUnsavedInput() {
    if (userEdited) return true;
    return [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].some(element => {
      if (element.matches('input[type="hidden"], input[type="checkbox"], input[type="radio"]')) return false;
      if (element.matches('input[type="file"]')) return Boolean(element.files?.length);
      return String(element.value ?? element.textContent ?? '').length > 0;
    });
  }

  function showNotice() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', showNotice, { once: true });
      return;
    }
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'aldeckot-resource-notice';
      notice.setAttribute('role', 'alert');
      notice.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:12px;max-width:min(440px,calc(100vw - 32px));padding:12px 14px;border:1px solid #69caff;border-radius:12px;background:#10243bf2;box-shadow:0 12px 35px #0009;color:#f2f9ff;font:600 12px/1.4 system-ui,sans-serif';
      const message = document.createElement('span');
      message.dataset.resourceMessage = 'true';
      const button = document.createElement('button');
      button.type = 'button';
      button.style.cssText = 'flex:none;padding:7px 9px;border:1px solid #70cfff;border-radius:7px;background:#126494;color:white;font:700 11px system-ui,sans-serif;cursor:pointer';
      button.addEventListener('click', () => {
        if (failedScripts.size) window.location.reload();
        else {
          resetStyleAttempts();
          resetImageAttempts();
          retryStyles();
          retryImages();
        }
      });
      notice.append(message, button);
    }
    notice.querySelector('[data-resource-message]').textContent = failedScripts.size
      ? 'Parte do sistema não carregou. Salve dados digitados antes de recarregar.'
      : 'Parte do visual não carregou. Verifique a conexão e tente novamente.';
    notice.querySelector('button').textContent = failedScripts.size ? 'Recarregar' : 'Tentar novamente';
    if (!notice.isConnected) document.body.append(notice);
  }

  function hideNoticeIfRecovered() {
    if (!failedStyles.size && !failedScripts.size && !failedImages.size) notice?.remove();
  }

  function retryStyles() {
    window.clearTimeout(retryTimer);
    retryTimer = 0;
    for (const link of failedStyles) {
      if (!link.isConnected) {
        failedStyles.delete(link);
        continue;
      }
      const attempts = styleAttempts.get(link) || 0;
      if (attempts >= maxStyleAttempts) {
        showNotice();
        continue;
      }
      styleAttempts.set(link, attempts + 1);
      const url = new URL(link.href, window.location.href);
      url.searchParams.set('uiRetry', String(Date.now()));
      link.href = url.href;
    }
    hideNoticeIfRecovered();
  }

  function scheduleStyles() {
    if (retryTimer) return;
    const attempts = Math.max(0, ...[...failedStyles].map(link => styleAttempts.get(link) || 0));
    retryTimer = window.setTimeout(retryStyles, Math.min(400 * 2 ** attempts, 3200));
  }

  function resetStyleAttempts() {
    for (const link of failedStyles) styleAttempts.delete(link);
  }

  function isLocalAsset(image) {
    try {
      const url = new URL(image.currentSrc || image.src, window.location.href);
      return url.origin === window.location.origin && /\/assets\//.test(url.pathname);
    } catch { return false; }
  }

  function retryImages() {
    window.clearTimeout(imageTimer);
    imageTimer = 0;
    for (const image of failedImages) {
      if (!image.isConnected) {
        failedImages.delete(image);
        continue;
      }
      const attempts = imageAttempts.get(image) || 0;
      if (attempts >= 2) {
        showNotice();
        continue;
      }
      imageAttempts.set(image, attempts + 1);
      const url = new URL(image.src, window.location.href);
      url.searchParams.set('uiRetry', String(Date.now()));
      image.src = url.href;
    }
    hideNoticeIfRecovered();
  }

  function resetImageAttempts() {
    for (const image of failedImages) imageAttempts.delete(image);
  }

  function scheduleImages() {
    if (!imageTimer) imageTimer = window.setTimeout(retryImages, 600);
  }

  function checkStyles() {
    if (document.readyState === 'loading') return;
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      if (!link.disabled && !link.sheet) failedStyles.add(link);
    });
    if (failedStyles.size) scheduleStyles();
  }

  function recoverScripts() {
    window.clearTimeout(scriptTimer);
    scriptTimer = 0;
    if (!failedScripts.size) return;
    if (window.navigator.onLine === false || hasUnsavedInput() || readReloadCount() >= 1) {
      showNotice();
      return;
    }
    if (writeReloadCount(1)) window.location.reload();
    else showNotice();
  }

  function onResume() {
    if (document.visibilityState === 'hidden') return;
    checkStyles();
    if (failedStyles.size && Date.now() - lastResumeRetry > 15000) {
      lastResumeRetry = Date.now();
      resetStyleAttempts();
      resetImageAttempts();
      retryStyles();
      retryImages();
    }
    if (failedImages.size && !failedStyles.size && Date.now() - lastResumeRetry > 15000) {
      lastResumeRetry = Date.now();
      resetImageAttempts();
      retryImages();
    }
    if (failedScripts.size) recoverScripts();
  }

  document.addEventListener('error', event => {
    const resource = event.target;
    if (resource?.tagName === 'LINK' && resource.rel === 'stylesheet') {
      failedStyles.add(resource);
      scheduleStyles();
    } else if (resource?.tagName === 'SCRIPT' && resource.src) {
      failedScripts.add(resource);
      if (!scriptTimer) scriptTimer = window.setTimeout(recoverScripts, 800);
    } else if (resource?.tagName === 'IMG' && isLocalAsset(resource)) {
      failedImages.add(resource);
      scheduleImages();
    }
  }, true);

  document.addEventListener('input', () => { userEdited = true; }, true);
  document.addEventListener('change', () => { userEdited = true; }, true);

  document.addEventListener('load', event => {
    const resource = event.target;
    if (resource?.tagName === 'LINK' && resource.rel === 'stylesheet') {
      failedStyles.delete(resource);
      styleAttempts.delete(resource);
    } else if (resource?.tagName === 'IMG') {
      failedImages.delete(resource);
      imageAttempts.delete(resource);
    } else return;
    hideNoticeIfRecovered();
  }, true);

  for (const resource of window.__aldeckotResourceErrors || []) {
    if (resource.tagName === 'LINK' && resource.rel === 'stylesheet') failedStyles.add(resource);
    if (resource.tagName === 'SCRIPT' && resource.src && !/\/ui-resource-recovery\.js(?:\?|$)/.test(resource.src)) failedScripts.add(resource);
  }
  if (failedStyles.size) scheduleStyles();
  if (failedScripts.size) scriptTimer = window.setTimeout(recoverScripts, 800);

  window.addEventListener('load', () => {
    window.setTimeout(checkStyles, 0);
    if (!failedScripts.size) clearReloadCount();
  }, { once: true });
  window.addEventListener('pageshow', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('online', onResume);
  document.addEventListener('visibilitychange', onResume);

  window.AldeckotResourceRecovery = { check: checkStyles };
})();
