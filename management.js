(() => {
  const app = document.getElementById('managementApp');
  const modalNode = document.getElementById('managementModal');
  const toastNode = document.getElementById('managementToast');
  const restoreInput = document.getElementById('managementRestoreInput');
  const canManage = () => Boolean(window.AldeckotAuth?.isAdmin);
  const route = new URLSearchParams(window.location.search);
  const statuses = ['Ativo', 'Reserva', 'Defeito', 'Manutenção', 'Desativado'];
  const situations = ['Em Sala', 'Em Uso', 'Estoque', 'Em Manutenção'];
  const cleanings = ['Preventiva', 'Completa', 'Não Realizada'];
  const priorities = ['Alta', 'Média', 'Estável'];
  const areas = ['Escritório', 'Estoque', 'Frente de Loja'];
  const peripheralTypes = ['Impressora', 'Pin Pad', 'Gaveta', 'Balança', 'Monitor', 'Teclado', 'Leitor'];
  const peripheralTagRules = {
    Impressora: { pattern: /^IMPR[0-9]+$/, source: 'IMPR[0-9]+', example: 'IMPR000' },
    Leitor: { pattern: /^EAN[0-9]+$/, source: 'EAN[0-9]+', example: 'EAN000' },
    Gaveta: { pattern: /^GVT[0-9]+$/, source: 'GVT[0-9]+', example: 'GVT000' },
    'Pin Pad': { pattern: /^PP[0-9]+$/, source: 'PP[0-9]+', example: 'PP000' },
    Balança: { pattern: /^BAL[0-9]+$/, source: 'BAL[0-9]+', example: 'BAL000' },
    Monitor: { pattern: /^MON[0-9]+$/, source: 'MON[0-9]+', example: 'MON000' },
    Teclado: { pattern: /^TEC[0-9]+$/, source: 'TEC[0-9]+', example: 'TEC000' }
  };
  const areaColors = { 'Escritório': '#4ea8ff', Estoque: '#f6bd55', 'Frente de Loja': '#47dd9b' };
  const statusPresentation = {
    Ativo: { color: '#19ff72', icon: 'wifi' },
    Reserva: { color: '#f6bd55', icon: 'reserve' },
    Defeito: { color: '#ff5b6e', icon: 'warning' },
    Manutenção: { color: '#ff9d00', icon: 'wrench' },
    Desativado: { color: '#718096', icon: 'offline' }
  };
  const screenReadouts = {
    Ativo: { code: 'REDE', value: 'ON' },
    Reserva: { code: 'STBY', value: 'LIVRE' },
    Defeito: { code: 'ALTA', value: 'FALHA' },
    Manutenção: { code: 'SERV', value: 'REPARO' },
    Desativado: { code: 'OFF', value: 'PAUSA' }
  };
  const statusColors = Object.fromEntries(Object.entries(statusPresentation).map(([status, presentation]) => [status, presentation.color]));
  const situationColors = { 'Em Sala': '#9d6cff', 'Em Uso': '#36c8f4', Estoque: '#e582ff', 'Em Manutenção': '#ff6d47' };
  const cleaningColors = { Preventiva: '#4d8dff', Completa: '#58e6bd', 'Não Realizada': '#d486ff' };
  const priorityColors = { Alta: '#ff6674', 'Média': '#ffce59', 'Estável': '#3de5d3' };
  const areaIcons = { 'Escritório': 'building', Estoque: 'warehouse', 'Frente de Loja': 'store' };
  let payload = { table: null, items: [] };
  let state = { query: '', status: '', situation: '', operation: route.get('operation') || '', modal: null, tab: 'general', syncAt: null, actionMenu: false, transferDestinationId: '', transferQuery: '', backups: [], backupSettings: { automatic: false }, localBackupAt: null };
  let toastTimer;
  let detailReturnFocus = null;
  let inventoryPeripheralRows = [];

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const svg = (name, size = 18) => {
    const paths = {
      monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8m-4-5v5M8 10h8M12 7v6M9.5 8.5l5 5M14.5 8.5l-5 5"/>',
      building: '<path d="M4 21V5l8-2v18M4 9h8m-4 3h.01m4 0h.01M8 16h.01m4 0h.01M12 21v-8h8v8M16 17h.01m3 0h.01"/>',
      warehouse: '<path d="m3 10 9-6 9 6v10H3V10Z"/><path d="M3 10h18M8 20v-6h8v6M8 10h.01m4 0h.01m4 0h.01"/>',
      store: '<path d="M4 10V6h16v4M3 10h18v3a3 3 0 0 1-5 2.2A3 3 0 0 1 12 16a3 3 0 0 1-4-.8A3 3 0 0 1 3 13v-3Z"/><path d="M5 15v6h14v-6M9 21v-4h6v4"/>',
      search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
      sync: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.4 8.7A7 7 0 0 1 18.8 7M17.6 15.3A7 7 0 0 1 5.2 17"/>',
      home: '<path d="m3 11 9-8 9 8v9H3v-9Z"/><path d="M9 20v-6h6v6"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      export: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4"/>',
      pdf: '<path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h4M8.5 14.5h1.2a1.2 1.2 0 0 0 0-2.4H8.5v4.8M12 16.9v-4.8h1.1a2.4 2.4 0 1 1 0 4.8H12ZM16.3 16.9v-4.8h2.5M16.3 14.5h2"/>',
      backup: '<ellipse cx="10.5" cy="5" rx="5.5" ry="2.5"/><path d="M5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.1 0 2.1-.1 3-.4M16 5v5M5 10c0 1.4 2.5 2.5 5.5 2.5S16 11.4 16 10M16.2 17.5l1.8 1.8 3.4-4"/>',
      database: '<ellipse cx="10" cy="5" rx="5.5" ry="2.5"/><path d="M4.5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.2 0 2.3-.2 3.2-.5M15.5 5v7M4.5 10c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5M18.5 16v6m-3-3h6"/>',
      download: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4"/>',
      upload: '<path d="M12 21V10m0 0 4 4m-4-4-4 4M5 5v3h14V5"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
      history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>',
      check: '<path d="m5 12 4.2 4.2L19 6.5"/>',
      chevron: '<path d="m7 10 5 5 5-5"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      edit: '<path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/>',
      trash: '<path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/>',
      wifi: '<path d="M4 9a12 12 0 0 1 16 0M7 12a8 8 0 0 1 10 0M10 15a4 4 0 0 1 4 0"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
      reserve: '<rect x="4" y="7" width="16" height="11" rx="2"/><path d="M8 11h5m-5 3h3M20 10h1v5h-1"/>',
      warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
      wrench: '<path d="M14.8 4.2a4.6 4.6 0 0 0-5.5 5.9L4.5 14.9a2.1 2.1 0 1 0 3 3l4.8-4.8a4.6 4.6 0 0 0 5.7-5.7l-2.6 2.1-2.4-2.4 1.8-2.9Z"/>',
      offline: '<path d="M5 5l14 14M7 17.5A8 8 0 0 1 5 15M9.7 14.7A4 4 0 0 1 9 14M19 11a8 8 0 0 0-11.4-1.2M16 13a4 4 0 0 0-3.8-3"/><circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>',
      clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
      server: '<rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01M11 7h6m-6 10h6"/>',
      ping: '<path d="M5 16h2m3-5h2m3-4h2"/><path d="M4 20c9-1 12-7 16-16"/>',
      transfer: '<path d="M5 7h11m0 0-3-3m3 3-3 3M19 17H8m0 0 3 3m-3-3 3-3"/>',
      cube: '<path d="m12 3 7 4v9l-7 4-7-4V7l7-4Z"/><path d="m5 7 7 4 7-4M12 11v9"/>',
      info: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 8h6m-6 4h10m-10 4h7"/><circle cx="17" cy="7.5" r="1.5"/>',
      cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 9h6v6H9zM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
      network: '<rect x="9" y="3" width="6" height="6" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 9v4M6 16v-3h12v3"/>',
      pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
      pulse: '<path d="M2 12h4l3-7 5 14 3-7h5"/>',
      tag: '<path d="M3 4h10l8 8-9 9-9-9V4Z"/><circle cx="8" cy="9" r="1"/>',
      memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h2m3 0h2m3 0h1M6 17v3m4-3v3m4-3v3m4-3v3"/>',
      storage: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 13h18M7 17h.01m4 0h.01"/>',
      notes: '<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
      display: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M6 8h12"/>',
      workstation: '<rect x="2" y="4" width="14" height="12" rx="2"/><path d="M5 8h8M6 20h7m-3-4v4"/><rect x="18" y="5" width="4" height="15" rx="1"/><path d="M19.5 9h1m-1 7h1"/>',
      windows: '<path d="M3 5.5 10.5 4v7H3V5.5Zm9.5-1.9L21 2v9h-8.5V3.6ZM3 13h7.5v7L3 18.5V13Zm9.5 0H21v9l-8.5-1.8V13Z"/>',
      printer: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 15h12v6H6zM18 12h.01"/>',
      keypad: '<rect x="4" y="2" width="16" height="20" rx="3"/><path d="M7 6h10v4H7zM8 14h.01m4 0h.01m4 0h.01M8 18h.01m4 0h4"/>',
      drawer: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 11h18M9 15h6M6 4h12v3"/>',
      scale: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M7 7a5 5 0 0 1 10 0M12 7l2-3M8 15h8m-6 3h4"/>',
      scanner: '<path d="M4 6V4h4m8 0h4v2M4 18v2h4m8 0h4v-2M5 12h14M7 9v6m3-6v6m4-6v6m3-6v6"/>',
      keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M5 10h.01m4 0h.01m4 0h.01m4 0h.01M5 13h.01m4 0h.01m4 0h.01m4 0h.01M7 16h10"/>',
      mouse: '<rect x="7" y="2" width="10" height="20" rx="5"/><path d="M12 2v8m-5 1h10"/>',
      power: '<path d="M12 2v9M6.5 5.5a8 8 0 1 0 11 0"/>',
      phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
      shield: '<path d="M12 2 4 5v6c0 5 3.5 8.5 8 11 4.5-2.5 8-6 8-11V5l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
      route: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a5 5 0 0 0 0-10h-2M17 6H9a4 4 0 0 0-4 4v2"/>'
    };
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${paths[name] || ''}</svg>`;
  };
  const statusIcon = status => statusPresentation[status]?.icon || 'monitor';
  const dateTime = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Não informado';
  const display = value => String(value || '').trim() || 'Não informado';
  const hasFixedTerminal = item => Boolean(String(item?.terminal || '').trim());
  const isProtectedTerminal = item => Boolean(item?.isFixed);
  const sharedTransferAreas = new Set(['Escritório', 'Estoque']);
  const canTransferBetweenAreas = (sourceArea, destinationArea) =>
    areas.includes(sourceArea) && areas.includes(destinationArea) &&
    (sourceArea === destinationArea || (sharedTransferAreas.has(sourceArea) && sharedTransferAreas.has(destinationArea)));
  const terminalName = item => String(item?.terminal || item?.equipment || 'Terminal não informado').trim();
  const computerName = item => String(item?.equipment || '').trim() || 'Sem computador atribuído';
  const count = (items, key, value) => items.filter(item => item[key] === value).length;
  const activeItem = () => payload.items.find(item => item.id === state.modal?.id);
  const notify = message => {
    clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.classList.add('show');
    toastTimer = setTimeout(() => toastNode.classList.remove('show'), 3200);
  };
  const uniqueLog = text => ({ id: `management-log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), text });
  const peripheralFieldName = type => `peripheral-${normalize(type).replace(/\s+/g, '-')}`;
  const peripheralTag = value => String(value || '').trim().toUpperCase();
  const isValidPeripheralTag = (type, value) => {
    const tag = peripheralTag(value);
    return !tag || Boolean(peripheralTagRules[type]?.pattern.test(tag));
  };
  const peripheralField = (type, value = '') => {
    const rule = peripheralTagRules[type];
    return `<label class="management-field"><span>${escape(type)} <small>TAG ${escape(rule.example)}</small></span><input name="${peripheralFieldName(type)}" value="${escape(value)}" placeholder="${escape(rule.example)}" pattern="${escape(rule.source)}" data-management-peripheral-input="${escape(type)}" autocomplete="off" spellcheck="false"></label>`;
  };

  function itemMatchesFilters(item) {
    const search = normalize(state.query);
    const haystack = [item.terminal, item.equipment, item.tag, item.ip, item.sector, item.model, item.operatingSystem, item.hostname, item.user].map(normalize).join(' ');
    const maintenanceOpen = ['em manutencao', 'manutencao', 'defeito'].includes(normalize(item.status));
    return (!search || haystack.includes(search))
      && (!state.status || item.status === state.status)
      && (!state.situation || item.situation === state.situation)
      && (state.operation !== 'maintenance-open' || maintenanceOpen);
  }

  function filteredItems() {
    return payload.items.filter(itemMatchesFilters);
  }

  function computerMarkup(item, compact = false) {
    const presentation = statusPresentation[item.status] || statusPresentation.Ativo;
    const readout = screenReadouts[item.status] || screenReadouts.Ativo;
    const color = presentation.color;
    const areaColor = areaColors[item.area] || areaColors['Escritório'];
    const fixedTerminal = hasFixedTerminal(item);
    const terminal = terminalName(item);
    const computer = computerName(item);
    const tag = String(item.tag || '').trim().toUpperCase() || '—';
    const tooltip = `<span class="mini-tooltip"><b>${escape(fixedTerminal ? terminal : item.equipment)}</b>${fixedTerminal ? `<span>Computador: ${escape(computer)}</span>` : ''}<span>TAG ${escape(display(item.tag))} · ${escape(display(item.ip))}</span><span>${escape(display(item.operatingSystem))} · ${escape(display(item.model))}</span><span>${escape(display(item.user))} · ${escape(item.status)}</span></span>`;
    const identity = fixedTerminal
      ? `<b class="mini-computer-label mini-terminal-label">${escape(terminal)}</b><span class="mini-status"><i></i>${escape(item.status)}</span><span class="mini-assigned-computer" title="${escape(computer)}">${escape(computer)}</span>`
      : `<b class="mini-computer-label">${escape(item.equipment)}</b><span class="mini-status"><i></i>${escape(item.status)}</span>`;
    const ariaLabel = fixedTerminal
      ? `Terminal ${terminal}. Computador: ${computer}. TAG: ${tag}. Status: ${item.status}. Ativar para ver detalhes.`
      : `Equipamento ${item.equipment}. TAG: ${tag}. Status: ${item.status}. Ativar para ver detalhes.`;
    return `<button class="mini-computer${compact ? ' compact' : ''}${fixedTerminal ? ' is-fixed-terminal' : ''}" type="button" data-management-open="${escape(item.id)}" data-status="${escape(item.status)}" style="--status-color:${color};--area-color:${areaColor};--category-color:${color}" aria-label="${escape(ariaLabel)}"><span class="mini-category">${escape(item.area || 'Escritório')}</span><span class="mini-screen"><span class="mini-screen-hud" aria-hidden="true"><b>${escape(readout.code)}</b><i>${escape(readout.value)}</i></span><span class="mini-screen-mark">${svg(statusIcon(item.status), 28)}</span><span class="mini-screen-telemetry" aria-hidden="true"><i></i><i></i><i></i></span><span class="mini-led"></span></span><span class="mini-neck"></span><span class="mini-base"></span><span class="mini-chassis" title="TAG do PC: ${escape(tag)}"><span class="mini-tag-readout">${escape(tag)}</span></span>${identity}${tooltip}</button>`;
  }

  function areaMarkup(area, items) {
    return `<section class="management-area" style="--area-color:${areaColors[area]}"><header class="management-area-head"><span class="management-area-icon" aria-hidden="true">${svg(areaIcons[area] || 'monitor', 15)}</span><h2>${escape(area)}</h2><span class="management-area-count" data-management-area-count="${escape(area)}">${items.length}</span><button class="management-area-add" type="button" data-management-action="add-area" data-management-area="${escape(area)}">${svg('plus', 12)} Adicionar</button><i class="management-area-rule" aria-hidden="true"></i></header><div class="management-computer-grid">${items.map(item => computerMarkup(item)).join('')}</div></section>`;
  }

  function chartMarkup(title, items, key, labels, colors) {
    const counts = Object.fromEntries(labels.map(label => [label, items.filter(item => item[key] === label).length]));
    const max = Math.max(...Object.values(counts), 1);
    return `<section class="management-chart"><h3>${escape(title)}</h3><div class="management-chart-stage">${labels.map(label => `<div class="management-chart-bar" style="--chart-color:${colors[label]};height:${Math.max(4, Math.round(counts[label] / max * 116))}px" title="${escape(label)}: ${counts[label]}"></div>`).join('')}</div><div class="management-chart-legend">${labels.map(label => `<span><i style="background:${colors[label]}"></i><em>${escape(label)}</em><b>${counts[label]}</b></span>`).join('')}</div></section>`;
  }

  function toolbarMarkup() {
    const clearVisible = state.query || state.status || state.situation || state.operation;
    return `<section class="management-toolbar" aria-label="Filtros da Gestão TI"><label class="management-search">${svg('search', 16)}<input data-management-query placeholder="Buscar equipamento, série, marca, TAG..." value="${escape(state.query)}" autocomplete="off"></label><span class="management-filter-wrap" data-management-filter-wrap="status" style="--filter-color:${state.status ? statusColors[state.status] : '#607990'}"><select class="management-filter" data-management-status aria-label="Filtrar por status"><option value="">Status</option>${statuses.map(status => `<option value="${escape(status)}" ${state.status === status ? 'selected' : ''}>${escape(status)}</option>`).join('')}</select></span><span class="management-filter-wrap" data-management-filter-wrap="situation" style="--filter-color:${state.situation ? situationColors[state.situation] : '#607990'}"><select class="management-filter" data-management-situation aria-label="Filtrar por situação"><option value="">Situação</option>${situations.map(value => `<option value="${escape(value)}" ${state.situation === value ? 'selected' : ''}>${escape(value)}</option>`).join('')}</select></span><button class="management-clear" type="button" data-management-action="clear-filters" ${clearVisible ? '' : 'hidden'}>Limpar filtros</button></section>`;
  }

  const managementHeaderSummaryMarkup = () => `<div class="management-heading module-header-summary module-header-summary-management"><div class="module-header-summary-copy"><h1 class="module-header-summary-title">Gestão TI</h1><p class="module-header-summary-description">Monitoramento de PCs ativos em tempo real.</p><div class="module-header-summary-tags"><span>Monitoramento</span><span>Status</span><span>Desempenho</span></div></div><span class="module-header-summary-art management" aria-hidden="true"></span></div>`;

  function headerMarkup() {
    return `<header class="management-header"><div class="management-heading"><span class="management-heading-icon">${svg('monitor', 20)}</span><div><h1>GESTÃO TI</h1><p>Aldeckot — Central de Monitoramento Computacional</p></div></div><div class="management-header-actions" role="toolbar" aria-label="Ações da Gestão TI"><button class="management-action icon management-pdf-action" type="button" data-management-action="export" title="Exportar em PDF" aria-label="Exportar em PDF">${svg('pdf')}</button><button class="management-action icon management-backup-action" type="button" data-management-action="backup" title="Sistema de backup" aria-label="Sistema de backup">${svg('backup')}</button><button class="management-action icon management-home-action" type="button" data-management-action="home" title="Voltar ao início" aria-label="Voltar ao início">${svg('home')}</button></div></header>`;
  }

  function applyManagementFilters() {
    const visibleByArea = Object.fromEntries(areas.map(area => [area, 0]));
    const itemsById = new Map(payload.items.map(item => [String(item.id), item]));
    app.querySelectorAll('[data-management-open]').forEach(card => {
      const item = itemsById.get(card.dataset.managementOpen);
      const visible = Boolean(item && itemMatchesFilters(item));
      card.hidden = !visible;
      if (visible && item) visibleByArea[item.area] = (visibleByArea[item.area] || 0) + 1;
    });
    areas.forEach(area => {
      const countNode = app.querySelector(`[data-management-area-count="${area}"]`);
      if (countNode) countNode.textContent = String(visibleByArea[area] || 0);
    });
    const query = app.querySelector('[data-management-query]');
    const status = app.querySelector('[data-management-status]');
    const situation = app.querySelector('[data-management-situation]');
    if (query && query.value !== state.query) query.value = state.query;
    if (status && status.value !== state.status) status.value = state.status;
    if (situation && situation.value !== state.situation) situation.value = state.situation;
    const clear = app.querySelector('[data-management-action="clear-filters"]');
    if (clear) clear.hidden = !(state.query || state.status || state.situation || state.operation);
    const statusWrap = app.querySelector('[data-management-filter-wrap="status"]');
    const situationWrap = app.querySelector('[data-management-filter-wrap="situation"]');
    statusWrap?.style.setProperty('--filter-color', state.status ? statusColors[state.status] : '#607990');
    situationWrap?.style.setProperty('--filter-color', state.situation ? situationColors[state.situation] : '#607990');
  }

  function render() {
    const grouped = areas.map(area => [area, payload.items.filter(item => item.area === area)]);
    app.innerHTML = `${headerMarkup()}${toolbarMarkup()}<div class="management-layout"><section class="management-areas">${grouped.map(([area, items]) => areaMarkup(area, items)).join('')}</section><aside class="management-charts" aria-label="Gráficos da Gestão TI">${chartMarkup('Distribuição por Status', payload.items, 'status', statuses, statusColors)}${chartMarkup('Distribuição por Situação', payload.items, 'situation', situations, situationColors)}${chartMarkup('Distribuição por Limpeza', payload.items, 'cleaning', cleanings, cleaningColors)}</aside></div>`;
    const managementHeader = app.querySelector('.management-header');
    const previousHeading = managementHeader?.querySelector('.management-heading');
    if (previousHeading && !previousHeading.classList.contains('module-header-summary')) previousHeading.outerHTML = managementHeaderSummaryMarkup();
    const mascotDock = app.querySelector('.management-header [data-module-mascot-dock]');
    if (!mascotDock) {
      const header = managementHeader;
      const heading = header?.querySelector('.management-heading');
      if (header) {
        const dock = document.createElement('span');
        dock.className = 'module-mascot-dock module-mascot-dock-management';
        dock.dataset.moduleMascotDock = 'true';
        dock.setAttribute('aria-label', 'Mascote ALDECKOT');
        dock.innerHTML = '<img class="module-mascot-image" src="assets/mascot-dark.png" alt="" aria-hidden="true"><button class="module-notification-toggle module-mascot-notification" type="button" data-module-notifications title="Central de notificações" aria-label="Abrir Central de notificações" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="module-notification-badge" hidden></span></button>';
        if (heading) heading.insertAdjacentElement('afterend', dock);
        else header.prepend(dock);
      }
    }
    applyManagementFilters();
  }

  const detail = (label, value, full = false) => `<div class="management-detail${full ? ' full' : ''}"><span>${escape(label)}</span><b>${escape(display(value))}</b></div>`;
  const statusBadge = item => `<span class="management-badge" style="--badge-color:${statusColors[item.status] || statusColors.Ativo}"><i></i>${escape(item.status)}</span>`;

  const detailTabs = [['general', 'Geral', 'display'], ['hardware', 'Hardware', 'cpu'], ['network', 'Rede', 'network'], ['location', 'Localização', 'pin'], ['operational', 'Status Operacional', 'pulse'], ['history', 'Histórico', 'history'], ['peripherals', 'Periféricos', 'cube']];
  const hasDetailValue = value => value !== null && value !== undefined && String(value).trim() !== '';
  const sectionTitle = (icon, title, action = '') => `<div class="management-asset-section-head"><h3><span class="management-asset-heading-icon icon-${icon}">${svg(icon, 20)}</span>${escape(title)}</h3>${action}</div>`;
  const workstationArt = () => `<svg class="management-asset-workstation-art" viewBox="0 0 72 72" width="68" height="68" aria-hidden="true"><defs><linearGradient id="managementArtFrame" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#c4e9ff"/><stop offset="1" stop-color="#296cac"/></linearGradient><linearGradient id="managementArtScreen" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#46c7ff"/><stop offset=".55" stop-color="#1477cf"/><stop offset="1" stop-color="#072e73"/></linearGradient><linearGradient id="managementArtTower" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#4f9bcf"/><stop offset="1" stop-color="#0d345e"/></linearGradient></defs><ellipse class="art-shadow" cx="36" cy="62" rx="31" ry="5"/><path class="art-tower" d="M52 16h11a3 3 0 0 1 3 3v35a3 3 0 0 1-3 3H52a3 3 0 0 1-3-3V19a3 3 0 0 1 3-3Z"/><path class="art-tower-line" d="M54 22h7m-7 4h7"/><circle class="art-led" cx="58" cy="49" r="2"/><rect class="art-monitor-frame" x="4" y="12" width="47" height="38" rx="4"/><rect class="art-screen" x="8" y="16" width="39" height="30" rx="2"/><path class="art-screen-glint" d="M9 33 31 16h15L9 44Z"/><path class="art-window" d="m20 24 8-1v8h-8v-7Zm10-1 8-1v9h-8v-8Zm-10 10h8v8l-8-1v-7Zm10 0h8v9l-8-1v-8Z"/><path class="art-neck" d="M24 50h8v7h-8z"/><path class="art-base" d="M17 58h22l3 4H14l3-4Z"/></svg>`;
  const sectionLink = (tab, label) => `<button class="management-asset-link" type="button" data-management-tab="${tab}">${escape(label)}</button>`;
  const assetCard = (icon, label, value, secondary = '') => `<article class="management-asset-data-card"><span class="management-asset-data-icon">${svg(icon, 22)}</span><div><small>${escape(label)}</small><strong>${escape(value)}</strong>${secondary ? `<span>${escape(secondary)}</span>` : ''}</div></article>`;
  const hardwareCards = item => [
    ['windows', 'Sistema operacional', item.operatingSystem, item.osVersion],
    ['cpu', 'Processador', item.processor],
    ['memory', 'Memória RAM', item.memory],
    ['storage', 'Armazenamento', item.storage]
  ].filter(([, , value]) => hasDetailValue(value)).map(([icon, label, value, secondary]) => assetCard(icon, label, value, secondary)).join('');
  const peripheralList = item => (item.peripherals || []).filter(entry => hasDetailValue(entry.type || entry.tipo));
  const peripheralInventoryTag = entry => String(entry.tag || entry.status || '').trim().toUpperCase();
  const linkedInventoryPeripheral = (entry, type) => {
    const sourceId = String(entry.sourceItemId || '');
    if (entry.sourceModule === 'inventory' && sourceId) return inventoryPeripheralRows.find(row => row.id === sourceId) || null;
    const tag = peripheralInventoryTag(entry);
    const rule = peripheralTagRules[type];
    if (!rule?.pattern.test(tag)) return null;
    const matches = inventoryPeripheralRows.filter(row => String(row.tag || '').trim().toUpperCase() === tag);
    return matches.length === 1 ? matches[0] : null;
  };
  async function refreshPeripheralStatuses() {
    const entries = payload.items.flatMap(peripheralList);
    const ids = entries.filter(entry => entry.sourceModule === 'inventory' && entry.sourceItemId).map(entry => entry.sourceItemId);
    const tags = entries.filter(entry => !entry.sourceItemId && peripheralTagRules[entry.type || entry.tipo]?.pattern.test(peripheralInventoryTag(entry))).map(peripheralInventoryTag);
    try {
      const rows = await window.AldeckotSupabase.management.peripheralInventoryStatuses({ ids, tags });
      const next = rows.sort((first, second) => String(first.id).localeCompare(String(second.id)));
      const changed = JSON.stringify(next) !== JSON.stringify(inventoryPeripheralRows);
      inventoryPeripheralRows = next;
      return changed;
    } catch (error) {
      console.warn('Status dos periféricos no Inventário indisponível:', error);
      inventoryPeripheralRows = [];
      return false;
    }
  }
  const peripheralIcon = type => {
    const value = normalize(type);
    if (value.includes('impressora')) return 'printer';
    if (value.includes('pin pad') || value.includes('pinpad')) return 'keypad';
    if (value.includes('gaveta')) return 'drawer';
    if (value.includes('balanca')) return 'scale';
    if (value.includes('leitor')) return 'scanner';
    if (value.includes('teclado')) return 'keyboard';
    if (value.includes('mouse')) return 'mouse';
    if (value.includes('nobreak')) return 'power';
    if (value.includes('telefone')) return 'phone';
    if (value.includes('monitor')) return 'display';
    return 'cube';
  };
  function peripheralCards(item) {
    const entries = peripheralList(item);
    if (!entries.length) return '<p class="management-asset-empty">Nenhum periférico vinculado a este equipamento.</p>';
    const healthStates = ['ativo', 'funcionando', 'operacional', 'reserva', 'defeito', 'manutencao', 'inativo', 'desativado', 'offline'];
    return `<div class="management-asset-peripheral-grid">${entries.map(entry => {
      const type = entry.type || entry.tipo || 'Periférico';
      const rawStatus = String(entry.status || '').trim();
      const inventoryItem = linkedInventoryPeripheral(entry, type);
      const inventoryLinked = entry.sourceModule === 'inventory' || Boolean(peripheralTagRules[type]?.pattern.test(peripheralInventoryTag(entry)));
      const condition = inventoryItem?.status || (!inventoryLinked ? entry.condition || entry.operationalStatus || (healthStates.includes(normalize(rawStatus)) ? rawStatus : '') : '');
      const identifier = inventoryItem?.tag || entry.tag || (!condition ? rawStatus : '');
      const model = [entry.brand, entry.model].filter(hasDetailValue).join(' ');
      const normalizedCondition = normalize(condition);
      const tone = ['ativo', 'funcionando', 'operacional'].includes(normalizedCondition) ? 'ok' : ['defeito', 'manutencao', 'inativo', 'desativado', 'offline'].includes(normalizedCondition) ? 'fault' : normalizedCondition === 'reserva' ? 'warn' : 'unverified';
      return `<article class="management-asset-peripheral"><span class="management-asset-data-icon icon-${peripheralIcon(type)}">${svg(peripheralIcon(type), 24)}</span><div><strong>${escape(type)}</strong>${model ? `<span>${escape(model)}</span>` : ''}${identifier && normalize(identifier) !== 'nao informado' ? `<small>TAG ${escape(identifier)}</small>` : ''}<em class="${tone}">${escape(condition || (inventoryLinked ? 'Status indisponível no Inventário' : 'Estado não informado'))}</em></div></article>`;
    }).join('')}</div>`;
  }
  function networkRows(item) {
    const rows = [['ip', 'IP', item.ip, 'globe'], ['subnetMask', 'Máscara', item.subnetMask, 'shield'], ['gateway', 'Gateway', item.gateway, 'route'], ['dns', 'DNS', item.dns, 'globe']];
    const available = rows.filter(([, , value]) => hasDetailValue(value));
    if (!available.length) return '<p class="management-asset-empty">Nenhuma configuração de rede cadastrada.</p>';
    return `<div class="management-asset-network">${available.map(([field, label, value, icon]) => `<div class="management-asset-network-row"><span>${svg(icon, 17)} ${escape(label)}</span><strong>${escape(value)}</strong><button type="button" data-management-action="copy-network" data-management-network-field="${field}" aria-label="Copiar ${escape(label)}" title="Copiar ${escape(label)}">${svg('copy', 16)}</button></div>`).join('')}</div>`;
  }
  function recentLogs(item) {
    const logs = (item.logs || []).slice(0, 4);
    return logs.length ? `<div class="management-asset-recent-list">${logs.map(log => `<article><time>${escape(dateTime(log.at))}</time><span>${escape(log.text)}</span></article>`).join('')}</div>` : '<p class="management-asset-empty">Nenhuma atividade registrada.</p>';
  }
  function generalDashboard(item) {
    const specs = hardwareCards(item);
    return `<div class="management-asset-dashboard"><div class="management-asset-primary"><section class="management-asset-section">${sectionTitle('info', 'Informações Gerais', sectionLink('hardware', 'Ver hardware'))}${specs ? `<div class="management-asset-data-grid">${specs}</div>` : '<p class="management-asset-empty">Dados técnicos ainda não cadastrados.</p>'}</section><section class="management-asset-section">${sectionTitle('cube', 'Periféricos', sectionLink('peripherals', 'Ver todos'))}${peripheralCards(item)}</section></div><aside class="management-asset-secondary"><section class="management-asset-section">${sectionTitle('notes', 'Descrição')}${hasDetailValue(item.description) ? `<p class="management-asset-copy">${escape(item.description)}</p>` : '<p class="management-asset-empty">Sem descrição cadastrada.</p>'}${hasDetailValue(item.notes) ? `<div class="management-asset-note"><strong>Observações</strong><p>${escape(item.notes)}</p></div>` : ''}</section><section class="management-asset-section">${sectionTitle('network', 'Endereço IP e Rede', sectionLink('network', 'Ver rede'))}${networkRows(item)}</section><section class="management-asset-section">${sectionTitle('history', 'Histórico recente', sectionLink('history', 'Ver todos'))}${recentLogs(item)}</section></aside></div>`;
  }
  function detailContent(item) {
    const tab = state.tab;
    if (tab === 'general') return generalDashboard(item);
    if (tab === 'hardware') return `<section class="management-asset-section">${sectionTitle('cpu', 'Hardware')}${hardwareCards(item) ? `<div class="management-asset-data-grid">${hardwareCards(item)}</div>` : '<p class="management-asset-empty">Dados técnicos ainda não cadastrados.</p>'}${[item.brand, item.model, item.serial].some(hasDetailValue) ? `<div class="management-detail-grid">${hasDetailValue(item.brand) ? detail('Marca', item.brand) : ''}${hasDetailValue(item.model) ? detail('Modelo', item.model) : ''}${hasDetailValue(item.serial) ? detail('Nº de série', item.serial) : ''}</div>` : ''}</section>`;
    if (tab === 'peripherals') return `<section class="management-asset-section">${sectionTitle('cube', 'Periféricos vinculados')}${peripheralCards(item)}</section>`;
    if (tab === 'network') return `<section class="management-asset-section">${sectionTitle('network', 'Endereço IP e Rede')}${networkRows(item)}<p class="management-asset-disclaimer">Conectividade em tempo real não monitorada.</p></section>`;
    if (tab === 'location') return `<section class="management-asset-section">${sectionTitle('pin', 'Localização')}${[item.area, item.sector, item.location].some(hasDetailValue) ? `<div class="management-detail-grid">${hasDetailValue(item.area) ? detail('Área', item.area) : ''}${hasDetailValue(item.sector) ? detail('Setor', item.sector) : ''}${hasDetailValue(item.location) ? detail('Local', item.location) : ''}</div>` : '<p class="management-asset-empty">Localização não cadastrada.</p>'}</section>`;
    if (tab === 'operational') return `<section class="management-asset-section">${sectionTitle('pulse', 'Status Operacional')}<div class="management-operational"><article class="management-operational-card" style="--operational-color:${statusColors[item.status] || statusColors.Ativo}"><i>Status</i><b>${escape(item.status)}</b></article>${hasDetailValue(item.priority) ? `<article class="management-operational-card" style="--operational-color:${priorityColors[item.priority] || priorityColors.Estável}"><i>Prioridade</i><b>${escape(item.priority)}</b></article>` : ''}${hasDetailValue(item.situation) ? `<article class="management-operational-card" style="--operational-color:${situationColors[item.situation] || situationColors['Em Uso']}"><i>Situação</i><b>${escape(item.situation)}</b></article>` : ''}${hasDetailValue(item.cleaning) ? `<article class="management-operational-card" style="--operational-color:${cleaningColors[item.cleaning] || cleaningColors.Preventiva}"><i>Limpeza</i><b>${escape(item.cleaning)}</b></article>` : ''}</div><p class="management-asset-disclaimer">Conectividade em tempo real não monitorada.</p></section>`;
    return `<section class="management-asset-section">${sectionTitle('history', 'Histórico')}<div class="management-log-head"><p>Registros automáticos e manuais do equipamento.</p><button class="management-log-add" type="button" data-management-action="add-log">${svg('plus', 13)} Adicionar log</button></div><div class="management-history">${(item.logs || []).length ? item.logs.map(log => `<article class="management-history-item"><time>${escape(dateTime(log.at))}</time><p>${escape(log.text)}</p><span class="management-log-actions"><button class="management-log-action" type="button" data-management-action="edit-log" data-management-log-id="${escape(log.id)}" title="Editar log" aria-label="Editar log">${svg('edit', 13)}</button><button class="management-log-action danger" type="button" data-management-action="delete-log" data-management-log-id="${escape(log.id)}" title="Excluir log" aria-label="Excluir log">${svg('trash', 13)}</button></span></article>`).join('') : '<p class="management-asset-empty">Nenhum log registrado para este equipamento.</p>'}</div></section>`;
  }

  function detailsModal(item) {
    const actionMenu = state.actionMenu ? `<div class="management-action-menu" role="menu"><button type="button" data-management-action="edit" role="menuitem">${svg('edit', 14)} Editar</button>${isProtectedTerminal(item) ? '' : `<button class="danger" type="button" data-management-action="delete" role="menuitem">${svg('trash', 14)} Excluir</button>`}</div>` : '';
    const fixedTerminal = hasFixedTerminal(item);
    const transferButton = fixedTerminal ? `<button class="management-modal-action management-transfer-action" type="button" data-management-action="transfer" ${canManage() ? '' : 'disabled'} title="${canManage() ? 'Transferir computador para outro terminal' : 'Somente administradores podem transferir computadores'}">${svg('transfer', 17)} Transferir</button>` : '';
    const title = fixedTerminal ? terminalName(item) : item.equipment;
    const subtitle = fixedTerminal ? computerName(item) : [item.brand, item.model].filter(hasDetailValue).join(' ') || 'Computador';
    const facts = [['tag', 'Tag/ID', item.tag], ['network', 'IP', item.ip], ['pin', 'Localização', item.location || item.area], ['building', 'Setor', item.sector]].filter(([, , value]) => hasDetailValue(value));
    return `<section class="management-modal-dialog management-asset-detail" data-supply-host-source="management" data-supply-host-id="${escape(item.id)}" role="dialog" aria-modal="true" aria-labelledby="managementDetailTitle"><header class="management-modal-head management-asset-head"><div class="management-modal-identity"><span class="management-asset-hero-icon">${workstationArt()}</span><div><div class="management-asset-status">${statusBadge(item)}</div><h2 id="managementDetailTitle">${escape(title)}</h2><p>${escape(subtitle)}</p></div></div><div class="management-modal-actions">${transferButton}<span class="management-action-menu-wrap"><button class="management-modal-action action" type="button" data-management-action="toggle-actions" aria-expanded="${state.actionMenu}" ${canManage() ? '' : 'disabled'}>Ações ${svg('chevron', 14)}</button>${actionMenu}</span><button class="management-modal-action management-asset-close" type="button" data-management-action="close" aria-label="Fechar detalhes">${svg('close', 18)}</button></div></header><div class="management-asset-overview"><div class="management-asset-facts">${facts.length ? facts.map(([icon, label, value]) => `<div class="management-asset-fact"><span class="management-asset-fact-icon">${svg(icon, 20)}</span><span><small>${escape(label)}</small><strong>${escape(value)}</strong></span></div>`).join('') : '<p class="management-asset-empty">Identificação complementar não cadastrada.</p>'}</div><div class="management-asset-connectivity"><span class="management-asset-connectivity-icon">${svg('wifi', 24)}</span><span><strong>Conectividade não monitorada</strong><small>Sem leitura em tempo real</small></span></div></div><div class="management-asset-body"><nav class="management-tabs management-asset-nav" aria-label="Seções do equipamento">${detailTabs.map(([key, label, icon]) => `<button class="management-tab ${state.tab === key ? 'active' : ''}" type="button" data-management-tab="${key}" aria-current="${state.tab === key ? 'page' : 'false'}">${svg(icon, 20)}<span>${label}</span></button>`).join('')}</nav><div class="management-asset-panel" id="managementDetailPanel">${detailContent(item)}</div></div><footer class="management-asset-footer"><div>${hasDetailValue(item.registeredAt) ? `<span>${svg('calendar', 16)} Criado em: ${escape(dateTime(item.registeredAt))}</span>` : ''}${hasDetailValue(item.updatedAt) ? `<span>${svg('sync', 16)} Última atualização: ${escape(dateTime(item.updatedAt))}</span>` : ''}</div><button class="management-modal-action" type="button" data-management-action="edit" ${canManage() ? '' : 'disabled'}>${svg('edit', 16)} Editar</button></footer></section>`;
  }

  function transferModal(item) {
    const transferScope = sharedTransferAreas.has(item.area) ? 'Escritório e Estoque' : item.area;
    const targets = payload.items
      .filter(candidate => candidate.id !== item.id && hasFixedTerminal(candidate) && canTransferBetweenAreas(item.area, candidate.area))
      .sort((first, second) => first.area.localeCompare(second.area, 'pt-BR') || terminalName(first).localeCompare(terminalName(second), 'pt-BR'));
    const search = normalize(state.transferQuery);
    const destinationCards = targets.length
      ? targets.map(candidate => {
        const selected = state.transferDestinationId === candidate.id;
        const terms = [terminalName(candidate), computerName(candidate), candidate.tag, candidate.area].map(normalize).join(' ');
        return `<button class="management-transfer-destination${selected ? ' selected' : ''}" type="button" data-management-action="select-transfer-destination" data-management-destination-id="${escape(candidate.id)}" data-management-transfer-search="${escape(terms)}" aria-pressed="${selected}" ${search && !terms.includes(search) ? 'hidden' : ''}><span class="management-transfer-destination-head"><b>${escape(terminalName(candidate))}</b><i style="--destination-status:${statusColors[candidate.status] || statusColors.Ativo}"></i></span><span>${escape(computerName(candidate))}</span><small>${escape(candidate.area)} · ${candidate.tag ? `TAG ${escape(candidate.tag)}` : 'Sem TAG'}</small></button>`;
      }).join('') + `<p class="management-transfer-empty" data-management-transfer-empty ${targets.some(candidate => [terminalName(candidate), computerName(candidate), candidate.tag, candidate.area].map(normalize).join(' ').includes(search)) ? 'hidden' : ''}>Nenhum terminal permitido corresponde à pesquisa.</p>`
      : '<p class="management-transfer-empty">Nenhum terminal permitido corresponde à pesquisa.</p>';
    const selected = targets.find(candidate => candidate.id === state.transferDestinationId);
    return `<section class="management-modal-dialog management-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="managementTransferTitle"><header class="management-modal-head"><div><h2 id="managementTransferTitle">Transferir computador — ${escape(terminalName(item))}</h2><p class="management-last-sync">Destinos disponíveis em ${escape(transferScope)}.</p></div><button class="management-modal-action" type="button" data-management-action="details" aria-label="Fechar">${svg('close', 14)}</button></header><form class="management-transfer-form" data-management-transfer-form><label class="management-transfer-search">${svg('search', 16)}<input data-management-transfer-query placeholder="Pesquisar computador ou terminal de destino..." value="${escape(state.transferQuery)}" autocomplete="off"></label><section class="management-transfer-origin"><span>Equipamento de origem</span><div><i style="--origin-status:${statusColors[item.status] || statusColors.Ativo}"></i><b>${escape(terminalName(item))}</b><small>${escape(computerName(item))}${item.tag ? ` · TAG ${escape(item.tag)}` : ''}</small></div></section><section class="management-transfer-picker"><div><h3>Selecionar destino</h3><p>${escape(transferScope)} · ${targets.length} terminais disponíveis</p></div><div class="management-transfer-destination-grid">${destinationCards}</div></section><input type="hidden" name="destinationId" value="${escape(selected?.id || '')}"><p class="management-transfer-note">${selected ? `Destino selecionado: ${terminalName(selected)}.` : 'Selecione um terminal de destino para continuar.'} Se o destino estiver ocupado, os computadores serão trocados sem perda de dados.</p><footer class="management-form-footer"><button class="management-form-cancel" type="button" data-management-action="details">Cancelar</button><button class="management-form-save" type="submit" ${selected ? '' : 'disabled'}>${svg('transfer', 14)} Transferir</button></footer></form></section>`;
  }

  const optionList = (values, selected) => values.map(value => `<option value="${escape(value)}" ${selected === value ? 'selected' : ''}>${escape(value)}</option>`).join('');
  const field = (name, label, value = '', options = null, full = false, type = 'text', required = false) => `<label class="management-field${full ? ' full' : ''}"><span>${label}${required ? ' *' : ''}</span>${options ? `<select name="${name}">${optionList(options, value)}</select>` : type === 'textarea' ? `<textarea name="${name}">${escape(value)}</textarea>` : `<input name="${name}" type="${type}" value="${escape(value)}" ${required ? 'required' : ''}>`}</label>`;
  const priorityTone = value => ({ Alta: 'red', 'Média': 'yellow', 'Estável': 'turquoise' })[value] || 'turquoise';
  const priorityField = value => `<label class="management-field management-priority-field" data-management-priority-field data-tone="${priorityTone(value)}"><span>Prioridade</span><div class="management-priority-select"><i></i><select name="priority" data-management-priority-choice>${optionList(priorities, priorities.includes(value) ? value : 'Estável')}</select></div></label>`;

  function formModal(item) {
    const current = item || { terminal: '', equipment: '', status: 'Ativo', priority: 'Estável', situation: 'Em Uso', cleaning: 'Preventiva', area: state.modal?.area || 'Escritório', monitoring: {}, peripherals: [] };
    const edit = Boolean(item);
    // O nome identifica uma posição física fixa (PDV, RES, RCP etc.). Depois
    // de criado, ele é preservado no formulário sem ficar disponível para edição.
    const terminalField = edit
      ? `<input type="hidden" name="terminal" value="${escape(current.terminal)}">`
      : field('terminal', 'Nome do terminal', current.terminal, null, false, 'text', true);
    const formHint = isProtectedTerminal(current)
      ? 'Este é um terminal fixo; o computador atribuído pode ser transferido depois.'
      : 'Registro adicionado manualmente; ele poderá ser excluído quando necessário.';
    const peripheralValue = type => {
      const value = (current.peripherals || []).find(entry => normalize(entry.type || entry.tipo) === normalize(type))?.status || '';
      return isValidPeripheralTag(type, value) ? peripheralTag(value) : '';
    };
    const peripheralFields = peripheralTypes.map(type => peripheralField(type, peripheralValue(type))).join('');
    return `<section class="management-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="managementFormTitle"><header class="management-modal-head"><div><h2 id="managementFormTitle">${edit ? 'Editar terminal' : 'Adicionar terminal'}</h2><p class="management-last-sync">${formHint}</p></div><button class="management-modal-action" type="button" data-management-action="close" aria-label="Fechar">${svg('close', 14)}</button></header><form class="management-form" data-management-form><section class="management-form-section"><h3>Terminal e computador</h3>${terminalField}${field('equipment', 'Nome do computador instalado', current.equipment)}${field('tag', 'TAG', current.tag)}${field('brand', 'Marca', current.brand)}${field('model', 'Modelo', current.model)}${field('serial', 'Nº de série', current.serial)}</section><section class="management-form-section"><h3>Rede</h3>${field('ip', 'Endereço IP', current.ip)}${field('gateway', 'Gateway', current.gateway)}${field('subnetMask', 'Máscara', current.subnetMask)}</section><section class="management-form-section"><h3>Hardware</h3>${field('operatingSystem', 'Sistema operacional', current.operatingSystem)}${field('osVersion', 'Versão do sistema', current.osVersion)}${field('processor', 'Processador', current.processor)}${field('memory', 'Memória RAM', current.memory)}${field('storage', 'Armazenamento', current.storage)}</section><section class="management-form-section"><h3>Periféricos</h3>${peripheralFields}</section><section class="management-form-section"><h3>Localização e operação</h3>${field('area', 'Área', current.area, areas)}${field('sector', 'Setor', current.sector)}${field('location', 'Local', current.location)}${field('status', 'Status', current.status, statuses)}${priorityField(current.priority)}${field('situation', 'Situação', current.situation, situations)}${field('cleaning', 'Limpeza', current.cleaning, cleanings)}${field('notes', 'Observações', current.notes, null, true, 'textarea')}</section><footer class="management-form-footer"><button class="management-form-cancel" type="button" data-management-action="close">Cancelar</button><button class="management-form-save" type="submit">${edit ? 'Salvar alterações' : 'Adicionar terminal'}</button></footer></form></section>`;
  }

  function deleteModal(item) {
    return `<section class="management-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="managementDeleteTitle"><header class="management-modal-head"><div><h2 id="managementDeleteTitle">Excluir equipamento</h2><p class="management-last-sync">A confirmação é necessária para concluir a exclusão.</p></div><button class="management-modal-action" type="button" data-management-action="close" aria-label="Fechar">${svg('close', 14)}</button></header><div class="management-confirm-delete"><p>Tem certeza que deseja excluir <b>${escape(item.equipment)}</b>? Esta ação é irreversível.</p><span><button class="management-form-cancel" type="button" data-management-action="details" data-management-return-tab="general">Cancelar</button> <button class="management-modal-action danger" type="button" data-management-action="confirm-delete">Excluir</button></span></div></section>`;
  }

  function logEditorModal(item, log) {
    const editing = Boolean(log);
    return `<section class="management-modal-dialog management-log-dialog" role="dialog" aria-modal="true" aria-labelledby="managementLogTitle"><header class="management-modal-head"><div><h2 id="managementLogTitle">${editing ? 'Editar log' : 'Adicionar log manual'}</h2><p class="management-last-sync">${escape(item.equipment)}</p></div><button class="management-modal-action" type="button" data-management-action="details" data-management-return-tab="history" aria-label="Fechar">${svg('close', 14)}</button></header><form class="management-form" data-management-log-form><section class="management-form-section"><h3>Registro</h3>${field('text', 'Descrição do log', log?.text || '', null, true, 'textarea', true)}</section><footer class="management-form-footer"><button class="management-form-cancel" type="button" data-management-action="details" data-management-return-tab="history">Cancelar</button><button class="management-form-save" type="submit">${editing ? 'Salvar log' : 'Adicionar log'}</button></footer></form></section>`;
  }

  function deleteLogModal(item, log) {
    return `<section class="management-modal-dialog management-log-dialog" role="dialog" aria-modal="true" aria-labelledby="managementDeleteLogTitle"><header class="management-modal-head"><div><h2 id="managementDeleteLogTitle">Excluir log</h2><p class="management-last-sync">${escape(item.equipment)}</p></div><button class="management-modal-action" type="button" data-management-action="details" data-management-return-tab="history" aria-label="Fechar">${svg('close', 14)}</button></header><div class="management-confirm-delete"><p>Deseja excluir este registro do histórico? Esta ação não poderá ser desfeita.</p><span><button class="management-form-cancel" type="button" data-management-action="details" data-management-return-tab="history">Cancelar</button> <button class="management-modal-action danger" type="button" data-management-action="confirm-delete-log">Excluir log</button></span></div></section>`;
  }

  const backupLabel = () => `Backup Gestão TI — ${new Date().toLocaleString('pt-BR')}`;
  const backupSnapshot = () => ({
    module: 'management', version: 1, createdAt: new Date().toISOString(),
    data: { items: payload.items }
  });
  const downloadJson = (filename, contents) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' }));
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
  };

  const legacyArea = value => {
    const source = normalize(value);
    if (source.includes('pdv') || source.includes('frente') || source.includes('loja')) return 'Frente de Loja';
    if (source.includes('estoq')) return 'Estoque';
    return 'Escritório';
  };

  const legacyStatus = value => {
    const source = normalize(value);
    if (source.includes('manut')) return 'Manutenção';
    if (source.includes('defeit') || source.includes('alert')) return 'Defeito';
    if (source.includes('reserv')) return 'Reserva';
    if (source.includes('desativ') || source.includes('inativ') || source.includes('offline')) return 'Desativado';
    return 'Ativo';
  };

  const legacySituation = value => {
    const source = normalize(value);
    if (source.includes('manut')) return 'Em Manutenção';
    if (source.includes('estoq')) return 'Estoque';
    if (source.includes('sala')) return 'Em Sala';
    return 'Em Uso';
  };

  const legacyCleaning = value => {
    const source = normalize(value);
    if (source.includes('complet') || source.includes('em dia')) return 'Completa';
    if (source.includes('prevent')) return 'Preventiva';
    return 'Não Realizada';
  };

  const legacyDate = value => {
    const source = String(value || '').trim();
    const match = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    const portuguese = source.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/i);
    const months = { janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };
    if (!match && !portuguese) return source;
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = match || portuguese;
    const monthNumber = match ? Number(month) - 1 : months[normalize(month)];
    if (!Number.isInteger(monthNumber)) return source;
    return new Date(Number(year), monthNumber, Number(day), Number(hour), Number(minute), Number(second)).toISOString();
  };

  function legacyPeripherals(value, equipment) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    const names = { impressora: 'Impressora', pinpad: 'Pin Pad', gaveta: 'Gaveta', balanca: 'Balança', monitor: 'Monitor', visor: 'Monitor', teclado: 'Teclado', scanner: 'Scanner' };
    return Object.entries(value).flatMap(([key, status], index) => {
      const text = String(status ?? '').trim();
      if (!text) return [];
      const type = names[normalize(key).replace(/\s+/g, '')] || key;
      return [{ id: `legacy-peripheral-${equipment}-${index}`, type, status: text }];
    });
  }

  function legacyLogs(value, equipment) {
    if (!Array.isArray(value)) return [];
    return value.map((entry, index) => {
      const action = String(entry?.text || entry?.action || entry?.message || 'Registro importado do backup.').trim();
      const user = String(entry?.user || entry?.usuario || '').trim();
      return {
        id: entry?.id || `legacy-log-${equipment}-${index}`,
        at: legacyDate(entry?.at || entry?.timestamp || entry?.date || ''),
        text: user ? `${user} — ${action}` : action
      };
    }).sort((first, second) => String(second.at).localeCompare(String(first.at)));
  }

  function legacyManagementItem(item, index, createdAt) {
    const equipment = String(item?.equipment || item?.nome || item?.name || item?.id || `Equipamento ${index + 1}`).trim();
    const area = legacyArea(item?.area || item?.tipo || item?.type || item?.setor);
    const logs = legacyLogs(item?.logs, equipment);
    const latestLog = logs[0]?.at || createdAt;
    return {
      id: `legacy-management-${item?.id || index}`,
      terminal: String(item?.terminal || item?.terminalName || '').trim(),
      equipment,
      tag: String(item?.tag || '').trim(),
      brand: String(item?.brand || item?.marca || '').trim(),
      model: String(item?.model || item?.modelo || '').trim(),
      serial: String(item?.serial || item?.numeroSerie || item?.numero_serie || '').trim(),
      ip: String(item?.ip || '').trim(),
      gateway: String(item?.gateway || item?.gatwei || '').trim(),
      subnetMask: String(item?.subnetMask || item?.mascara || item?.máscara || '').trim(),
      hostname: String(item?.hostname || '').trim(),
      operatingSystem: String(item?.operatingSystem || item?.sistemaOperacional || '').trim(),
      osVersion: String(item?.osVersion || item?.versaoSistema || '').trim(),
      processor: String(item?.processor || item?.processador || '').trim(),
      memory: String(item?.memory || item?.ram || '').trim(),
      storage: String(item?.storage || item?.armazenamento || '').trim(),
      type: area,
      company: String(item?.company || item?.empresa || '').trim(),
      sector: String(item?.sector || item?.setor || '').trim(),
      location: String(item?.location || item?.local || '').trim(),
      responsible: String(item?.responsible || item?.responsavel || '').trim(),
      user: String(item?.user || item?.usuario || '').trim(),
      notes: String(item?.notes || item?.observacao || item?.observações || '').trim(),
      status: legacyStatus(item?.status),
      situation: legacySituation(item?.situation || item?.situacao),
      cleaning: legacyCleaning(item?.cleaning || item?.limpeza),
      area,
      isFixed: Boolean(item?.isFixed ?? item?.isDefault),
      peripherals: legacyPeripherals(item?.peripherals || item?.perifericos, equipment),
      monitoring: item?.monitoring || item?.monitoramento || {},
      registeredAt: createdAt ? createdAt.slice(0, 10) : '',
      updatedAt: latestLog || '',
      logs
    };
  }

  function normalizedBackup(value) {
    const root = value?.data && typeof value.data === 'object' ? value.data : value;
    const items = Array.isArray(root?.items) ? root.items : null;
    if (items) return { items };
    const legacyItems = Array.isArray(root?.computadores) ? root.computadores : null;
    if (legacyItems) {
      const createdAt = legacyDate(value?.timestamp || root?.timestamp || '');
      return { items: legacyItems.map((item, index) => legacyManagementItem(item, index, createdAt)) };
    }
    throw new Error('Este arquivo não contém um backup compatível da Gestão TI.');
  }

  const backupDate = value => value ? new Date(value).toLocaleDateString('pt-BR') : '—';
  const backupTime = value => value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const backupSource = source => source === 'automatic' ? 'Automático' : source === 'local' ? 'Local' : 'Manual';
  const backupSvg = (name, size = 24) => svg(name, size);

  function backupHistoryMarkup() {
    if (!state.backups.length) return `<div class="management-backup-history-empty">${backupSvg('history', 34)}<p>Seu histórico de backups aparecerá aqui.</p></div>`;
    return state.backups.map(backup => `<article class="management-backup-history-row"><div class="management-backup-history-date">${backupSvg('calendar', 22)}<span><b>${backupDate(backup.created_at)}</b><small>${backupTime(backup.created_at)}</small></span></div><span class="management-backup-source ${backup.source === 'automatic' ? 'automatic' : ''}">${backupSource(backup.source)}</span><span class="management-backup-success">${backupSvg('check', 19)}Sucesso</span><button class="management-backup-restore" type="button" data-management-action="prepare-network-restore" data-management-backup-id="${escape(backup.id)}" aria-label="Restaurar backup de ${backupDate(backup.created_at)} às ${backupTime(backup.created_at)}" title="Restaurar este backup">${backupSvg('history', 20)}</button></article>`).join('');
  }

  function backupModal() {
    const latest = state.backups[0] || state.localBackupAt;
    const automatic = Boolean(state.backupSettings?.automatic);
    const frequencyDays = Number(state.backupSettings?.frequency_days || 7);
    const latestMessage = latest ? 'Backup realizado com sucesso' : 'Nenhum backup realizado';
    const latestDetail = latest ? `Backup ${backupSource(latest.source).toLowerCase()}` : 'Crie seu primeiro backup para proteger os dados da Gestão TI.';
    return `<section class="management-modal-dialog management-backup-dialog" role="dialog" aria-modal="true" aria-labelledby="managementBackupTitle"><div class="management-backup-content"><header class="management-backup-header"><div class="management-backup-title-icon">${backupSvg('backup', 27)}</div><div><h2 id="managementBackupTitle">Sistema de Backup</h2><p>Proteção e recuperação dos dados da Gestão TI</p></div><button class="management-backup-close" type="button" data-management-action="close" aria-label="Fechar sistema de backup" title="Fechar">${backupSvg('close', 22)}</button></header><section class="management-backup-latest" aria-labelledby="managementBackupLatestTitle"><h3 id="managementBackupLatestTitle">Último backup</h3><div class="management-backup-latest-grid"><div class="management-backup-result ${latest ? 'success' : 'empty'}"><span class="management-backup-status-icon">${backupSvg(latest ? 'check' : 'history', 25)}</span><span><b>${latestMessage}</b><small>${latestDetail}</small></span></div><div class="management-backup-time">${backupSvg('calendar', 29)}<span><b>${latest ? backupDate(latest.created_at) : '—'}</b><small>${latest ? backupTime(latest.created_at) : '—'}</small></span></div><button class="management-backup-automatic-status" type="button" data-management-action="toggle-backup-automatic" role="switch" aria-checked="${automatic}" aria-label="${automatic ? 'Desativar' : 'Ativar'} backup automático"><i></i><span><b>${automatic ? 'Ativado' : 'Desativado'}</b><small>Backup automático</small></span></button></div></section><section class="management-backup-actions-section" aria-labelledby="managementBackupActionsTitle"><h3 id="managementBackupActionsTitle">Ações</h3><div class="management-backup-action-grid"><button class="management-backup-action-card create" type="button" data-management-action="create-backup"><span class="management-backup-action-icon">${backupSvg('download', 37)}</span><span><b>Criar Backup</b><small>Criar uma cópia completa dos dados da Gestão TI.</small></span></button><button class="management-backup-action-card restore" type="button" data-management-action="restore-backup"><span class="management-backup-action-icon">${backupSvg('upload', 37)}</span><span><b>Restaurar Backup</b><small>Selecionar um backup e recuperar os dados.</small></span></button></div></section><div class="management-backup-details-grid"><section class="management-backup-auto-panel" aria-labelledby="managementBackupAutoTitle"><h3 id="managementBackupAutoTitle">Backup automático</h3><button class="management-backup-switch-row" type="button" data-management-action="toggle-backup-automatic" role="switch" aria-checked="${automatic}"><span class="management-backup-switch ${automatic ? 'enabled' : ''}"><i></i></span><span><b>Backup automático</b><small>Criar automaticamente uma cópia dos dados em intervalos definidos.</small></span></button><label class="management-backup-frequency"><span>Frequência</span><span class="management-backup-frequency-control">${backupSvg('calendar', 20)}<input type="number" min="1" max="90" step="1" value="${frequencyDays}" data-management-backup-frequency aria-label="Frequência do backup automático em dias"><em>dias</em></span><small>De 1 a 90 dias. A alteração é salva automaticamente.</small></label></section><section class="management-backup-history-panel" aria-labelledby="managementBackupHistoryTitle"><h3 id="managementBackupHistoryTitle">Histórico de backups</h3><div class="management-backup-history-list">${backupHistoryMarkup()}</div></section></div><footer class="management-backup-footer"><div class="management-backup-warning">${backupSvg('warning', 32)}<p><b>Atenção:</b> restaurar um backup substituirá todos os dados atuais da Gestão TI pelos dados do backup selecionado.<br>Esta ação não poderá ser desfeita.</p></div><button class="management-backup-secondary" type="button" data-management-action="close">Fechar</button></footer></div></section>`;
  }

  function backupChoiceModal(kind) {
    const creating = kind === 'create';
    return `<section class="management-modal-dialog management-backup-dialog management-backup-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="managementBackupChoiceTitle"><div class="management-backup-content"><header class="management-backup-header"><div class="management-backup-title-icon ${creating ? '' : 'restore-title'}">${backupSvg(creating ? 'download' : 'upload', 27)}</div><div><h2 id="managementBackupChoiceTitle">${creating ? 'Criar Backup' : 'Restaurar Backup'}</h2><p>${creating ? 'Escolha onde deseja guardar a cópia dos dados.' : 'Escolha a origem do backup que deseja recuperar.'}</p></div><button class="management-backup-close" type="button" data-management-action="close" aria-label="Fechar">${backupSvg('close', 22)}</button></header><div class="management-backup-destination-grid"><button class="management-backup-destination" type="button" data-management-action="${creating ? 'backup-local-create' : 'backup-local-restore'}"><span>${backupSvg(creating ? 'download' : 'upload', 30)}</span><b>Este computador</b><small>${creating ? 'Baixa um arquivo JSON para armazenamento local.' : 'Escolha um arquivo JSON salvo no computador.'}</small></button><button class="management-backup-destination network" type="button" data-management-action="${creating ? 'backup-network-create' : 'backup-network-restore'}"><span>${backupSvg('database', 30)}</span><b>Supabase</b><small>${creating ? 'Guarda uma cópia privada no banco de dados.' : 'Mostra as cópias privadas disponíveis no histórico.'}</small></button></div><div class="management-backup-choice-footer"><button class="management-backup-secondary" type="button" data-management-action="backup-back">Voltar</button></div></div></section>`;
  }

  function networkRestoreModal() {
    const choices = state.backups.length
      ? state.backups.map(backup => `<button class="management-backup-restore-option" type="button" data-management-action="prepare-network-restore" data-management-backup-id="${escape(backup.id)}"><span class="management-backup-restore-option-icon">${backupSvg('calendar', 23)}</span><span><b>${backupDate(backup.created_at)} — ${backupTime(backup.created_at)}</b><small>${backupSource(backup.source)}</small></span><span class="management-backup-restore-arrow">›</span></button>`).join('')
      : `<div class="management-backup-history-empty">${backupSvg('history', 34)}<p>Nenhum backup privado disponível para restaurar.</p></div>`;
    return `<section class="management-modal-dialog management-backup-dialog management-backup-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="managementNetworkRestoreTitle"><div class="management-backup-content"><header class="management-backup-header"><div class="management-backup-title-icon restore-title">${backupSvg('upload', 27)}</div><div><h2 id="managementNetworkRestoreTitle">Restaurar Backup</h2><p>Selecione uma cópia privada para continuar.</p></div><button class="management-backup-close" type="button" data-management-action="close" aria-label="Fechar">${backupSvg('close', 22)}</button></header><div class="management-backup-restore-list">${choices}</div><div class="management-backup-choice-footer"><button class="management-backup-secondary" type="button" data-management-action="restore-backup">Voltar</button></div></div></section>`;
  }

  function restoreBackupModal() {
    const total = state.pendingRestore?.items?.length || 0;
    return `<section class="management-modal-dialog management-backup-dialog management-backup-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="managementRestoreTitle"><div class="management-backup-content"><header class="management-backup-header"><div class="management-backup-title-icon restore-title">${backupSvg('upload', 27)}</div><div><h2 id="managementRestoreTitle">Confirmar restauração</h2><p>Backup da Gestão TI selecionado</p></div><button class="management-backup-close" type="button" data-management-action="backup" aria-label="Fechar">${backupSvg('close', 22)}</button></header><div class="management-backup-confirm-summary">${backupSvg('calendar', 24)}<span><b>${total} ${total === 1 ? 'equipamento será restaurado' : 'equipamentos serão restaurados'}</b><small>Os dados atuais serão substituídos.</small></span></div><div class="management-backup-confirm-warning">${backupSvg('warning', 27)}<div><b>Atenção</b><p>A restauração substituirá todos os dados atuais da Gestão TI pelos dados do backup selecionado. Esta ação não poderá ser desfeita.</p></div></div><footer class="management-backup-choice-footer"><button class="management-backup-secondary" type="button" data-management-action="restore-backup">Cancelar</button><button class="management-backup-critical" type="button" data-management-action="confirm-backup-restore">Restaurar Backup</button></footer></div></section>`;
  }

  function renderModal() {
    if (!state.modal) { modalNode.hidden = true; modalNode.innerHTML = ''; return; }
    modalNode.hidden = false;
    if (state.modal.type === 'backup') modalNode.innerHTML = backupModal();
    else if (state.modal.type === 'backup-create') modalNode.innerHTML = backupChoiceModal('create');
    else if (state.modal.type === 'backup-restore-choice') modalNode.innerHTML = backupChoiceModal('restore');
    else if (state.modal.type === 'backup-network-restore') modalNode.innerHTML = networkRestoreModal();
    else if (state.modal.type === 'backup-restore') modalNode.innerHTML = restoreBackupModal();
    else if (state.modal.type === 'add') modalNode.innerHTML = formModal(null);
    else {
      const item = activeItem();
      if (!item) { state.modal = null; renderModal(); return; }
      if (state.modal.type === 'edit') modalNode.innerHTML = formModal(item);
      else if (state.modal.type === 'transfer') modalNode.innerHTML = transferModal(item);
      else if (state.modal.type === 'delete') modalNode.innerHTML = deleteModal(item);
      else if (state.modal.type === 'log') modalNode.innerHTML = logEditorModal(item, (item.logs || []).find(log => log.id === state.modal.logId));
      else if (state.modal.type === 'delete-log') modalNode.innerHTML = deleteLogModal(item, (item.logs || []).find(log => log.id === state.modal.logId));
      else modalNode.innerHTML = detailsModal(item);
    }
    applyStatusModalGlow();
  }

  function applyStatusModalGlow() {
    const item = activeItem();
    const dialog = modalNode.querySelector('.management-modal-dialog');
    if (!item || !dialog) return;
    const presentation = statusPresentation[item.status] || statusPresentation.Ativo;
    if (!dialog.classList.contains('management-asset-detail')) dialog.classList.add('management-status-glow');
    dialog.style.setProperty('--management-modal-status-color', presentation.color);
  }

  function openDetails(id) {
    if (!payload.items.some(item => item.id === id)) return;
    detailReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.modal = { type: 'details', id };
    state.tab = 'general';
    state.actionMenu = false;
    renderModal();
    modalNode.querySelector('.management-asset-close')?.focus({ preventScroll: true });
    refreshPeripheralStatuses().then(changed => {
      if (changed && state.modal?.type === 'details' && state.modal.id === id) {
        renderModal();
        modalNode.querySelector('.management-asset-close')?.focus({ preventScroll: true });
      }
    });
  }

  function makeItem(form) {
    const values = Object.fromEntries(new FormData(form));
    const current = activeItem();
    const knownPeripherals = peripheralTypes.map((type, index) => {
      const status = peripheralTag(values[peripheralFieldName(type)]) || 'Não informado';
      const previous = (current?.peripherals || []).find(entry => normalize(entry.type || entry.tipo) === normalize(type));
      const sameInventoryLink = previous?.sourceModule === 'inventory' && peripheralTag(previous.status) === status;
      return { id: previous?.id || `peripheral-${Date.now()}-${index}`, type, status,
        ...(sameInventoryLink ? { sourceModule: 'inventory', sourceItemId: previous.sourceItemId } : {}) };
    }).filter(peripheral => peripheral.status !== 'Não informado');
    const legacyPeripherals = (current?.peripherals || []).filter(entry => !peripheralTypes.some(type => normalize(entry.type || entry.tipo) === normalize(type)));
    const peripherals = [...knownPeripherals, ...legacyPeripherals];
    return {
      ...(current || {}), terminal: current ? current.terminal : String(values.terminal || '').trim(), equipment: String(values.equipment || '').trim(), tag: String(values.tag || '').trim(), brand: String(values.brand || '').trim(), model: String(values.model || '').trim(), serial: String(values.serial || '').trim(),
      ip: String(values.ip || '').trim(), gateway: String(values.gateway || '').trim(), subnetMask: String(values.subnetMask || '').trim(), hostname: current?.hostname || '', operatingSystem: String(values.operatingSystem || '').trim(), osVersion: String(values.osVersion || '').trim(),
      processor: String(values.processor || '').trim(), memory: String(values.memory || '').trim(), storage: String(values.storage || '').trim(), type: current?.type || values.area || '', company: current?.company || '', sector: String(values.sector || '').trim(),
      location: String(values.location || '').trim(), responsible: current?.responsible || '', user: current?.user || '', notes: String(values.notes || '').trim(), status: values.status, priority: priorities.includes(values.priority) ? values.priority : 'Estável',
      situation: values.situation, cleaning: values.cleaning, area: values.area, isFixed: current ? Boolean(current.isFixed) : false, peripherals,
      monitoring: current?.monitoring || {},
      registeredAt: current?.registeredAt || new Date().toISOString().slice(0, 10), logs: [...(current?.logs || [])]
    };
  }

  function logDescription(previous, next) {
    if (!previous) return `${next.equipment}: equipamento cadastrado no sistema.`;
    const tracked = [['status', 'status'], ['priority', 'prioridade'], ['ip', 'IP'], ['sector', 'setor'], ['situation', 'situação'], ['cleaning', 'limpeza']];
    const changes = tracked.filter(([key]) => String(previous[key] || '') !== String(next[key] || '')).map(([key, label]) => `${label}: “${previous[key] || 'Não informado'}” → “${next[key] || 'Não informado'}”`);
    return changes.length ? `Alterações na Gestão TI — ${changes.join('; ')}.` : 'Dados técnicos revisados na Gestão TI.';
  }

  function validatePeripheralFields(form) {
    const inputs = [...form.querySelectorAll('[data-management-peripheral-input]')];
    const invalid = inputs.find(input => {
      const type = input.dataset.managementPeripheralInput;
      input.value = peripheralTag(input.value);
      const valid = isValidPeripheralTag(type, input.value);
      input.setCustomValidity(valid ? '' : `Informe a TAG no formato ${peripheralTagRules[type]?.example || 'correto'}.`);
      return !valid;
    });
    if (!invalid) return true;
    invalid.reportValidity();
    invalid.focus();
    notify(`Use o formato ${peripheralTagRules[invalid.dataset.managementPeripheralInput]?.example || 'correto'} para este periférico.`);
    return false;
  }

  async function saveFromForm(form) {
    if (!validatePeripheralFields(form) || !form.reportValidity()) return;
    const previous = activeItem();
    const next = makeItem(form);
    if (!next.terminal) { notify('Informe o nome do terminal.'); return; }
    const description = logDescription(previous, next);
    next.logs = [uniqueLog(description), ...(next.logs || [])];
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true; submit.textContent = 'Salvando…';
    const finishSave = window.AldeckotLoading?.beginSave?.(previous ? 'Salvando alterações…' : 'Adicionando terminal…');
    try {
      const saved = await window.AldeckotSupabase.management.save(next, previous?.id, description);
      const index = payload.items.findIndex(item => item.id === saved.id);
      if (index >= 0) payload.items.splice(index, 1);
      payload.items.unshift(saved);
      await refreshPeripheralStatuses();
      state.syncAt = new Date().toISOString();
      state.modal = { type: 'details', id: saved.id };
      state.tab = 'general';
      state.actionMenu = false;
      render(); renderModal();
      notify(previous ? 'Equipamento atualizado com sucesso.' : 'Equipamento adicionado à Gestão TI.');
    } catch (error) {
      console.error('Falha ao salvar equipamento da Gestão TI:', error);
      submit.disabled = false; submit.textContent = previous ? 'Salvar alterações' : 'Adicionar equipamento';
      notify(error?.message || 'Não foi possível salvar o equipamento.');
    } finally { await finishSave?.(); }
  }

  async function transferActive(form) {
    const source = activeItem();
    const destinationId = String(new FormData(form).get('destinationId') || '');
    const destination = payload.items.find(item => item.id === destinationId);
    if (!source || !hasFixedTerminal(source) || !destination || !hasFixedTerminal(destination) || !canTransferBetweenAreas(source.area, destination.area)) {
      notify('Selecione um terminal de destino válido.');
      return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = 'Transferindo…';
    try {
      payload = await window.AldeckotSupabase.management.transfer(source.id, destination.id);
      state.syncAt = new Date().toISOString();
      state.modal = { type: 'details', id: source.id };
      state.tab = 'general';
      state.actionMenu = false;
      render();
      renderModal();
      notify(`Computador transferido de ${terminalName(source)} para ${terminalName(destination)}.`);
    } catch (error) {
      console.error('Falha ao transferir computador entre terminais:', error);
      submit.disabled = false;
      submit.textContent = 'Confirmar transferência';
      notify(error?.message || 'Não foi possível concluir a transferência. Verifique as migrações da Gestão TI no Supabase.');
    }
  }

  function applyTransferSearch() {
    const query = normalize(state.transferQuery);
    const cards = [...modalNode.querySelectorAll('[data-management-transfer-search]')];
    let visible = 0;
    cards.forEach(card => {
      const matches = !query || String(card.dataset.managementTransferSearch || '').includes(query);
      card.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = modalNode.querySelector('[data-management-transfer-empty]');
    if (empty) empty.hidden = visible > 0;
  }

  async function saveLogFromForm(form) {
    const item = activeItem();
    if (!item) return;
    const values = Object.fromEntries(new FormData(form));
    const text = String(values.text || '').trim();
    if (!text) { notify('Informe a descrição do log.'); return; }
    const editingLog = (item.logs || []).find(log => log.id === state.modal?.logId);
    const nextLog = editingLog ? { ...editingLog, text } : uniqueLog(text);
    const logs = editingLog
      ? (item.logs || []).map(log => log.id === editingLog.id ? nextLog : log)
      : [nextLog, ...(item.logs || [])];
    const activity = editingLog ? `Log editado na Gestão TI: ${text}` : `Log manual adicionado na Gestão TI: ${text}`;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true; submit.textContent = 'Salvando…';
    try {
      const saved = await window.AldeckotSupabase.management.save({ ...item, logs }, item.id, activity);
      const index = payload.items.findIndex(entry => entry.id === saved.id);
      if (index >= 0) payload.items.splice(index, 1, saved);
      state.syncAt = new Date().toISOString();
      state.modal = { type: 'details', id: saved.id }; state.tab = 'history';
      render(); renderModal(); notify(editingLog ? 'Log atualizado com sucesso.' : 'Log adicionado com sucesso.');
    } catch (error) {
      console.error('Falha ao salvar log da Gestão TI:', error);
      submit.disabled = false; submit.textContent = editingLog ? 'Salvar log' : 'Adicionar log';
      notify(error?.message || 'Não foi possível salvar o log.');
    }
  }

  async function deleteLog() {
    const item = activeItem();
    const targetId = state.modal?.logId;
    const removed = (item?.logs || []).find(log => log.id === targetId);
    if (!item || !removed) return;
    try {
      const saved = await window.AldeckotSupabase.management.save({ ...item, logs: item.logs.filter(log => log.id !== targetId) }, item.id, 'Log removido da Gestão TI.');
      if (removed.sourceModule === 'control' && removed.sourceLogId) {
        await window.AldeckotSupabase.control.deleteLog(removed.sourceLogId);
      }
      const index = payload.items.findIndex(entry => entry.id === saved.id);
      if (index >= 0) payload.items.splice(index, 1, saved);
      state.syncAt = new Date().toISOString();
      state.modal = { type: 'details', id: saved.id }; state.tab = 'history';
      render(); renderModal(); notify('Log excluído com sucesso.');
    } catch (error) {
      console.error('Falha ao excluir log da Gestão TI:', error);
      notify(error?.message || 'Não foi possível excluir o log.');
    }
  }

  async function removeActive() {
    const item = activeItem();
    if (!item) return;
    if (isProtectedTerminal(item)) { notify('Terminais fixos não podem ser excluídos.'); return; }
    try {
      await window.AldeckotSupabase.management.remove(item.id);
      payload.items = payload.items.filter(entry => entry.id !== item.id);
      state.modal = null; state.syncAt = new Date().toISOString();
      render(); renderModal(); notify('Equipamento excluído da Gestão TI.');
    } catch (error) { console.error('Falha ao excluir equipamento:', error); notify(error?.message || 'Não foi possível excluir o equipamento.'); }
  }

  async function openBackup() {
    state.modal = { type: 'backup' };
    state.backups = [];
    renderModal();
    try {
      await refreshBackupState();
      renderModal();
    } catch (error) {
      console.error('Falha ao carregar backups da Gestão TI:', error);
      notify(error?.message || 'Não foi possível carregar o histórico de backups. Execute a migração 012 no Supabase.');
    }
  }

  async function refreshBackupState(createAutomatic = false) {
    const backupApi = window.AldeckotSupabase.managementBackups;
    const initialHistory = await backupApi.list();
    let settings = { automatic: false, frequency_days: 7, updated_at: null };
    try { settings = await backupApi.settings(); }
    catch (settingsError) { console.warn('Configuração de backup automático da Gestão TI indisponível:', settingsError); }
    let history = initialHistory;
    const latest = history[0];
    const frequencyDays = Math.max(1, Number(settings.frequency_days || 7));
    if (createAutomatic && settings.automatic && (!latest || Date.now() - new Date(latest.created_at).getTime() >= frequencyDays * 86400000)) {
      const automatic = await backupApi.create(backupSnapshot(), 'Backup automático da Gestão TI', 'automatic');
      history = [automatic, ...history.filter(backup => backup.id !== automatic.id)].slice(0, 3);
    }
    state.backupSettings = settings;
    state.backups = history;
  }

  async function createNetworkBackup() {
    try {
      await window.AldeckotSupabase.managementBackups.create(backupSnapshot(), backupLabel(), 'network');
      state.localBackupAt = null;
      await refreshBackupState();
      state.modal = { type: 'backup' };
      renderModal();
      notify('Backup armazenado com sucesso na nuvem privada.');
    } catch (error) {
      console.error('Falha ao criar backup da Gestão TI:', error);
      notify(error?.message || 'Não foi possível criar o backup. Execute as migrações 011 e 012 no Supabase.');
    }
  }

  function createLocalBackup() {
    const created_at = new Date().toISOString();
    downloadJson(`gestao-ti_backup_${created_at.replace(/[:.]/g, '-')}.json`, backupSnapshot());
    state.localBackupAt = { created_at, source: 'local' };
    state.modal = { type: 'backup' };
    renderModal();
    notify('Cópia local baixada com sucesso.');
  }

  async function toggleAutomaticBackup() {
    try {
      const next = await window.AldeckotSupabase.managementBackups.setAutomatic(!state.backupSettings.automatic);
      state.backupSettings = next;
      state.modal = { type: 'backup' };
      renderModal();
      notify(next.automatic ? 'Backup automático ativado.' : 'Backup automático desativado.');
    } catch (error) {
      console.error('Falha ao atualizar backup automático da Gestão TI:', error);
      notify(error?.message || 'Não foi possível atualizar o backup automático. Execute a migração 012 no Supabase.');
    }
  }

  async function updateBackupFrequency(input) {
    const days = Number(input.value);
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      input.value = Number(state.backupSettings?.frequency_days || 7);
      notify('Informe uma frequência entre 1 e 90 dias.');
      return;
    }
    input.disabled = true;
    try {
      state.backupSettings = await window.AldeckotSupabase.managementBackups.setFrequency(days);
      state.modal = { type: 'backup' };
      renderModal();
      notify(`Backup automático ajustado para cada ${days} ${days === 1 ? 'dia' : 'dias'}.`);
    } catch (error) {
      input.disabled = false;
      notify(error?.message || 'Não foi possível atualizar a frequência do backup.');
    }
  }

  async function restorePendingBackup() {
    if (!state.pendingRestore) return;
    try {
      payload = await window.AldeckotSupabase.management.replaceAll(state.pendingRestore.items);
      state.pendingRestore = null;
      state.modal = null;
      state.syncAt = new Date().toISOString();
      render(); renderModal();
      notify('Backup restaurado com sucesso.');
    } catch (error) {
      console.error('Falha ao restaurar backup da Gestão TI:', error);
      notify(error?.message || 'Não foi possível restaurar o backup.');
    }
  }

  function exportSummary() {
    const items = filteredItems();
    const printBrand = new URL('assets/aldeckot-symbol.png?v=2.0.71', location.href).href;
    const rows = items.map(item => `<tr><td>${escape(item.equipment)}</td><td>${escape(item.tag || '—')}</td><td>${escape(item.ip || '—')}</td><td>${escape(item.area)}</td><td>${escape(item.situation)}</td><td>${escape(item.status)}</td></tr>`).join('') || '<tr><td colspan="6">Nenhum equipamento para exportar.</td></tr>';
    const popup = window.open('', '_blank', 'width=1100,height=760');
    if (!popup) { notify('Permita a abertura da janela de impressão para exportar o resumo.'); return; }
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Gestão TI — ALDECKOT</title><style>body{font-family:Arial,sans-serif;color:#152c43;padding:28px}h1{margin:0;color:#087998}p{color:#58718a}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:9px;border-bottom:1px solid #c8d8e5;text-align:left;font-size:12px}th{background:#e9f6fb;color:#17617c}.print-brand{display:block;width:54px;height:36px;object-fit:contain;margin-bottom:3px}</style></head><body><img class="print-brand" src="${printBrand}" alt=""><h1>Gestão TI — ALDECKOT</h1><p>Resumo de monitoramento · ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr><th>Equipamento</th><th>TAG</th><th>IP</th><th>Área</th><th>Situação</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
    popup.document.close();
  }

  async function load() {
    try {
      await (window.AldeckotAuthReady || Promise.resolve());
      if (!window.AldeckotAuth?.session) return;
      await window.AldeckotSupabase.init();
      payload = await window.AldeckotSupabase.management.load();
      await refreshPeripheralStatuses();
      state.syncAt = new Date().toISOString();
      try { await refreshBackupState(Boolean(window.AldeckotAuth?.isAdmin)); }
      catch (backupError) { console.warn('Backup automático da Gestão TI indisponível:', backupError); }
      render();
      window.AldeckotModuleStage?.reveal?.();
      const pending = route.get('item');
      if (pending && payload.items.some(item => item.id === pending)) openDetails(pending);
    } catch (error) {
      console.error('Falha ao carregar Gestão TI:', error);
      app.innerHTML = `<section class="management-empty"><i>${svg('monitor', 24)}</i><h2>Não foi possível abrir a Gestão TI.</h2><p>${escape(error?.message || 'Verifique a conexão com o Supabase e tente novamente.')}</p><button type="button" data-management-action="retry">Tentar novamente</button></section>`;
      window.AldeckotModuleStage?.reveal?.();
    }
  }

  document.addEventListener('click', event => {
    const open = event.target.closest('[data-management-open]');
    if (open) { openDetails(open.dataset.managementOpen); return; }
    const tab = event.target.closest('[data-management-tab]');
    if (tab) { state.tab = tab.dataset.managementTab; renderModal(); modalNode.querySelector(`[data-management-tab="${state.tab}"]`)?.focus({ preventScroll: true }); return; }
    const actionNode = event.target.closest('[data-management-action]');
    const action = actionNode?.dataset.managementAction;
    if (!action) return;
    const restrictedActions = new Set(['add-area', 'toggle-actions', 'transfer', 'select-transfer-destination', 'edit', 'delete', 'confirm-delete', 'add-log', 'edit-log', 'delete-log', 'confirm-delete-log', 'backup', 'create-backup', 'restore-backup', 'backup-network-create', 'backup-local-create', 'backup-local-restore', 'backup-network-restore', 'toggle-backup-automatic', 'prepare-network-restore', 'confirm-backup-restore']);
    if (restrictedActions.has(action) && !canManage()) { event.preventDefault(); return; }
    if (action === 'add-area') { state.modal = { type: 'add', area: actionNode.dataset.managementArea || 'Escritório' }; state.actionMenu = false; renderModal(); }
    if (action === 'close') {
      const closingDetails = state.modal?.type === 'details';
      state.modal = null; state.actionMenu = false; renderModal();
      if (closingDetails && detailReturnFocus?.isConnected) detailReturnFocus.focus({ preventScroll: true });
      if (closingDetails) detailReturnFocus = null;
    }
    if (action === 'details' && activeItem()) { state.modal = { type: 'details', id: activeItem().id }; state.tab = actionNode.dataset.managementReturnTab || 'general'; state.actionMenu = false; renderModal(); }
    if (action === 'copy-network' && activeItem()) {
      const field = actionNode.dataset.managementNetworkField;
      if (!['ip', 'subnetMask', 'gateway', 'dns'].includes(field) || !hasDetailValue(activeItem()[field])) return;
      if (!navigator.clipboard?.writeText) { notify('A cópia não está disponível neste navegador.'); return; }
      navigator.clipboard.writeText(String(activeItem()[field])).then(() => notify('Dado de rede copiado.'), () => notify('Não foi possível copiar o dado de rede.'));
      return;
    }
    if (action === 'toggle-actions' && activeItem()) { state.actionMenu = !state.actionMenu; renderModal(); }
    if (action === 'transfer' && activeItem() && hasFixedTerminal(activeItem())) { state.modal = { type: 'transfer', id: activeItem().id }; state.transferDestinationId = ''; state.transferQuery = ''; state.actionMenu = false; renderModal(); }
    if (action === 'select-transfer-destination' && activeItem() && state.modal?.type === 'transfer') { state.transferDestinationId = actionNode.dataset.managementDestinationId || ''; renderModal(); }
    if (action === 'edit' && activeItem()) { state.modal = { type: 'edit', id: activeItem().id }; state.actionMenu = false; renderModal(); }
    if (action === 'delete' && activeItem() && !isProtectedTerminal(activeItem())) { state.modal = { type: 'delete', id: activeItem().id }; state.actionMenu = false; renderModal(); }
    if (action === 'confirm-delete' && activeItem() && !isProtectedTerminal(activeItem())) removeActive();
    if (action === 'add-log' && activeItem()) { state.modal = { type: 'log', id: activeItem().id }; renderModal(); }
    if (action === 'edit-log' && activeItem()) { state.modal = { type: 'log', id: activeItem().id, logId: actionNode.dataset.managementLogId }; renderModal(); }
    if (action === 'delete-log' && activeItem()) { state.modal = { type: 'delete-log', id: activeItem().id, logId: actionNode.dataset.managementLogId }; renderModal(); }
    if (action === 'confirm-delete-log') deleteLog();
    if (action === 'clear-filters') { state.query = ''; state.status = ''; state.situation = ''; state.operation = ''; applyManagementFilters(); }
    if (action === 'retry') { app.innerHTML = '<section class="management-loading"><i></i><p>Conectando à Gestão TI…</p></section>'; load(); }
    if (action === 'home') {
      if (window.AldeckotRoute?.goHome) window.AldeckotRoute.goHome();
      else window.location.href = 'index.html';
    }
    if (action === 'export') exportSummary();
    if (action === 'backup') openBackup();
    if (action === 'create-backup') { state.modal = { type: 'backup-create' }; renderModal(); }
    if (action === 'restore-backup') { state.modal = { type: 'backup-restore-choice' }; renderModal(); }
    if (action === 'backup-back') { state.modal = { type: 'backup' }; renderModal(); }
    if (action === 'backup-network-create') createNetworkBackup();
    if (action === 'backup-local-create') createLocalBackup();
    if (action === 'backup-local-restore') restoreInput?.click();
    if (action === 'backup-network-restore') { state.modal = { type: 'backup-network-restore' }; renderModal(); }
    if (action === 'toggle-backup-automatic') toggleAutomaticBackup();
    if (action === 'prepare-network-restore') {
      const selected = state.backups.find(backup => backup.id === actionNode.dataset.managementBackupId);
      try { state.pendingRestore = normalizedBackup(selected?.snapshot); state.modal = { type: 'backup-restore' }; renderModal(); }
      catch (error) { notify(error.message || 'Este backup não é compatível.'); }
    }
    if (action === 'confirm-backup-restore') restorePendingBackup();
  });
  document.addEventListener('keydown', event => {
    if (state.modal?.type !== 'details') return;
    const dialog = modalNode.querySelector('.management-asset-detail');
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      state.modal = null; state.actionMenu = false; renderModal();
      if (detailReturnFocus?.isConnected) detailReturnFocus.focus({ preventScroll: true });
      detailReturnFocus = null;
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')]
      .filter(element => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener('input', event => {
    if (event.target.matches('[data-management-query]')) { state.query = event.target.value; applyManagementFilters(); }
    if (event.target.matches('[data-management-transfer-query]')) { state.transferQuery = event.target.value; applyTransferSearch(); }
    if (event.target.matches('[data-management-peripheral-input]')) {
      const type = event.target.dataset.managementPeripheralInput;
      event.target.value = peripheralTag(event.target.value);
      event.target.setCustomValidity(isValidPeripheralTag(type, event.target.value) ? '' : `Informe a TAG no formato ${peripheralTagRules[type]?.example || 'correto'}.`);
    }
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-management-backup-frequency]')) updateBackupFrequency(event.target);
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-management-status]')) { state.status = event.target.value; state.operation = ''; applyManagementFilters(); }
    if (event.target.matches('[data-management-situation]')) { state.situation = event.target.value; state.operation = ''; applyManagementFilters(); }
    if (event.target.matches('[data-management-priority-choice]')) {
      event.target.closest('[data-management-priority-field]')?.setAttribute('data-tone', priorityTone(event.target.value));
    }
  });
  document.addEventListener('submit', event => {
    if (!canManage() && event.target.matches('[data-management-form], [data-management-log-form], [data-management-transfer-form]')) { event.preventDefault(); return; }
    if (event.target.matches('[data-management-form]')) { event.preventDefault(); saveFromForm(event.target); }
    if (event.target.matches('[data-management-log-form]')) { event.preventDefault(); saveLogFromForm(event.target); }
    if (event.target.matches('[data-management-transfer-form]')) { event.preventDefault(); transferActive(event.target); }
  });
  restoreInput?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      state.pendingRestore = normalizedBackup(JSON.parse(await file.text()));
      state.modal = { type: 'backup-restore' };
      renderModal();
    } catch (error) {
      notify(error?.message || 'Não foi possível ler este arquivo de backup.');
    }
  });
  let managementRealtimeTimer;
  let peripheralRealtimeTimer;
  window.addEventListener('aldeckot:realtime-change', event => {
    if (event.detail?.table === 'inventory_items') {
      window.clearTimeout(peripheralRealtimeTimer);
      peripheralRealtimeTimer = window.setTimeout(async () => {
        const changed = await refreshPeripheralStatuses();
        if (changed && state.modal?.type === 'details') {
          const activeTab = document.activeElement?.dataset?.managementTab;
          renderModal();
          modalNode.querySelector(activeTab ? `[data-management-tab="${activeTab}"]` : '.management-asset-close')?.focus({ preventScroll: true });
        }
      }, 180);
      return;
    }
    if (!['module_tables', 'module_records', 'management_backups', 'management_backup_settings'].includes(event.detail?.table)) return;
    window.clearTimeout(managementRealtimeTimer);
    managementRealtimeTimer = window.setTimeout(load, 180);
  });
  window.AldeckotManagementOpenDetails = openDetails;
  load();
})();
