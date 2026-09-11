(() => {
  const brand = document.querySelector('.home-page .brand');
  if (!brand) return;

  brand.setAttribute('aria-label', 'Aldeckot');
  brand.innerHTML = '<span class="home-brand-mark" aria-hidden="true">'
    + '<img class="official-logo-image" src="assets/aldeckot-logo.svg" alt="">'
    + '</span><b>Aldeckot</b>';
})();
