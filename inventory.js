(() => {
  const statuses = ['Ativo', 'Reserva', 'Manutenção', 'Troca', 'Defeito'];
  const situations = ['Normal', 'Atenção', 'Substituído', 'Verificando'];
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clone = value => JSON.parse(JSON.stringify(value));
  const stamp = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  let data = { tables: [] };
  let backupMeta = { last: null, lastAt: null, lastSource: null, automatic: false, history: [] };
  let pendingRestore = null;
  let backupBusy = false;
  let initialized = false;
  let state = { active: null, query: '', status: '', situation: '', sidebarOpen: false, tableMenu: null, tableMenuPosition: null };

  const readBackupMeta = () => ({ ...backupMeta });
  const writeBackupMeta = value => { backupMeta = { ...backupMeta, ...value }; };
  const backend = () => window.AldeckotSupabase;
  const backendMessage = error => error?.message || 'Não foi possível comunicar com o Supabase.';
  const clean = value => String(value ?? '').trim();
  const comparable = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalizeStatus = value => {
    const source = comparable(value);
    if (source.includes('manut')) return 'Manutenção';
    if (source.includes('reserva')) return 'Reserva';
    if (source.includes('troca') || source.includes('substitu')) return 'Troca';
    if (source.includes('defeito') || source.includes('queb')) return 'Defeito';
    return 'Ativo';
  };
  const normalizeSituation = value => {
    const source = comparable(value);
    if (source.includes('atenc')) return 'Atenção';
    if (source.includes('substitu')) return 'Substituído';
    if (source.includes('verific')) return 'Verificando';
    return 'Normal';
  };
  const normalizeLogs = logs => (Array.isArray(logs) ? logs : []).map(logEntry => {
    if (typeof logEntry === 'string') return { at: 'Backup antigo', text: logEntry };
    return {
      at: clean(logEntry?.timestamp || logEntry?.at || logEntry?.date || 'Backup antigo'),
      text: clean(logEntry?.action || logEntry?.text || logEntry?.message || 'Registro restaurado do backup antigo.')
    };
  });
  function normalizeImportedBackup(payload) {
    const root = payload?.data || payload;
    if (Array.isArray(root?.tables)) return { data: { tables: root.tables }, legacy: false };
    if (!Array.isArray(root?.inventarioTables)) throw new Error('Formato inválido');
    return {
      legacy: true,
      data: {
        tables: root.inventarioTables.map((legacyTable, index) => ({
          id: `legacy-table-${legacyTable.id || index}`,
          name: clean(legacyTable.nome || legacyTable.name || `Tabela ${index + 1}`),
          icon: clean(legacyTable.icon || '📁'),
          items: (Array.isArray(legacyTable.equipamentos) ? legacyTable.equipamentos : []).map((legacyItem, itemIndex) => ({
            id: `legacy-item-${legacyItem.id || `${index}-${itemIndex}`}`,
            equipment: clean(legacyItem.equipamento || legacyItem.equipment || 'Equipamento sem nome'),
            model: clean(legacyItem.modelo || legacyItem.model || 'Não informado'),
            brand: clean(legacyItem.marca || legacyItem.brand),
            serial: clean(legacyItem.serie || legacyItem.serial),
            tag: clean(legacyItem.tag),
            sector: clean(legacyItem.setor || legacyItem.sector),
            location: clean(legacyItem.local || legacyItem.location),
            status: normalizeStatus(legacyItem.status),
            situation: normalizeSituation(legacyItem.situacao || legacyItem.situation),
            notes: clean(legacyItem.observacoes || legacyItem.notes),
            logs: normalizeLogs(legacyItem.logs)
          }))
        }))
      }
    };
  }

  async function reloadInventory() {
    const api = backend();
    if (!api) throw new Error('Cliente Supabase não foi carregado.');
    await api.init();
    data = await api.inventory.load();
    const [setting, initialHistory] = await Promise.all([api.backups.settings(), api.backups.list()]);
    let history = initialHistory;
    let latest = history[0] || null;
    if (setting.automatic && (!latest || Date.now() - new Date(latest.created_at).getTime() >= 7 * 24 * 60 * 60 * 1000)) {
      latest = await api.backups.create(clone(data), 'Backup automático do Inventário', 'automatic');
      history = [latest, ...history.filter(backup => backup.id !== latest.id)];
    }
    writeBackupMeta({
      last: latest?.created_at ? new Date(latest.created_at).toLocaleString('pt-BR') : null,
      lastAt: latest?.created_at || null,
      lastSource: latest?.source || null,
      automatic: setting.automatic,
      history
    });
    // A área de trabalho só deve carregar depois que a pessoa escolher uma tabela.
    // Mantemos a seleção atual em atualizações, mas nunca escolhemos a primeira tabela automaticamente.
    if (state.active && !data.tables.some(table => table.id === state.active)) state.active = null;
    initialized = true;
  }

  function renderConnectionState(title, message) {
    document.body.classList.remove('home-page');
    document.body.classList.add('inventory-open');
    $('#app').innerHTML = `<div class="inventory-shell"><section class="inventory-panel inventory-empty-state"><div><div class="empty-cubes">◇ ◇</div><h2>${escape(title)}</h2><p>${escape(message)}</p><button data-inv-action="retry">Tentar novamente</button></div></section></div>`;
  }

  const activeTable = () => data.tables.find(table => table.id === state.active) || null;
  const className = value => String(value || '').toLowerCase().replaceAll(' ', '-');
  const choiceTone = (kind, value) => ({
    status: { Ativo: 'green', 'Manutenção': 'red', Reserva: 'yellow', Troca: 'gray', Defeito: 'orange' },
    situation: { Normal: 'turquoise', 'Atenção': 'yellow', 'Substituído': 'blue', Verificando: 'purple' }
  }[kind]?.[value] || 'blue');
  const countBy = (items, values, field) => Object.fromEntries(values.map(value => [value, items.filter(item => item[field] === value).length]));
  const log = (item, text) => { item.logs = item.logs || []; item.logs.unshift({ at: stamp(), text }); };

  function chart(title, items, field, values, prefix = '') {
    const counts = countBy(items, values, field);
    const max = Math.max(1, ...Object.values(counts));
    return `<section class="inventory-panel inventory-chart"><h3>${title}</h3><div class="inventory-chart-stage">${values.map(value => `<div class="inventory-chart-bar ${prefix}${className(value)}" style="height:${Math.max(3, Math.round((counts[value] / max) * 138))}px"></div>`).join('')}</div><div class="inventory-legend">${values.map(value => `<span class="${prefix}${className(value)}"><i></i><em>${escape(value)}</em><b>${counts[value]}</b></span>`).join('')}</div></section>`;
  }

  function tableListMarkup() {
    if (!data.tables.length) return '<p class="inventory-no-tables">Nenhuma tabela criada.</p>';
    return data.tables.map(entry => {
      const icon = entry.icon && entry.icon !== '📁' ? ` ${escape(entry.icon)}` : '';
      return `<div class="inventory-table-choice ${entry.id === state.active ? 'active' : ''}"><button class="inventory-table-select" data-inv-table="${entry.id}" aria-label="Abrir tabela ${escape(entry.name)}, ${entry.items.length} itens"><b>${escape(entry.name)}${icon}</b></button></div>`;
    }).join('');
  }

  function tableActionsPopover() {
    const entry = data.tables.find(table => table.id === state.tableMenu);
    const position = state.tableMenuPosition;
    if (!entry || !position) return '';
    return `<div class="inventory-table-actions-popover" role="menu" style="top:${position.top}px;left:${position.left}px"><button class="inventory-table-tool edit" data-inv-edit-table="${entry.id}" title="Editar tabela" aria-label="Editar tabela"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inventory-table-tool delete" data-inv-delete-table="${entry.id}" title="Excluir tabela" aria-label="Excluir tabela"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div>`;
  }

  function applyHeaderPresentation() {
    const actions = {
      'export-pdf': { label: 'Exportar PDF', className: 'inventory-pdf-action', icon: '<path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h4M8.5 14.5h1.2a1.2 1.2 0 0 0 0-2.4H8.5v4.8M12 16.9v-4.8h1.1a2.4 2.4 0 1 1 0 4.8H12ZM16.3 16.9v-4.8h2.5M16.3 14.5h2"/>' },
      backup: { label: 'Backup', className: 'inventory-backup-action', icon: '<ellipse cx="10.5" cy="5" rx="5.5" ry="2.5"/><path d="M5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.1 0 2.1-.1 3-.4M16 5v5M5 10c0 1.4 2.5 2.5 5.5 2.5S16 11.4 16 10M16.2 17.5l1.8 1.8 3.4-4"/>' },
      'add-table': { label: 'Nova tabela', className: 'inventory-new-table-action', icon: '<ellipse cx="10" cy="5" rx="5.5" ry="2.5"/><path d="M4.5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.2 0 2.3-.2 3.2-.5M15.5 5v7M4.5 10c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5M18.5 16v6m-3-3h6"/>' },
      sync: { label: 'Sincronizar', className: 'inventory-sync-action', icon: '<path d="M20 11a8 8 0 0 0-14-4L4 9m0-5v5h5M4 13a8 8 0 0 0 14 4l2-2m0 5v-5h-5"/>' },
      home: { label: 'Home', className: 'inventory-home-action', icon: '<path d="m4 10 8-6 8 6v9H4v-9Zm5 9v-5h6v5"/>' }
    };
    Object.entries(actions).forEach(([action, config]) => {
      const button = document.querySelector(`[data-inv-action="${action}"]`);
      if (!button) return;
      button.title = config.label;
      button.setAttribute('aria-label', config.label);
      button.classList.add(config.className);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${config.icon}</svg>`;
    });
    const toolbar = document.querySelector('.inventory-header-actions');
    toolbar?.setAttribute('role', 'toolbar');
    toolbar?.setAttribute('aria-label', 'Ações do Inventário');
  }

  function renderInventory() {
    document.body.classList.remove('home-page');
    document.body.classList.add('inventory-open');
    const table = activeTable();
    const items = table?.items || [];
    const visible = items.filter(item => JSON.stringify(item).toLowerCase().includes(state.query.toLowerCase()) && (!state.status || item.status === state.status) && (!state.situation || item.situation === state.situation));
    $('#app').innerHTML = `<div class="inventory-shell">
      <header class="inventory-header"><div class="inventory-heading"><div class="inventory-heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/></svg></div><div><h1>INVENTÁRIO</h1><p>Aldeckot — Controle de Equipamentos</p></div></div><div class="inventory-header-actions"><button title="Exportar tabela aberta em PDF" aria-label="Exportar tabela aberta em PDF" class="inventory-header-action" data-inv-action="export-pdf"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4"/></svg></button><button title="Sistema de backup" aria-label="Sistema de backup" class="inventory-header-action inventory-backup-action" data-inv-action="backup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l2 8H2l2-8Zm2-4h12l2 4H4l2-4Zm2 8h8"/></svg></button><button title="Criar nova tabela" aria-label="Criar nova tabela" class="inventory-header-action inventory-new-table-action" data-inv-action="add-table"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6l2 2h8v10H4V6Z"/><path d="M15 11v4m-2-2h4"/></svg></button><button title="Sincronizar módulo" aria-label="Sincronizar módulo" class="inventory-header-action" data-inv-action="sync"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-4L4 9m0-5v5h5M4 13a8 8 0 0 0 14 4l2-2m0 5v-5h-5"/></svg></button><span class="inventory-sync" aria-live="polite">Sincronizado <i></i></span><button title="Voltar para início" aria-label="Voltar para início" class="inventory-header-action inventory-home-action" data-inv-action="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 10 8-6 8 6v9H4v-9Zm5 9v-5h6v5"/></svg></button></div></header>
      <div class="inventory-layout ${state.sidebarOpen ? 'tables-open' : ''} ${table ? 'table-selected' : 'no-table-selected'}"><aside class="inventory-panel inventory-tables inventory-table-sidebar"><div class="inventory-sidebar-head"><button class="inventory-sidebar-toggle" data-inv-action="toggle-tables" title="${state.sidebarOpen ? 'Ocultar tabelas' : 'Mostrar tabelas'}" aria-expanded="${state.sidebarOpen}"><svg viewBox="0 0 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16M7 3v4m0 3v4m0 3v4"/></svg><span>Tabelas</span></button><button class="inventory-table-add" data-inv-action="add-table" title="Criar tabela">+</button></div><div class="inventory-sidebar-content"><div class="inventory-table-list">${tableListMarkup()}</div></div></aside>
      ${table ? `<main class="inventory-workspace">${tableMarkup(table, visible)}</main><aside class="inventory-charts">${chart('Distribuição por Status', items, 'status', statuses)}${chart('Distribuição por Situação', items, 'situation', situations, 'situation-')}</aside>` : `<main class="inventory-workspace inventory-empty-workspace">${emptyMarkup()}</main>`}</div></div>`;
    applyHeaderPresentation();
  }

  function emptyMarkup() {
    return `<section class="inventory-selection-empty-state" aria-labelledby="inventory-empty-title"><div class="inventory-empty-content"><svg class="inventory-empty-illustration" viewBox="0 0 420 260" role="img" aria-label="Cubos coloridos flutuando"><defs><g id="inventory-empty-cube" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 1 43 13.5 22 26 1 13.5 22 1Z"/><path d="M1 13.5 22 26v25L1 38.5v-25Z"/><path d="M22 26 43 13.5v25L22 51V26Z"/><path d="M1 13.5 22 26l21-12.5M22 26v25"/></g></defs><g class="inventory-empty-object inventory-empty-object-main"><use href="#inventory-empty-cube" transform="translate(145 73) scale(2.95)"/></g><g class="inventory-empty-object inventory-empty-object-purple"><use href="#inventory-empty-cube" transform="translate(76 42) scale(.94)"/></g><g class="inventory-empty-object inventory-empty-object-cyan"><use href="#inventory-empty-cube" transform="translate(308 20) scale(1.14)"/></g><g class="inventory-empty-object inventory-empty-object-lilac"><use href="#inventory-empty-cube" transform="translate(38 112) scale(.91)"/></g><g class="inventory-empty-object inventory-empty-object-green"><use href="#inventory-empty-cube" transform="translate(106 184) scale(.86)"/></g><g class="inventory-empty-object inventory-empty-object-yellow"><use href="#inventory-empty-cube" transform="translate(302 184) scale(.83)"/></g><circle class="inventory-empty-object inventory-empty-dot-one" cx="127" cy="142" r="5"/><circle class="inventory-empty-object inventory-empty-dot-two" cx="147" cy="184" r="4.5"/><circle class="inventory-empty-object inventory-empty-dot-three" cx="294" cy="166" r="4"/></svg><h2 id="inventory-empty-title">Nenhuma tabela selecionada</h2><p>Selecione uma tabela na lateral</p></div></section>`;
  }

  function tableMarkup(table, visible) {
    return `<section class="inventory-panel inventory-toolbar"><div class="inventory-search-wrap"><span>⌕</span><input class="inventory-search" data-inv-search placeholder="Buscar equipamento, série, marca, TAG..." value="${escape(state.query)}"></div><div class="inventory-toolbar-create"><select class="inventory-filter" data-inv-status><option value="">Status ▼</option>${statuses.map(status => `<option ${state.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select><select class="inventory-filter" data-inv-situation><option value="">Situação ▼</option>${situations.map(situation => `<option ${state.situation === situation ? 'selected' : ''}>${situation}</option>`).join('')}</select><button class="inventory-add" data-inv-action="add-item">＋ Adicionar</button></div><div class="inventory-toolbar-table-actions"><button class="inventory-table-header-action edit" data-inv-action="edit-active-table" title="Editar tabela" aria-label="Editar tabela"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inventory-table-header-action delete" data-inv-action="delete-active-table" title="Excluir tabela" aria-label="Excluir tabela"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div></section><section class="inventory-panel inventory-data-wrap"><table class="inventory-data"><thead><tr><th>EQUIPAMENTO</th><th>MODELO</th><th>MARCA</th><th>Nº SÉRIE</th><th>TAG</th><th>STATUS</th><th>SITUAÇÃO</th></tr></thead><tbody>${visible.length ? visible.map(item => `<tr data-inv-item="${item.id}"><td><b>${escape(item.equipment)}</b></td><td>${escape(item.model)}</td><td>${escape(item.brand)}</td><td>${escape(item.serial)}</td><td>${escape(item.tag)}</td><td><span class="inventory-status ${className(item.status)}">${escape(item.status)}</span></td><td><span class="inventory-situation ${className(item.situation)}">${escape(item.situation)}</span></td></tr>`).join('') : '<tr><td colspan="7" class="inventory-empty-row">Nenhum equipamento nesta tabela.</td></tr>'}</tbody></table></section>`;
  }

  function modal(content, dialogClass = '') { const node = document.createElement('div'); node.className = 'inv-modal'; node.innerHTML = `<div class="inv-dialog ${dialogClass}">${content}</div>`; document.body.appendChild(node); return node; }
  function closeModal() { document.querySelector('.inv-modal')?.remove(); }

  function tableForm(entry) {
    const value = entry || {};
    const node = modal(`<form class="table-form" data-inv-table-form><h2>${entry ? 'Editar Tabela' : 'Nova Tabela'}</h2><label class="table-form-label" for="inventory-table-name">Nome da Tabela <b>*</b><input id="inventory-table-name" class="table-form-input" name="name" required maxlength="40" value="${escape(value.name)}" placeholder="Ex.: Equipamentos TI, Estoque…" autofocus></label><div class="table-form-actions"><button class="table-form-submit" type="submit">${entry ? 'Salvar' : 'Criar'}</button><button class="table-form-cancel" type="button" data-inv-close>Cancelar</button></div>${entry ? `<button type="button" class="table-form-delete" data-inv-delete-table="${entry.id}">Excluir tabela</button>` : ''}</form>`, 'table-form-dialog');
    node.dataset.tableId = entry?.id || '';
  }

  function itemForm(entry) {
    if (!activeTable()) { tableForm(); return; }
    const value = entry || {};
    const status = statuses.includes(value.status) ? value.status : 'Ativo';
    const situation = situations.includes(value.situation) ? value.situation : 'Normal';
    const node = modal(`<div class="inv-dialog-head"><h2>${entry ? 'Editar Equipamento' : 'Adicionar Equipamento'}</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><form data-inv-item-form><div class="inv-fields equipment-fields"><label><span>Equipamento *</span><input name="equipment" required value="${escape(value.equipment)}"></label><label><span>Modelo *</span><input name="model" required value="${escape(value.model)}"></label><label><span>Marca</span><input name="brand" value="${escape(value.brand)}"></label><label><span>Nº Série</span><input name="serial" value="${escape(value.serial)}"></label><label><span>TAG</span><input name="tag" value="${escape(value.tag)}"></label><label><span>Setor</span><input name="sector" value="${escape(value.sector)}"></label><label><span>Local</span><input name="location" value="${escape(value.location)}"></label><label class="inv-choice-field" data-inv-choice-field data-kind="status" data-tone="${choiceTone('status', status)}"><span>Status</span><div class="inv-choice-select"><i></i><select name="status" data-inv-status-choice>${statuses.map(option => `<option ${status === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-choice-field" data-inv-choice-field data-kind="situation" data-tone="${choiceTone('situation', situation)}"><span>Situação</span><div class="inv-choice-select"><i></i><select name="situation" data-inv-situation-choice>${situations.map(option => `<option ${situation === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-full"><span>Observações</span><textarea name="notes">${escape(value.notes)}</textarea></label></div><div class="inv-footer equipment-footer">${entry ? `<button type="button" class="inv-ghost inv-danger" data-inv-delete-item="${entry.id}">Excluir</button>` : ''}<button class="inv-primary">Salvar</button><button type="button" class="inv-ghost" data-inv-close>Cancelar</button></div></form>`, 'equipment-dialog');
    node.dataset.itemId = entry?.id || '';
  }

  function details(item) {
    const labels = [['equipment', 'Equipamento'], ['model', 'Modelo'], ['brand', 'Marca'], ['serial', 'Nº de série'], ['tag', 'TAG'], ['status', 'Status'], ['situation', 'Situação'], ['date', 'Atualizado'], ['notes', 'Observações']];
    const logActions = entry => entry.id ? `<div class="inv-log-actions"><button class="inv-log-action edit" data-inv-action="edit-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Editar registro" aria-label="Editar registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inv-log-action delete" data-inv-action="delete-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Excluir registro" aria-label="Excluir registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div>` : '';
    const node = modal(`<div class="inv-dialog-head"><h2>${escape(item.equipment)}</h2><button class="inv-close" data-inv-close>×</button></div><div class="inv-detail-grid">${labels.map(([key, label]) => `<div class="inv-detail ${key === 'notes' ? 'inv-full' : ''}">${label}<b>${escape(item[key] || '—')}</b></div>`).join('')}</div><div class="inv-log-head"><h3>Histórico</h3><button class="inv-log-add" data-inv-action="add-log" data-inv-log-item="${item.id}">＋ Adicionar registro</button></div><div class="inv-log-list">${(item.logs || []).map(entry => `<div class="inv-log"><b>${escape(entry.at)}</b><span>${escape(entry.text)}</span>${logActions(entry)}</div>`).join('') || '<div class="inv-log">Nenhum registro no histórico.</div>'}</div><div class="inv-actions"><button class="inv-ghost" data-inv-close>Fechar</button><button class="inv-primary" data-inv-edit-item="${item.id}">Editar</button></div>`);
    node.dataset.itemId = item.id;
  }

  function logForm(item, entry = null) {
    const node = modal(`<div class="inv-dialog-head"><h2>${entry ? 'Editar registro' : 'Adicionar registro'}</h2><button class="inv-close" data-inv-close>×</button></div><p class="inv-log-intro">${escape(item.equipment)} · ${entry ? 'altere o texto do registro abaixo.' : 'o horário do registro será salvo automaticamente.'}</p><form data-inv-log-form><div class="inv-fields"><label class="inv-full"><span>Ocorrência</span><textarea name="message" required maxlength="500" placeholder="Ex.: Equipamento revisado, manutenção realizada ou troca de local.">${escape(entry?.text || '')}</textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button class="inv-primary">${entry ? 'Salvar alterações' : 'Salvar no histórico'}</button></div></form>`);
    node.dataset.itemId = item.id;
    node.dataset.logId = entry?.id || '';
  }

  function updateLogMessage(old, values) {
    if (!old) return 'Equipamento adicionado ao inventário.';
    const labels = { equipment: 'equipamento', model: 'modelo', brand: 'marca', serial: 'nº de série', tag: 'TAG', sector: 'setor', location: 'local', status: 'status', situation: 'situação', notes: 'observações' };
    const changes = Object.entries(labels).flatMap(([key, label]) => String(old[key] || '') !== String(values[key] || '') ? [`${label}: “${old[key] || '—'}” → “${values[key] || '—'}”`] : []);
    return changes.length ? `Alterações realizadas — ${changes.join('; ')}.` : 'Equipamento revisado sem alterações de campos.';
  }

  async function saveItem(form) {
    const table = activeTable(); const values = Object.fromEntries(new FormData(form)); const modalNode = document.querySelector('.inv-modal'); const id = modalNode.dataset.itemId; const old = id ? table.items.find(entry => entry.id === id) : null; let item = { ...values, id: id || `item-${Date.now()}`, date: old?.date || new Date().toISOString().slice(0, 10) };
    try {
      await backend().inventory.saveItem(table.id, item, id || null, updateLogMessage(old, item));
      closeModal();
      await reloadInventory();
      renderInventory();
    } catch (error) { alert(backendMessage(error)); }
  }
  function download(content, name, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
  function safeFileName(value) { return String(value || 'inventario').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }
  function formattedNow() { return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }

  function exportPdf() {
    const table = activeTable();
    if (!table) { alert('Selecione uma tabela para exportá-la em PDF.'); return; }
    const rows = table.items.map(item => `<tr><td>${escape(item.equipment)}</td><td>${escape(item.model)}</td><td>${escape(item.brand)}</td><td>${escape(item.serial)}</td><td>${escape(item.tag)}</td><td>${escape(item.status)}</td><td>${escape(item.situation)}</td><td>${escape(item.date || '—')}</td><td>${escape(item.notes || '—')}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhum equipamento cadastrado nesta tabela.</td></tr>';
    const popup = window.open('', '_blank', 'width=1280,height=860');
    if (!popup) { alert('Permita a abertura da janela de impressão para gerar o PDF.'); return; }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ALDECKOT — ${escape(table.name)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17202d;font-size:9px;margin:0}header{border-bottom:2px solid #2596e7;margin-bottom:14px;padding-bottom:10px}h1{font-size:20px;margin:0 0 4px;color:#10203a}p{margin:0;color:#516070}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#13223c;color:#fff;font-size:8px;letter-spacing:.2px;padding:8px 5px;text-align:left}td{border-bottom:1px solid #d5dce4;vertical-align:top;overflow-wrap:anywhere;padding:7px 5px}tbody tr:nth-child(even){background:#f4f7fa}.empty{text-align:center;padding:28px;color:#617084}footer{position:fixed;bottom:0;font-size:8px;color:#647386}@media print{footer{position:fixed}}</style></head><body><header><h1>ALDECKOT · INVENTÁRIO</h1><p>Tabela: <strong>${escape(table.name)}</strong> · ${table.items.length} item(ns) · Exportado em ${formattedNow()}</p></header><table><thead><tr><th>Equipamento</th><th>Modelo</th><th>Marca</th><th>Nº Série</th><th>TAG</th><th>Status</th><th>Situação</th><th>Data</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table><footer>ALDECKOT — Controle de Equipamentos</footer><script>window.onload=()=>{window.focus();window.print();};<\/script></body></html>`);
    popup.document.close();
  }

  const backupIcon = name => ({
    database: '<ellipse cx="10" cy="5" rx="5.5" ry="2.5"/><path d="M4.5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.2 0 2.3-.2 3.2-.5M15.5 5v7M4.5 10c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5M18.5 16v6m-3-3h6"/>',
    backup: '<ellipse cx="10" cy="5" rx="5.5" ry="2.5"/><path d="M4.5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.1 0 2.1-.1 3-.4M15.5 5v5M4.5 10c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5M16.2 17.5l1.8 1.8 3.4-4"/>',
    download: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4"/>',
    upload: '<path d="M12 21V10m0 0 4 4m-4-4-4 4M5 5v3h14V5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2"/>',
    check: '<path d="m5 12 4.2 4.2L19 6.5"/>',
    warning: '<path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  }[name] || '');

  const backupSvg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${backupIcon(name)}</svg>`;
  const backupDate = value => value ? new Date(value).toLocaleDateString('pt-BR') : '—';
  const backupTime = value => value ? new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const backupSource = source => source === 'automatic' ? 'Automático' : 'Manual';

  function backupButtonBusy(button, text) {
    if (backupBusy) return false;
    backupBusy = true;
    document.querySelector('.backup-dialog')?.setAttribute('aria-busy', 'true');
    document.querySelectorAll('.backup-dialog button').forEach(control => { control.disabled = true; });
    if (button) button.innerHTML = `<span class="backup-button-spinner" aria-hidden="true"></span>${escape(text)}`;
    return true;
  }

  function clearBackupBusy() {
    backupBusy = false;
    document.querySelector('.backup-dialog')?.removeAttribute('aria-busy');
    document.querySelectorAll('.backup-dialog button').forEach(control => { control.disabled = false; });
  }

  function replaceBackupModal(content, dialogClass = 'backup-dialog') {
    closeModal();
    const node = modal(content, dialogClass);
    const dialog = node.querySelector('.backup-dialog');
    dialog?.setAttribute('role', 'dialog');
    dialog?.setAttribute('aria-modal', 'true');
    dialog?.setAttribute('aria-label', 'Sistema de Backup');
    requestAnimationFrame(() => dialog?.querySelector('.backup-close')?.focus());
    return node;
  }

  function backupHistoryMarkup(history) {
    if (!history.length) return `<div class="backup-history-empty">${backupSvg('history')}<p>Seu histórico de backups aparecerá aqui.</p></div>`;
    return history.map(backup => `<article class="backup-history-row"><div class="backup-history-date">${backupSvg('calendar')}<span><b>${backupDate(backup.created_at)}</b><small>${backupTime(backup.created_at)}</small></span></div><span class="backup-source-badge ${backup.source === 'automatic' ? 'automatic' : 'manual'}">${escape(backupSource(backup.source))}</span><span class="backup-history-status">${backupSvg('check')}Sucesso</span><button class="backup-history-restore" data-inv-action="prepare-network-restore" data-inv-backup-id="${escape(backup.id)}" aria-label="Restaurar backup de ${backupDate(backup.created_at)} às ${backupTime(backup.created_at)}" title="Restaurar este backup">${backupSvg('history')}</button></article>`).join('');
  }

  function backupModal() {
    const meta = readBackupMeta();
    const latest = meta.history[0] || (meta.lastAt ? { created_at: meta.lastAt, source: meta.lastSource } : null);
    const latestMessage = latest ? 'Backup realizado com sucesso' : 'Nenhum backup realizado';
    const latestDetail = latest ? (latest.source === 'automatic' ? 'Backup automático' : latest.source === 'local' ? 'Backup local' : 'Backup manual') : 'Crie seu primeiro backup para proteger os dados do Inventário.';
    return replaceBackupModal(`<section class="backup-dialog-content"><header class="backup-dialog-header"><div class="backup-title-icon">${backupSvg('backup')}</div><div><h2>Sistema de Backup</h2><p>Proteção e recuperação dos dados do Inventário</p></div><button class="backup-close" data-inv-close aria-label="Fechar sistema de backup" title="Fechar">${backupSvg('close')}</button></header><section class="backup-latest" aria-labelledby="backup-latest-title"><h3 id="backup-latest-title">Último backup</h3><div class="backup-latest-grid"><div class="backup-latest-result ${latest ? 'success' : 'empty'}"><span class="backup-status-icon">${backupSvg(latest ? 'check' : 'history')}</span><span><b>${latestMessage}</b><small>${latestDetail}</small></span></div><div class="backup-latest-time">${backupSvg('calendar')}<span><b>${latest ? backupDate(latest.created_at) : '—'}</b><small>${latest ? backupTime(latest.created_at) : '—'}</small></span></div><button class="backup-automatic-status" data-inv-action="toggle-auto-backup" role="switch" aria-checked="${meta.automatic}" aria-label="${meta.automatic ? 'Desativar' : 'Ativar'} backup automático"><i></i><span><b>${meta.automatic ? 'Ativado' : 'Desativado'}</b><small>Backup automático</small></span></button></div></section><section class="backup-actions-section" aria-labelledby="backup-actions-title"><h3 id="backup-actions-title">Ações</h3><div class="backup-action-grid"><button class="backup-action-card create" data-inv-action="create-backup"><span class="backup-action-icon">${backupSvg('download')}</span><span><b>Criar Backup</b><small>Criar uma cópia completa dos dados do Inventário.</small></span></button><button class="backup-action-card restore" data-inv-action="restore-backup"><span class="backup-action-icon">${backupSvg('upload')}</span><span><b>Restaurar Backup</b><small>Selecionar um backup e recuperar os dados.</small></span></button></div></section><div class="backup-details-grid"><section class="backup-automatic-panel" aria-labelledby="backup-auto-title"><h3 id="backup-auto-title">Backup automático</h3><button class="backup-switch-row" data-inv-action="toggle-auto-backup" role="switch" aria-checked="${meta.automatic}"><span class="backup-switch ${meta.automatic ? 'enabled' : ''}"><i></i></span><span><b>Backup automático</b><small>Criar automaticamente uma cópia dos dados em intervalos definidos.</small></span></button><label class="backup-frequency"><span>Frequência</span><output>${backupSvg('calendar')}A cada 7 dias</output></label></section><section class="backup-history-panel" aria-labelledby="backup-history-title"><h3 id="backup-history-title">Histórico de backups</h3><div class="backup-history-list">${backupHistoryMarkup(meta.history)}</div></section></div><footer class="backup-dialog-footer"><div class="backup-warning">${backupSvg('warning')}<p><b>Atenção:</b> restaurar um backup substituirá todos os dados atuais do Inventário pelos dados do backup selecionado.<br>Esta ação não poderá ser desfeita.</p></div><button class="backup-secondary-button" data-inv-close>Fechar</button></footer></section>`);
  }

  function backupChoice(kind) {
    const creating = kind === 'create';
    return replaceBackupModal(`<section class="backup-dialog-content backup-choice-dialog"><header class="backup-dialog-header"><div class="backup-title-icon">${backupSvg(creating ? 'download' : 'upload')}</div><div><h2>${creating ? 'Criar Backup' : 'Restaurar Backup'}</h2><p>${creating ? 'Escolha onde deseja guardar a cópia dos dados.' : 'Escolha a origem do backup que deseja recuperar.'}</p></div><button class="backup-close" data-inv-close aria-label="Fechar">${backupSvg('close')}</button></header><div class="backup-destination-grid"><button class="backup-destination-card" data-inv-action="${creating ? 'backup-local-create' : 'backup-local-restore'}"><span>${backupSvg(creating ? 'download' : 'upload')}</span><b>Este computador</b><small>${creating ? 'Baixa um arquivo JSON para armazenamento local.' : 'Escolha um arquivo JSON salvo no computador.'}</small></button><button class="backup-destination-card network" data-inv-action="${creating ? 'backup-network-create' : 'backup-network-restore'}"><span>${backupSvg('database')}</span><b>Supabase</b><small>${creating ? 'Guarda uma cópia privada no banco de dados.' : 'Mostra as cópias privadas disponíveis no histórico.'}</small></button></div><div class="backup-choice-footer"><button class="backup-secondary-button" data-inv-action="backup-back">Voltar</button></div></section>`);
  }

  function networkRestoreSelection() {
    const history = readBackupMeta().history;
    return replaceBackupModal(`<section class="backup-dialog-content backup-restore-selection"><header class="backup-dialog-header"><div class="backup-title-icon restore-title-icon">${backupSvg('upload')}</div><div><h2>Restaurar Backup</h2><p>Selecione uma cópia privada para continuar.</p></div><button class="backup-close" data-inv-close aria-label="Fechar">${backupSvg('close')}</button></header><div class="backup-restore-list">${history.length ? history.map(backup => `<button class="backup-restore-option" data-inv-action="prepare-network-restore" data-inv-backup-id="${escape(backup.id)}"><span class="backup-restore-option-icon">${backupSvg('calendar')}</span><span><b>${backupDate(backup.created_at)} — ${backupTime(backup.created_at)}</b><small>${escape(backupSource(backup.source))}</small></span><span class="backup-restore-arrow">›</span></button>`).join('') : `<div class="backup-history-empty">${backupSvg('history')}<p>Nenhum backup privado disponível para restaurar.</p></div>`}</div><div class="backup-choice-footer"><button class="backup-secondary-button" data-inv-action="restore-backup">Voltar</button></div></section>`);
  }

  function backupRestoreConfirmation() {
    if (!pendingRestore) return;
    const tableCount = pendingRestore.snapshot?.tables?.length || 0;
    return replaceBackupModal(`<section class="backup-dialog-content backup-confirm-dialog"><header class="backup-dialog-header"><div class="backup-title-icon restore-title-icon">${backupSvg('upload')}</div><div><h2>Confirmar restauração</h2><p>${escape(pendingRestore.label)}</p></div><button class="backup-close" data-inv-close aria-label="Fechar">${backupSvg('close')}</button></header><div class="backup-confirm-summary">${backupSvg('calendar')}<span><b>${escape(pendingRestore.dateLabel)}</b><small>${tableCount} ${tableCount === 1 ? 'tabela será restaurada' : 'tabelas serão restauradas'}</small></span></div><div class="backup-confirm-warning">${backupSvg('warning')}<div><b>Atenção</b><p>A restauração substituirá os dados atuais do Inventário pelos dados do backup selecionado. Esta ação não poderá ser desfeita.</p></div></div><footer class="backup-choice-footer"><button class="backup-secondary-button" data-inv-action="restore-backup">Cancelar</button><button class="backup-critical-button" data-inv-action="confirm-backup-restore">Restaurar Backup</button></footer></section>`);
  }

  function createLocalBackup(button) {
    if (!backupButtonBusy(button, 'Criando Backup…')) return;
    const now = new Date();
    const payload = { application: 'ALDECKOT', module: 'inventario', version: 1, createdAt: now.toISOString(), data: clone(data) };
    download(JSON.stringify(payload, null, 2), `aldeckot-inventario-backup-${now.toISOString().slice(0, 10)}.json`, 'application/json');
    writeBackupMeta({ last: formattedNow(), lastAt: now.toISOString(), lastSource: 'local' });
    closeModal(); renderInventory(); alert('Backup local criado com sucesso.');
    backupBusy = false;
  }

  function restoreLocalBackup() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let payload;
        let converted;
        try {
          payload = JSON.parse(String(reader.result || ''));
          converted = normalizeImportedBackup(payload);
        } catch (error) {
          console.warn('Backup do Inventário rejeitado:', error);
          alert('Este arquivo não é um backup válido do Inventário.');
          return;
        }
        const createdAt = payload.createdAt || payload.timestamp;
        pendingRestore = { snapshot: converted.data, label: file.name, dateLabel: createdAt ? new Date(createdAt).toLocaleString('pt-BR') : 'Arquivo local selecionado', legacy: converted.legacy };
        backupRestoreConfirmation();
      };
      reader.readAsText(file);
    });
    input.click();
  }

  async function createNetworkBackup(button) {
    if (!backupButtonBusy(button, 'Criando Backup…')) return;
    try {
      const row = await backend().backups.create(clone(data), 'Backup manual do Inventário', 'network');
      const meta = readBackupMeta();
      writeBackupMeta({ last: new Date(row.created_at).toLocaleString('pt-BR'), lastAt: row.created_at, lastSource: row.source, history: [row, ...meta.history.filter(backup => backup.id !== row.id)] });
      closeModal(); renderInventory(); alert('Backup criado com sucesso.');
    } catch (error) {
      console.error('Falha ao criar backup do Inventário:', error);
      clearBackupBusy();
      alert('Não foi possível criar o backup. Verifique sua conexão e tente novamente.');
    } finally { backupBusy = false; }
  }

  function prepareNetworkRestore(backupId) {
    const backup = readBackupMeta().history.find(entry => entry.id === backupId);
    if (!backup) { alert('Este backup não está mais disponível. Atualize o Inventário e tente novamente.'); return; }
    pendingRestore = { snapshot: backup.snapshot, label: `Backup ${backupSource(backup.source).toLowerCase()}`, dateLabel: `${backupDate(backup.created_at)} — ${backupTime(backup.created_at)}`, legacy: false };
    backupRestoreConfirmation();
  }

  async function restoreSelectedBackup(button) {
    if (!pendingRestore || !backupButtonBusy(button, 'Restaurando Backup…')) return;
    try {
      await backend().inventory.replace(pendingRestore.snapshot);
      await reloadInventory();
      const restoredLegacy = pendingRestore.legacy;
      pendingRestore = null;
      closeModal(); renderInventory();
      alert(restoredLegacy ? 'Backup antigo importado e convertido com sucesso.' : 'Backup restaurado com sucesso.');
    } catch (error) {
      console.error('Falha ao restaurar backup do Inventário:', error);
      clearBackupBusy();
      alert('Não foi possível restaurar o backup. Verifique sua conexão e tente novamente.');
    } finally { backupBusy = false; }
  }

  async function toggleAutomaticBackup(button) {
    const meta = readBackupMeta();
    if (!backupButtonBusy(button, `${meta.automatic ? 'Desativando' : 'Ativando'}…`)) return;
    try {
      const setting = await backend().backups.setAutomatic(!meta.automatic);
      writeBackupMeta({ automatic: setting.automatic });
      backupBusy = false;
      backupModal();
    } catch (error) {
      console.error('Falha ao atualizar backup automático:', error);
      clearBackupBusy();
      alert('Não foi possível atualizar o backup automático. Tente novamente.');
    } finally { backupBusy = false; }
  }

  async function synchronizeModule() {
    const label = document.querySelector('.inventory-sync'); const button = document.querySelector('[data-inv-action="sync"]');
    if (!label || label.dataset.syncing === 'true') return;
    label.dataset.syncing = 'true'; label.innerHTML = 'Sincronizando… <i></i>'; button?.classList.add('is-syncing');
    try {
      // Mantém um breve retorno visual, mesmo quando a conexão responde muito rápido.
      await Promise.all([reloadInventory(), new Promise(resolve => setTimeout(resolve, 650))]);
      if (document.body.contains(label)) { label.dataset.syncing = 'false'; label.innerHTML = 'Sincronizado <i></i>'; button?.classList.remove('is-syncing'); renderInventory(); }
    } catch (error) {
      if (document.body.contains(label)) { label.dataset.syncing = 'false'; label.innerHTML = 'Falha na sincronização <i></i>'; button?.classList.remove('is-syncing'); }
      alert(backendMessage(error));
    }
  }

  async function openInventorySafely() {
    try {
      if (!initialized) renderConnectionState('Conectando ao Inventário', 'Preparando seus dados com segurança…');
      await reloadInventory();
      renderInventory();
    }
    catch (error) {
      console.error(error);
      renderConnectionState('Inventário indisponível', backendMessage(error));
    }
  }
  window.openInventory = openInventorySafely;
  document.querySelectorAll('#nav button').forEach(button => {
    if (button.textContent.includes('Inventário')) button.onclick = openInventorySafely;
  });
  window.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('#nav button');
    if (button && button.textContent.includes('Inventário')) { event.preventDefault(); event.stopImmediatePropagation(); openInventorySafely(); }
  }, true);
  document.addEventListener('click', event => {
    const nav = event.target.closest('#nav button');
    if (nav?.textContent.includes('Inventário')) { event.preventDefault(); event.stopImmediatePropagation(); openInventorySafely(); return; }
    const tableMenu = event.target.closest('[data-inv-table-menu]');
    if (tableMenu) {
      event.preventDefault(); event.stopPropagation();
      if (state.tableMenu === tableMenu.dataset.invTableMenu) { state.tableMenu = null; state.tableMenuPosition = null; }
      else {
        const rect = tableMenu.getBoundingClientRect();
        state.tableMenu = tableMenu.dataset.invTableMenu;
        state.tableMenuPosition = { top: Math.round(rect.top - 1), left: Math.min(Math.round(rect.right + 8), window.innerWidth - 72) };
      }
      renderInventory(); return;
    }
    const chosen = event.target.closest('[data-inv-table]'); if (chosen && !event.target.closest('[data-inv-edit-table],[data-inv-delete-table],[data-inv-table-menu]')) { state.active = chosen.dataset.invTable; state.query = ''; state.status = ''; state.situation = ''; state.sidebarOpen = false; state.tableMenu = null; state.tableMenuPosition = null; renderInventory(); return; }
    const editTable = event.target.closest('[data-inv-edit-table]'); if (editTable) { event.stopPropagation(); state.tableMenu = null; state.tableMenuPosition = null; document.querySelector('.inventory-table-actions-popover')?.remove(); tableForm(data.tables.find(table => table.id === editTable.dataset.invEditTable)); return; }
    const deleteTable = event.target.closest('[data-inv-delete-table]'); if (deleteTable) {
      state.tableMenu = null; state.tableMenuPosition = null; document.querySelector('.inventory-table-actions-popover')?.remove();
      if (confirm('Excluir esta tabela e todos os seus itens?')) {
        backend().inventory.deleteTable(deleteTable.dataset.invDeleteTable).then(async () => {
          if (state.active === deleteTable.dataset.invDeleteTable) state.active = null;
          await reloadInventory(); closeModal(); renderInventory();
        }).catch(error => alert(backendMessage(error)));
      }
      return;
    }
    const action = event.target.closest('[data-inv-action]');
    if (action) {
      const type = action.dataset.invAction;
      if (type === 'toggle-tables') { state.sidebarOpen = !state.sidebarOpen; state.tableMenu = null; state.tableMenuPosition = null; renderInventory(); }
      if (type === 'add-table') tableForm();
      if (type === 'add-item') itemForm();
      if (type === 'edit-active-table') tableForm(activeTable());
      if (type === 'delete-active-table') {
        const table = activeTable();
        if (table && confirm(`Excluir a tabela “${table.name}” e todos os seus itens?`)) {
          backend().inventory.deleteTable(table.id).then(async () => {
            state.active = null; await reloadInventory(); renderInventory();
          }).catch(error => alert(backendMessage(error)));
        }
      }
      if (type === 'add-log') { const item = activeTable()?.items.find(entry => entry.id === action.dataset.invLogItem); if (item) { closeModal(); logForm(item); } }
      if (type === 'edit-log') {
        const item = activeTable()?.items.find(entry => entry.id === action.dataset.invLogItem);
        const logEntry = item?.logs?.find(entry => entry.id === action.dataset.invLogId);
        if (item && logEntry) { closeModal(); logForm(item, logEntry); }
      }
      if (type === 'delete-log') {
        const itemId = action.dataset.invLogItem;
        if (confirm('Excluir este registro do histórico?')) {
          backend().inventory.deleteLog(action.dataset.invLogId).then(async () => {
            await reloadInventory(); closeModal(); const item = activeTable()?.items.find(entry => entry.id === itemId); if (item) details(item);
          }).catch(error => alert(backendMessage(error)));
        }
      }
      if (type === 'export-pdf') exportPdf();
      if (type === 'backup') backupModal();
      if (type === 'create-backup') backupChoice('create');
      if (type === 'restore-backup') backupChoice('restore');
      if (type === 'backup-local-create') createLocalBackup(action);
      if (type === 'backup-local-restore') restoreLocalBackup();
      if (type === 'backup-network-create') createNetworkBackup(action);
      if (type === 'backup-network-restore') networkRestoreSelection();
      if (type === 'prepare-network-restore') prepareNetworkRestore(action.dataset.invBackupId);
      if (type === 'confirm-backup-restore') restoreSelectedBackup(action);
      if (type === 'toggle-auto-backup') toggleAutomaticBackup(action);
      if (type === 'backup-back') backupModal();
      if (type === 'sync') synchronizeModule();
      if (type === 'retry') openInventorySafely();
      if (type === 'home') window.location.href = 'index.html';
      return;
    }
    const row = event.target.closest('[data-inv-item]'); if (row) { details(activeTable().items.find(item => item.id === row.dataset.invItem)); return; }
    if (event.target.closest('[data-inv-close]')) { closeModal(); return; }
    const editItem = event.target.closest('[data-inv-edit-item]'); if (editItem) { const item = activeTable().items.find(entry => entry.id === editItem.dataset.invEditItem); closeModal(); itemForm(item); return; }
    const deleteItem = event.target.closest('[data-inv-delete-item]'); if (deleteItem && confirm('Excluir este equipamento?')) {
      backend().inventory.deleteItem(deleteItem.dataset.invDeleteItem).then(async () => { await reloadInventory(); closeModal(); renderInventory(); }).catch(error => alert(backendMessage(error)));
    }
  }, true);
  document.addEventListener('input', event => { if (event.target.matches('[data-inv-search]')) { const value = event.target.value; state.query = value; renderInventory(); const search = $('[data-inv-search]'); search.focus(); search.setSelectionRange(value.length, value.length); } });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-inv-status-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('status', event.target.value));
    if (event.target.matches('[data-inv-situation-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('situation', event.target.value));
    if (event.target.matches('[data-inv-status]')) { state.status = event.target.value; renderInventory(); }
    if (event.target.matches('[data-inv-situation]')) { state.situation = event.target.value; renderInventory(); }
  });
  document.addEventListener('submit', event => {
    if (event.target.matches('[data-inv-table-form]')) {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target)); const modalNode = document.querySelector('.inv-modal'); const id = modalNode.dataset.tableId;
      const request = id ? backend().inventory.updateTable(id, values) : backend().inventory.createTable(values);
      request.then(async table => { state.active = table.id; state.sidebarOpen = false; await reloadInventory(); closeModal(); renderInventory(); }).catch(error => alert(backendMessage(error)));
    }
    if (event.target.matches('[data-inv-item-form]')) { event.preventDefault(); saveItem(event.target); }
    if (event.target.matches('[data-inv-log-form]')) {
      event.preventDefault();
      const modalNode = document.querySelector('.inv-modal'); const itemId = modalNode.dataset.itemId; const logId = modalNode.dataset.logId; const message = String(new FormData(event.target).get('message') || '').trim();
      if (!message) return;
      const request = logId ? backend().inventory.updateLog(logId, message) : backend().inventory.addLog(itemId, message);
      request.then(async () => {
        await reloadInventory(); closeModal(); const item = activeTable()?.items.find(entry => entry.id === itemId); if (item) details(item);
      }).catch(error => alert(backendMessage(error)));
    }
  });
})();
