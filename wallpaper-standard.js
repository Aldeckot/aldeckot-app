/* Mantém o mesmo ponto da animação após trocar de tela, tema ou aba. */
(() => {
  const root = document.documentElement;
  const durationValue = getComputedStyle(root).getPropertyValue('--aldeckot-wallpaper-duration').trim();
  const duration = Number.parseFloat(durationValue) * (durationValue.endsWith('ms') ? 1 : 1000);
  if (!Number.isFinite(duration) || duration <= 0) return;

  const synchronize = () => {
    root.style.setProperty('--aldeckot-wallpaper-phase', `${-(Date.now() % duration)}ms`);
  };

  synchronize();
  window.addEventListener('pageshow', synchronize);
  window.addEventListener('focus', synchronize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) synchronize();
  });
})();
