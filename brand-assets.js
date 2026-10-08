(() => {
  const src = 'assets/aldeckot-symbol.png?v=2.0.71';
  const pdfSrc = 'assets/aldeckot-symbol-pdf.jpg?v=2.0.71';
  let dataUrlPromise;
  let pdfDataUrlPromise;

  function loadDataUrl(path) {
    return fetch(path, { cache: 'force-cache' }).then(response => {
      if (!response.ok) throw new Error('Não foi possível carregar o símbolo do Aldeckot.');
      return response.blob();
    }).then(blob => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Não foi possível preparar o símbolo do Aldeckot.'));
      reader.readAsDataURL(blob);
    }));
  }

  function dataUrl() {
    if (!dataUrlPromise) dataUrlPromise = loadDataUrl(src);
    return dataUrlPromise;
  }

  function pdfDataUrl() {
    if (!pdfDataUrlPromise) pdfDataUrlPromise = loadDataUrl(pdfSrc);
    return pdfDataUrlPromise;
  }

  window.AldeckotBrand = Object.freeze({ src, pdfSrc, dataUrl, pdfDataUrl });
})();
