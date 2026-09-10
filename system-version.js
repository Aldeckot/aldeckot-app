(() => {
  // Fonte única da versão exibida nas telas do ALDECKOT.
  const value = '2.0.14';
  const label = `V${value}`;
  window.AldeckotSystemVersion = Object.freeze({ value, label });

  const render = () => {
    document.querySelectorAll('[data-aldeckot-system-version]').forEach(node => {
      node.textContent = label;
    });
    document.querySelectorAll('[data-aldeckot-brand-subtitle]').forEach(node => {
      const subtitle = node.dataset.aldeckotBrandSubtitle || 'SISTEMA DE GESTÃO';
      node.textContent = `${subtitle} ${label}`;
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render, { once: true });
  else render();
})();
