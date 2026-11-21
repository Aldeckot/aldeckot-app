/* Painéis visuais das telas iniciais. Recebem apenas contagens já carregadas pelos módulos. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotModulePanels = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const count = value => Math.max(0, Number(value) || 0);
  const icon = name => {
    const paths = {
      plus: '<path d="M12 4v16M4 12h16"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
      folder: '<path d="M3 7h7l2 2h9v10H3z"/>',
      report: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8"/>',
      alert: '<path d="M12 3 2 21h20L12 3Zm0 6v5m0 4v.1"/>',
      history: '<path d="M3 12a9 9 0 1 0 3-7M3 4v5h5m4-2v5l4 2"/>',
      backup: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.folder}</svg>`;
  };
  const legend = rows => `<div class="module-home-legend">${rows.map(row => `<span><i style="--panel-color:${escape(row.color)}"></i><em>${escape(row.label)}</em><b>${count(row.count)}</b></span>`).join('')}</div>`;
  const bars = (title, rows) => {
    const max = Math.max(1, ...rows.map(row => count(row.count)));
    return `<section class="module-home-panel"><h3>${escape(title)}</h3><div class="module-home-bars" role="img" aria-label="${escape(title + ': ' + rows.map(row => `${row.label} ${count(row.count)}`).join(', '))}">${rows.map(row => `<span style="--panel-color:${escape(row.color)};--panel-height:${Math.max(3, Math.round(count(row.count) / max * 64))}px" title="${escape(row.label)}: ${count(row.count)}"></span>`).join('')}</div>${legend(rows)}</section>`;
  };
  const donut = (title, rows) => {
    const total = rows.reduce((sum, row) => sum + count(row.count), 0);
    let angle = 0;
    const segments = rows.filter(row => count(row.count)).map(row => {
      const start = angle;
      angle += count(row.count) / total * 360;
      return `${row.color} ${start}deg ${angle}deg`;
    });
    return `<section class="module-home-panel"><h3>${escape(title)}</h3><div class="module-home-donut-layout"><div class="module-home-donut" style="--panel-donut:${segments.length ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(#37516d 0deg 360deg)'}" role="img" aria-label="${escape(title + ': ' + rows.map(row => `${row.label} ${count(row.count)}`).join(', '))}"><b>${total}<small>Total</small></b></div>${legend(rows)}</div></section>`;
  };
  const actions = (items, attribute) => `<section class="module-home-panel module-home-actions"><h3>Ações Rápidas</h3>${items.map(item => `<button type="button" ${attribute}="${escape(item.id)}"${item.disabled ? ' disabled' : ''}>${icon(item.icon)}<span>${escape(item.label)}</span></button>`).join('')}</section>`;
  return { bars, donut, actions };
});
