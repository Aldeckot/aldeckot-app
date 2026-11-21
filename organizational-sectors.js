(() => {
  const names = Object.freeze([
    'Frente de Loja', 'Doca', 'Escritório', 'Informática', 'Monitoramento',
    'Tesouraria', 'Padaria', 'Açougue', 'Refeitório'
  ]);
  const normalize = value => String(value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
  const optionsFor = current => {
    const value = String(current ?? '').trim();
    return ['', ...(value && !names.some(name => normalize(name) === normalize(value)) ? [value] : []), ...names];
  };
  window.AldeckotSectors = Object.freeze({ names, normalize, optionsFor });
})();
