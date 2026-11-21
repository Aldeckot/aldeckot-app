(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const paths = {
    home: '<path d="m3 10 9-7 9 7M5 9v11h14V9m-9 11v-6h4v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 10h18m-13 4h3m2 0h3m-8 3h3"/>',
    category: '<path d="M3 6h6l2 2h10v12H3zM3 12h18"/>',
    previous: '<path d="m15 6-6 6 6 6"/>',
    next: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;

  function monthKey(table) {
    const name = String(table.name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
    const [month, year] = name.replace(/\s*\/\s*/g, ' ').split(/\s+/);
    const index = months.indexOf(month);
    return index >= 0 && /^\d{4}$/.test(year) ? Number(year) * 12 + index : 0;
  }
  const periods = tables => [...tables].sort((a, b) => monthKey(b) - monthKey(a));
  function periodLabel(table) {
    const parts = String(table.name ?? '').trim().match(/^([\p{L}]+)\s*\/?\s*(\d{4})$/u);
    if (!parts) return table.name;
    const month = parts[1].toLocaleLowerCase('pt-BR');
    return `${month[0].toLocaleUpperCase('pt-BR')}${month.slice(1)} / ${parts[2]}`;
  }
  const option = (value, label, selected) =>
    `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`;
  function periodOptions(ordered, selected) {
    const groups = new Map();
    for (const table of ordered) {
      const key = monthKey(table);
      const year = key ? Math.floor(key / 12) : 'Outras tabelas';
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(option(table.id, periodLabel(table), selected));
    }
    return [...groups].map(([year, entries]) => `<optgroup label="${year}">${entries.join('')}</optgroup>`).join('');
  }

  function homeButton(label, global = false) {
    return `<button type="button" class="module-table-home" ${global ? 'data-inv-global-home' : 'data-inv-module-home'}
      aria-label="${escape(label)}" title="${escape(label)}">${icon('home')}</button>`;
  }

  function tablePicker(table, tables, byCategory) {
    const ordered = byCategory ? tables : periods(tables);
    const navigable = byCategory ? ordered : ordered.filter(entry => monthKey(entry));
    const index = navigable.findIndex(entry => entry.id === table.id);
    const offset = byCategory ? 1 : -1;
    const previous = index >= 0 ? navigable[index - offset] : null;
    const next = index >= 0 ? navigable[index + offset] : null;
    const labelFor = byCategory ? entry => entry.name : periodLabel;
    const step = (direction, label, entry) => `<button type="button" data-module-table-step="${direction}"
      data-table-id="${escape(entry?.id)}" aria-label="${label}"
      title="${entry ? escape(labelFor(entry)) : label}"${entry ? '' : ' disabled'}>${icon(direction)}</button>`;
    const entries = byCategory ? ordered.map(entry => option(entry.id, entry.name, table.id)).join('')
      : periodOptions(ordered, table.id);
    const caption = byCategory ? 'TABELA ATUAL' : 'PERÍODO ATUAL';
    const position = index >= 0 ? `${index + 1} / ${navigable.length}` : `— / ${navigable.length}`;
    return `<div class="module-table-picker" role="group" aria-label="${byCategory ? 'Navegação por categoria' : 'Navegação por mês'}">
      ${step('previous', byCategory ? 'Categoria anterior' : 'Mês anterior disponível', previous)}
      <label class="module-table-picker-field">${icon(byCategory ? 'category' : 'calendar')}
        <span class="module-table-picker-caption">${caption}<small>${position}</small></span>
        <select data-module-table-select aria-label="${byCategory ? 'Categoria' : 'Mês e ano'}" title="Selecionar ${byCategory ? 'categoria' : 'período'}">${entries}</select>${icon('down')}</label>
      ${step('next', byCategory ? 'Próxima categoria' : 'Mês seguinte disponível', next)}
    </div>`;
  }

  function filters({ name, table, tables, state, statuses, situations, placeholder, situationLabel = 'Situação',
    byCategory = false, actions = '', missingLabels = null, className = '' }) {
    const select = (field, label, all, values) => {
      const selected = state[field];
      const missing = missingLabels?.[field];
      return `<select data-inv-${field} aria-label="Filtrar por ${label.toLocaleLowerCase('pt-BR')}">
        ${option('', all, selected)}${values.map(value => option(value, value, selected)).join('')}
        ${missing ? option('__missing__', missing, selected) : ''}</select>`;
    };
    return `<section class="module-table-filters ${className}" aria-label="Filtros do ${escape(name)}">
      ${tablePicker(table, tables, byCategory)}
      <label class="module-table-search">${icon('search')}<input type="search" data-inv-search aria-label="Buscar equipamento"
        placeholder="${escape(placeholder)}" value="${escape(state.query)}"></label>
      ${select('status', 'Status', 'Status: Todos', statuses)}
      ${select('situation', situationLabel, situationLabel === 'Motivo' ? 'Motivo: Todos' : 'Situação: Todas', situations)}
      ${actions ? `<div class="module-table-tools">${actions}</div>` : ''}
    </section>`;
  }

  const api = { homeButton, periods, periodLabel, periodOptions, filters };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AldeckotModuleTableControls = api;
})();
