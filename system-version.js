(() => {
  // Fonte única da versão exibida nas telas do Aldeckot.
  const value = '2.0.26';
  const label = 'V' + value;
  window.AldeckotSystemVersion = Object.freeze({ value, label });

  const render = () => {
    document.querySelectorAll('[data-aldeckot-system-version]').forEach(node => {
      node.textContent = label;
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
})();
