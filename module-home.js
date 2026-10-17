/* Visão inicial dos módulos que já carregam suas tabelas completas. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotModuleHome = api;
})(typeof window !== 'undefined' ? window : null, () => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').trim();
  const date = value => value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const tone = value => String(value || '').toLowerCase().replaceAll(' ', '-');
  function listing(tables, state) {
    const query = normalize(state.query);
    const items = tables.flatMap(table => (table.items || []).map(item =>
      ({ ...item, tableId: table.id, tableName: table.name })))
      .sort((a, b) => String(b.updatedAt || b.date || '').localeCompare(String(a.updatedAt || a.date || '')));
    const matches = items.filter(item => !query || [item.tableName, item.equipment, item.tag, item.serial,
      item.brand, item.model, item.sector, item.senderCompany, item.destinationCompany]
      .some(value => normalize(value).includes(query)));
    const all = state.view === 'all' || Boolean(query);
    const pageSize = Math.max(1, Number(state.pageSize) || 25);
    const pages = Math.max(1, Math.ceil(matches.length / pageSize));
    const page = Math.max(1, Math.min(Number(state.page) || 1, pages));
    return { total: matches.length, pages, page, rows: all
      ? matches.slice((page - 1) * pageSize, page * pageSize)
      : matches.slice(0, 5), all };
  }
  function rowsMarkup(tables, state, module) {
    const rows = listing(tables, state).rows;
    const cols = module === 'flux' ? 8 : 7;
    if (!rows.length) return `<tr><td colspan="${cols}" class="inventory-empty-row">Nenhum equipamento encontrado.</td></tr>`;
    return rows.map(item => {
      const common = `data-inv-item="${escape(item.id)}" data-inv-table-id="${escape(item.tableId)}"`;
      const status = `<span class="inventory-status ${tone(item.status)}">${escape(item.status)}</span>`;
      if (module === 'flux') return `<tr ${common}><td>${escape(item.tableName)}</td><td>${escape(item.movement)}</td><td><b>${escape(item.equipment)}</b></td><td>${escape(item.tag)}</td><td>${escape(item.senderCompany)}</td><td>${escape(item.destinationCompany)}</td><td>${status}</td><td>${date(item.updatedAt || item.date)}</td></tr>`;
      return `<tr ${common}><td>${escape(item.tableName)}</td><td><b>${escape(item.equipment)}</b></td><td>${escape(item.tag)}</td><td>${escape(item.model)}</td><td>${escape(item.sector)}</td><td>${status}</td><td>${date(item.updatedAt || item.date)}</td></tr>`;
    }).join('');
  }
  function paginationMarkup(tables, state, moduleName) {
    const { total, pages, page, rows, all } = listing(tables, state);
    if (!all) return `<span>${rows.length} itens recentes · ${total} no ${escape(moduleName)}</span>`;
    return `<span>${total} ${total === 1 ? 'item encontrado' : 'itens encontrados'}</span><nav aria-label="Páginas da consulta"><button type="button" data-inv-module-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button><span>Página ${page} de ${pages}</span><button type="button" data-inv-module-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Próxima página">›</button></nav>`;
  }
  function markup(tables, state, module, moduleName) {
    const headings = module === 'flux'
      ? '<th>TABELA</th><th>MOV.</th><th>EQUIPAMENTO</th><th>TAG</th><th>REMETENTE</th><th>DESTINO</th><th>STATUS</th><th>ÚLTIMA ALTERAÇÃO</th>'
      : '<th>TABELA</th><th>EQUIPAMENTO</th><th>TAG</th><th>MODELO</th><th>SETOR</th><th>STATUS</th><th>ÚLTIMA ALTERAÇÃO</th>';
    return `<section class="inventory-panel inventory-global-search"><div class="inventory-search-wrap"><span>⌕</span><input class="inventory-search" data-inv-module-search value="${escape(state.query)}" placeholder="Buscar equipamento, TAG, série ou tabela…" aria-label="Buscar em todo o ${escape(moduleName)}" autocomplete="off"></div></section><section class="inventory-panel inventory-data-wrap inventory-global-data inventory-module-data"><table class="inventory-data"><thead><tr>${headings}</tr></thead><tbody>${rowsMarkup(tables, state, module)}</tbody></table></section><footer class="inventory-panel inventory-pagination inventory-global-pagination inventory-module-pagination">${paginationMarkup(tables, state, moduleName)}</footer>`;
  }
  return { listing, rowsMarkup, paginationMarkup, markup };
});
