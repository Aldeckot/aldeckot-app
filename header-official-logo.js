(() => {
  const headers = '.inventory-header, .management-header, .nfe-header';
  const brandMarkup = `
    <span class="system-header-brand-mark" aria-hidden="true">
      <img class="official-logo-image" src="assets/aldeckot-logo.svg" alt="">
    </span>
    <span class="system-header-brand-copy">
      <b>ALDECKOT</b>
      <small>Sistema de Gestão</small>
    </span>`;

  function actionsFor(header) {
    if (header.classList.contains('nfe-header')) return header.querySelector('.nfe-header-actions');
    if (header.classList.contains('management-header')) return header.querySelector('.management-header-actions');
    return header.querySelector('.inventory-header-actions');
  }

  function selectorsFor(header) {
    if (header.classList.contains('nfe-header')) return { sync: '.nfe-sync', home: '[data-nfe-home]' };
    if (header.classList.contains('management-header')) return { sync: '.management-sync', home: '[data-management-action="home"]' };
    return { sync: '.inventory-sync', home: '[data-inv-action="home"]' };
  }

  function addBrand(header) {
    if (!header) return;

    // Remove a assinatura antiga à esquerda antes de renderizar a nova área de retorno.
    header.querySelector('[data-official-header-logo]')?.remove();

    const actions = actionsFor(header);
    if (!actions) return;

    const selectors = selectorsFor(header);
    const sync = actions.querySelector(selectors.sync);
    const home = actions.querySelector(selectors.home);

    // Mantém as rotinas existentes de sincronização sem ocupar espaço no cabeçalho.
    if (sync) sync.hidden = true;
    if (home) home.remove();

    if (actions.querySelector('[data-system-header-brand]')) return;

    const brand = document.createElement('a');
    brand.className = 'system-header-brand';
    brand.dataset.systemHeaderBrand = 'true';
    brand.href = 'index.html';
    brand.setAttribute('aria-label', 'Voltar para a Home do ALDECKOT');
    brand.innerHTML = brandMarkup;
    actions.append(brand);
  }

  function apply() { document.querySelectorAll(headers).forEach(addBrand); }

  apply();
  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
})();
