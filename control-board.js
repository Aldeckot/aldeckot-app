(() => {
  const tableControls = typeof module !== 'undefined' && module.exports
    ? require('./module-table-controls.js') : window.AldeckotModuleTableControls;
  const { periods, periodLabel, periodOptions } = tableControls;
  const statuses = Object.freeze({
    'Em manutenção': ['maintenance', '#ff394b'],
    'Concluído': ['done', '#12d779'],
    'Em uso': ['use', '#238df7'],
    'Descartado': ['discarded', '#aab8c7']
  });
  const situations = Object.freeze({
    'Aguardando verificação': ['waiting', '#ffd628'],
    'Cancelado': ['cancelled', '#ff394b'],
    'Verificação concluída': ['verified', '#0be180'],
    'Aguardando peça': ['part', '#aa56f7']
  });
  const missingColor = '#678198';
  const clean = value => String(value ?? '');
  const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const statusFor = item => {
    if (Object.hasOwn(statuses, item.operationalStatus)) return item.operationalStatus;
    if (Object.hasOwn(statuses, item.status)) return item.status;
    return item.status === 'Manutenção concluída' ? 'Concluído' : '';
  };
  const situationFor = item => Object.hasOwn(situations, item.operationalSituation) ? item.operationalSituation : '';
  const stateMatch = (actual, filter) => !filter || (filter === '__missing__' ? !actual : actual === filter);

  function matches(item, filters) {
    const values = [item.equipment, item.serial, item.model, item.brand, item.tag, item.sector];
    return values.some(value => normalize(value).includes(normalize(filters.query)))
      && stateMatch(statusFor(item), filters.status)
      && stateMatch(situationFor(item), filters.situation);
  }

  const paths = {
    plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8m-4-4v8"/>',
    parts: '<path d="m12 2 5 3v6l-5 3-5-3V5l5-3Zm-5 9-5 3v6l5 3 5-3v-6m5-3 5 3v6l-5 3-5-3m0-6 5 3 5-3m-5 3v6M2 14l5 3 5-3m-5 3v6m0-18 5 3 5-3m-5 3v6"/>',
    preventive: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 10h18m-12 6 2 2 4-4"/>',
    reports: '<rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="4" width="4" height="17" rx="1"/><rect x="17" y="8" width="4" height="13" rx="1"/>',
    wrench: '<path d="M19.5 4.5a5.3 5.3 0 0 0-7 6.6l-8 8a1.7 1.7 0 0 0 2.4 2.4l8-8a5.3 5.3 0 0 0 6.6-7l-3.2 3.2-2.1-2.1Z"/>',
    bolt: '<path d="m13 2-8 12h6l-1 8 9-12h-6l1-8Z"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4m-4 0h8"/>',
    shield: '<path d="M12 3 5 6v5c0 4 2.5 7.3 7 10 4.5-2.7 7-6 7-10V6Zm-3 9 2 2 4-4"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  const pdfIcon = '<img class="pdf-export-icon" src="assets/pdf-export.svg" width="21" height="21" alt="">';

  function headerScene() {
    const circuits = [
      'M14 43h52l16-16h53l26 25h41', 'M39 82h61l17-16h48l13-14h24',
      'M258 52h34l24-25h48l16 16h66', 'M258 52h28l13 14h40l17 16h65',
      'M118 13h42l15 15h23l17 12', 'M245 67l21 21h42l12 12h32'
    ];
    const nodes = [
      ['wrench', 113, 27, '#51dfff', -.8], ['monitor', 157, 73, '#8cb9ff', -3.2],
      ['shield', 302, 73, '#55ecc6', -1.2], ['bolt', 347, 27, '#ffdf67', -2.7],
      ['parts', 402, 65, '#be98ff', -4.1]
    ];
    return `<svg class="control-scene-art" viewBox="0 0 460 104" aria-hidden="true" focusable="false">
      <g class="control-scene-traces">${circuits.map(path => `<path d="${path}"/>`).join('')}</g>
      <g class="control-scene-signals">${circuits.map((path, index) =>
        `<path d="${path}" pathLength="100" style="--delay:-${index * .65}s"/>`).join('')}</g>
      <g class="control-scene-terminals">
        <circle cx="14" cy="43" r="2"/><circle cx="39" cy="82" r="2"/><circle cx="118" cy="13" r="2"/>
        <circle cx="352" cy="100" r="2"/><circle cx="421" cy="82" r="2"/><circle cx="446" cy="43" r="2"/>
      </g>
      <circle class="control-scene-ring" cx="230" cy="52" r="38"/>
      <circle class="control-scene-pulse" cx="230" cy="52" r="32"/>
      <g class="control-scene-core">
        <rect x="202" y="24" width="56" height="56" rx="14"/>
        <g transform="translate(212 34) scale(1.5)">${paths.chip}</g>
      </g>
      ${nodes.map(([symbol, x, y, tone, delay]) => `<g transform="translate(${x} ${y})">
        <g class="control-scene-node" style="--tone:${tone};--delay:${delay}s">
          <rect x="-16" y="-16" width="32" height="32" rx="9"/>
          <g transform="translate(-10 -10) scale(.83)">${paths[symbol]}</g>
        </g></g>`).join('')}
    </svg>`;
  }
  const options = (palette, selected) => Object.keys(palette).map(value =>
    `<option value="${escape(value)}"${selected === value ? ' selected' : ''}>${escape(value)}</option>`).join('');
  const columns = ['Equipamento', 'Modelo', 'Marca', 'TAG', 'Setor', 'Entrada',
    'Saída', 'Limpeza', 'Status', 'Situação'];
  const reportColumns = [...columns.slice(0, 4), 'Nº de série', ...columns.slice(4), 'Observações'];
  const tableHead = (labels = columns) => `<thead><tr>${labels.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>`;
  const itemCleaning = item => item.equipmentState?.cleaning_type || item.situation;

  function pill(value, palette, { legacy = '', empty = '—', emptyLabel = empty } = {}) {
    if (!value) return legacy
      ? `<span class="control-board-legacy" title="Status técnico: ${escape(legacy)}">A revisar</span>`
      : `<span aria-label="${escape(emptyLabel)}" title="${escape(emptyLabel)}">${escape(empty)}</span>`;
    return `<span class="control-board-pill ${palette[value]?.[0] || 'cleaning'}">${escape(value)}</span>`;
  }
  function row(item, dateValue) {
    const cleaning = itemCleaning(item);
    const cells = [`<button type="button" data-control-open-item="${escape(item.id)}">${escape(item.equipment || '—')}</button>`,
      ...[item.model, item.brand, item.tag, item.sector].map(value => escape(value || '—')),
      dateValue(item.entryDate), dateValue(item.exitDate), cleaning
        ? `<span class="cleaning-pill" data-cleaning="${escape(cleaning)}">${escape(cleaning)}</span>` : '—',
      pill(statusFor(item), statuses, { legacy: item.status }),
      pill(situationFor(item), situations, { emptyLabel: 'Sem situação definida' })];
    return `<tr data-inv-item="${escape(item.id)}">${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
  }
  function tableMarkup(table, tables, state) {
    return `<div class="module-table-nav control-board-nav">${tableControls.homeButton('Início do Controle TI')}</div>
      ${tableControls.filters({
        name: 'Controle TI', table, tables, state, statuses: Object.keys(statuses), situations: Object.keys(situations),
        placeholder: 'Buscar equipamento, série, marca, TAG...', className: 'control-board-filters',
        missingLabels: { status: 'Status a revisar', situation: 'Sem situação definida' }
      })}
      <section class="control-board-table"><div class="inventory-data-wrap"><table class="inventory-data control-data">
        ${tableHead()}<tbody></tbody>
      </table></div><footer class="control-board-pagination"></footer></section>`;
  }

  function pdfDialog(ordered, selected) {
    return `<header class="control-pdf-dialog-header">
        <div>${pdfIcon}<h2 id="control-pdf-title">Exportar PDF</h2></div>
        <button type="button" class="control-pdf-close" aria-label="Fechar exportação" data-control-pdf-close>×</button>
      </header>
      <div class="control-pdf-options">
        <label>Período<select name="period" autofocus>${periodOptions(ordered, selected)}</select></label>
        <label>Registros<select name="scope"><option value="all">Todos do mês</option><option value="filtered">Com os filtros atuais</option></select></label>
        <p role="status" data-control-pdf-count></p>
      </div>
      <div class="control-pdf-preview" tabindex="0" aria-label="Prévia do relatório" role="region">
        <article class="control-pdf-report"></article>
      </div>
      <footer class="control-pdf-dialog-footer">
        <p>Selecione “Salvar como PDF” na janela de impressão.</p>
        <button type="button" data-control-pdf-print>${pdfIcon} Salvar como PDF</button>
      </footer>`;
  }

  function pdfReport(table, items, scopeLabel, stamp, dateValue) {
    const rows = items.map(item => {
      const fields = [item.equipment, item.model, item.brand, item.tag, item.serial, item.sector, dateValue(item.entryDate),
        dateValue(item.exitDate), itemCleaning(item), statusFor(item) || (item.status ? 'A revisar' : ''),
        situationFor(item), item.notes];
      return `<tr>${fields.map(value => `<td>${escape(value || '—')}</td>`).join('')}</tr>`;
    }).join('');
    return `<header class="control-pdf-report-header"><img src="assets/aldeckot-symbol.png?v=2.0.73" alt="">
      <div><h3>ALDECKOT · Controle TI</h3><p>${escape(periodLabel(table))} · ${escape(scopeLabel)} · ${items.length} ${items.length === 1 ? 'registro' : 'registros'}</p></div>
      <small>Gerado em ${escape(stamp)}</small></header>
      <table aria-label="Equipamentos do relatório">${tableHead(reportColumns)}<tbody>${rows ||
        `<tr><td colspan="${reportColumns.length}">Nenhum equipamento corresponde a esta seleção.</td></tr>`}</tbody></table>`;
  }

  function valuesFor(items, getter, palette) {
    const counts = new Map(Object.keys(palette).map(value => [value, 0]));
    let missing = 0;
    for (const item of items) {
      const value = getter(item);
      if (counts.has(value)) counts.set(value, counts.get(value) + 1);
      else missing += 1;
    }
    return { counts, missing };
  }
  function statusCounts(items) {
    const { counts, missing } = valuesFor(items, statusFor, statuses);
    if (missing) counts.set('Status a revisar', missing);
    return Object.fromEntries(counts);
  }

  function sidebar(items, canManage) {
    const situation = valuesFor(items, situationFor, situations);
    const legend = ({ counts, missing }, palette, description) => `<div class="control-board-legend">${[...counts].map(([name, count]) =>
      `<span><i style="--tone:${palette[name][1]}"></i>${name}<b>${count}</b></span>`).join('')}
      ${missing ? `<span><i style="--tone:${missingColor}"></i>${description}<b>${missing}</b></span>` : ''}</div>`;
    let arc = 0;
    const segments = [...[...situation.counts].map(([name, count]) => [situations[name][1], count]),
      [missingColor, situation.missing]].filter(([, count]) => count > 0).map(([color, count]) => {
      const start = arc;
      arc += count * 360 / items.length;
      return `${color} ${start}deg ${arc}deg`;
    });
    const donut = segments.length ? `conic-gradient(${segments.join(', ')})` : missingColor;
    const actions = [['add-item', 'plus', 'Nova Manutenção'], ['control-part', 'parts', 'Solicitar Peça'],
      ['control-preventive', 'preventive', 'Preventiva'], ['control-report', 'reports', 'Relatórios']];
    return `<section class="control-board-panel"><h3>Distribuição por Situação</h3><div class="control-board-situations">
        <div class="control-board-donut" style="--donut:${donut}" role="img" aria-label="${items.length} registros por situação"><div><b>${items.length}</b><small>Total</small></div></div>
        ${legend(situation, situations, 'Sem situação definida')}</div></section>
      <section class="control-board-panel"><h3>Ações Rápidas</h3><div class="control-board-actions">${actions.map(([action, symbol, label]) =>
        `<button type="button" data-inv-action="${action}"${!canManage && action !== 'control-report' ? ' disabled' : ''}>${icon(symbol)}<span>${label}</span></button>`).join('')}</div></section>`;
  }
  function pagination(total, page, pageSize, sizes) {
    const last = Math.max(1, Math.ceil(total / pageSize));
    const firstLink = Math.max(1, Math.min(page - 2, last - 4));
    const numbered = Array.from({ length: Math.min(5, last) }, (_, index) => firstLink + index);
    return `<span>Mostrando ${total ? (page - 1) * pageSize + 1 : 0} a ${Math.min(page * pageSize, total)} de ${total} registros</span>
      <nav aria-label="Páginas"><button type="button" data-inv-page="${page - 1}" aria-label="Página anterior"${page <= 1 ? ' disabled' : ''}>‹</button>
        ${numbered.map(number => `<button type="button" data-inv-page="${number}"${number === page ? ' aria-current="page"' : ''}>${number}</button>`).join('')}
        <button type="button" data-inv-page="${page + 1}" aria-label="Próxima página"${page >= last ? ' disabled' : ''}>›</button></nav>
      <label>Itens por página <select data-inv-page-size aria-label="Itens por página">${sizes.map(size =>
        `<option value="${size}"${pageSize === size ? ' selected' : ''}>${size}</option>`).join('')}</select></label>`;
  }

  const api = { statuses, situations, statusFor, situationFor, statusCounts, matches, periods, options, pill, row,
    tableMarkup, sidebar, pagination, headerScene, pdfDialog, pdfReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AldeckotControlBoard = api;
})();
