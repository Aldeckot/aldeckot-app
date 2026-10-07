(() => {
  const app = document.getElementById('suppliesApp');
  const dialogLayer = document.getElementById('suppliesDialog');
  const toastNode = document.getElementById('suppliesToast');
  const api = window.AldeckotSupplies;
  const inventoryCatalog = window.AldeckotInventorySupplies;
  const params = new URLSearchParams(location.search);
  const state = {
    items: [], detail: null, detailError: '', selectedId: params.get('item'), activeTab: params.get('unit') ? 'units' : 'general',
    query: '', status: '', location: '', page: 1, selectedVariantId: null,
    equipment: [], images: new Map(), busy: false, error: '', dialog: '', renderVersion: 0,
    ensuredGroups: new Set(), catalogUnavailable: false, catalogPromise: null,
    variantFormOpen: false, integrationReady: null
  };
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fmtDate = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const canEdit = () => Boolean(window.AldeckotAuth?.isAdmin) && !state.error;
  const active = () => state.items.find(row => row.id === state.selectedId);
  const isInventory = item => item?.source === 'inventory';
  const statusTone = status => ({ 'Normal': 'normal', 'Estoque baixo': 'low', 'Sem estoque': 'none', 'Inativo': 'inactive',
    'Em estoque': 'normal', 'Instalado': 'installed', 'Ativo': 'normal', 'Reserva': 'reserve',
    'Manutenção': 'maintenance', 'Defeito': 'defect', 'Inativo': 'inactive', 'Troca': 'inactive', 'Atenção': 'attention' })[status] || 'inactive';
  const badge = status => `<span class="sp-badge ${statusTone(status)}">${safe(status)}</span>`;
  const imagePlaceholder = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="6" width="24" height="20" rx="3"/><circle cx="11" cy="12" r="2"/><path d="m5 22 7-7 5 5 4-4 6 6"/></svg>';
  const img = (path, className = 'sp-thumb') => `<span class="${className}"${path ? ` data-supply-image="${safe(path)}"` : ''}>${imagePlaceholder}</span>`;
  const notify = (message, error = false) => {
    toastNode.textContent = message;
    toastNode.style.borderColor = error ? '#ff5a72' : '';
    toastNode.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toastNode.classList.remove('show'), 4500);
  };
  const equipmentFor = unit => state.equipment.find(row => row.source === 'inventory' && row.id === unit.installed_inventory_item_id)
    || state.equipment.find(row => row.source === 'management' && row.id === unit.installed_management_record_id);
  const equipmentLink = row => {
    if (!row) return '—';
    const url = row.source === 'inventory'
      ? `inventory.html?table=${encodeURIComponent(row.tableId || '')}&item=${encodeURIComponent(row.id)}`
      : `management.html?item=${encodeURIComponent(row.id)}`;
    return `<a href="${url}" title="Abrir em ${row.source === 'inventory' ? 'Inventário' : 'Gestão TI'}">${safe(row.name)}${row.tag ? ` · ${safe(row.tag)}` : ''}</a>`;
  };
  const quantityAvailable = row => Number(row.available_stock || 0);
  const isBelowMinimum = row => quantityAvailable(row) < Number(row.minimum_stock || 0);
  const stockTone = row => {
    const available = quantityAvailable(row);
    const minimum = Math.max(0, Number(row.minimum_stock || 0));
    if (available === 0 || available < minimum) return { className: 'below', label: available === 0 ? 'Sem estoque' : 'Abaixo do mínimo' };
    if (minimum > 0 && available <= minimum + Math.max(1, Math.ceil(minimum * .2))) return { className: 'near', label: 'Próximo do mínimo' };
    return { className: 'above', label: 'Acima do mínimo' };
  };
  const inventoryField = (row, field, multipleLabel) => {
    if (!isInventory(row)) return row[field] || '—';
    const values = [...new Set(row.inventory_group.variants.map(variant => String(variant[field] || '').trim()).filter(Boolean))];
    return values.length === 1 ? values[0] : values.length ? multipleLabel : '—';
  };
  const filtered = () => state.items.filter(row => {
    const haystack = [row.name,row.category,row.brand,row.model,
      ...(isInventory(row) ? row.inventory_group.variants.flatMap(variant => [variant.brand, variant.model]) : [])]
      .join(' ').toLocaleLowerCase('pt-BR');
    return haystack.includes(state.query.toLocaleLowerCase('pt-BR'))
      && (!state.status || row.stock_status === state.status)
      && (!state.location || row.default_location === state.location);
  });
  const metricIcons = {
    total: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m4 10 7-4 7 4-7 4-7-4Zm0 0v8l7 4 7-4v-8m-7 4v8M16 19l6-3 6 3-6 3-6-3Zm0 0v7l6 3 6-3v-7m-6 3v7"/></svg>',
    stock: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 14h26v13H3V14Zm2-8h22l2 8H3l2-8Zm7 14h8m-7-6 3-4 3 4"/></svg>',
    warning: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 30 28H2L16 3Zm0 9v8m0 4v1"/></svg>',
    empty: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m4 10 12-7 12 7-12 7-12-7Zm0 0v13l12 7 12-7V10M16 17v13M11 22h10"/></svg>'
  };
  const metric = (icon, label, number, type = '', action = '') => `<${action ? 'button' : 'article'} class="sp-metric ${type}"${action ? ` type="button" data-sp-action="${action}" aria-label="Ver itens abaixo do mínimo"` : ''}><span class="sp-metric-icon">${metricIcons[icon]}</span><span><small>${label}</small><b>${number.toLocaleString('pt-BR')}</b></span></${action ? 'button' : 'article'}>`;
  const metrics = () => {
    const operational = state.items.filter(row => !row.inactive);
    const available = operational.reduce((sum, row) => sum + quantityAvailable(row), 0);
    const belowMinimum = operational.filter(isBelowMinimum).length;
    return `<section class="sp-metrics" aria-label="Indicadores">${metric('total','Total de itens',operational.length)}${metric('stock','Em estoque',available)}${metric('warning','Abaixo do mínimo',belowMinimum,belowMinimum ? 'warn has-alert' : 'warn','below-minimum')}${metric('empty','Sem estoque',operational.filter(row => row.stock_status === 'Sem estoque').length,'empty')}</section>`;
  };
  const options = values => values.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join('');
  const renderTable = () => {
    const rows = filtered();
    const max = Math.max(1, Math.ceil(rows.length / 10));
    if (state.page > max) state.page = max;
    const pageRows = rows.slice((state.page - 1) * 10, state.page * 10);
    return `${metrics()}<div class="sp-toolbar"><label class="sp-search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/></svg><input class="sp-search" data-sp-search type="search" placeholder="Buscar por nome, categoria, marca, modelo..." value="${safe(state.query)}" aria-label="Buscar suprimentos"></label>${canEdit() ? '<button class="sp-btn primary sp-toolbar-add" data-sp-action="add" type="button">＋ Adicionar</button>' : ''}<select data-sp-filter="status" aria-label="Filtrar status"><option value="">Todos os status</option>${options(['Normal','Estoque baixo','Sem estoque','Inativo'])}</select></div>
    <div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Imagem</th><th>Nome do item</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Estoque</th><th>Mínimo</th><th>Indicador</th><th>Status</th></tr></thead><tbody>${pageRows.length ? pageRows.map(row => {
      const tone = stockTone(row);
      return `<tr data-supply-id="${safe(row.id)}" class="${row.id === state.selectedId ? 'selected' : ''}"><td>${img(row.image_path)}</td><td><button type="button" class="sp-item-open" data-sp-open="${safe(row.id)}" aria-label="Abrir ${safe(row.name)}">${safe(row.name)}</button><br><small class="sp-muted">${isInventory(row) ? `${row.total_units} equipamentos no Inventário` : row.tracking_type === 'unit' ? `${row.total_units} unidades cadastradas` : 'Por quantidade'}</small></td><td>${safe(row.category)}</td><td>${safe(inventoryField(row, 'brand', 'Várias marcas'))}</td><td>${safe(inventoryField(row, 'model', 'Vários modelos'))}</td><td class="sp-stock sp-stock-${tone.className}" title="${tone.label}">${quantityAvailable(row)}</td><td>${row.minimum_stock}</td><td>${isInventory(row) ? row.active_count : '—'}</td><td>${badge(row.stock_status)}</td></tr>`;
    }).join('') : '<tr><td colspan="9" class="sp-empty">Nenhum suprimento encontrado. Os indicadores e a tabela mostram somente dados reais.</td></tr>'}</tbody></table></div>
    <div class="sp-pagination"><span>Mostrando ${pageRows.length ? (state.page - 1) * 10 + 1 : 0} a ${Math.min(state.page * 10, rows.length)} de ${rows.length} itens</span><nav class="sp-pages" aria-label="Páginas"><button data-sp-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>‹</button>${Array.from({length: Math.min(max, 7)}, (_, index) => index + 1).map(page => `<button data-sp-page="${page}" class="${state.page === page ? 'active' : ''}">${page}</button>`).join('')}${max > 7 ? `<span>… ${max}</span>` : ''}<button data-sp-page="${state.page + 1}" ${state.page === max ? 'disabled' : ''}>›</button></nav></div>`;
  };
  const renderGeneral = item => isInventory(item)
    ? `<div class="sp-fields"><div><span>Fonte dos equipamentos</span><strong>Inventário</strong></div><div><span>Total de unidades</span><strong>${item.total_units}</strong></div><div><span>Em Reserva (Estoque)</span><strong>${item.available_stock}</strong></div><div><span>Ativos (Indicador)</span><strong>${item.active_count}</strong></div><div><span>Em manutenção</span><strong>${item.inventory_group.maintenance}</strong></div><div><span>Inativos</span><strong>${item.inventory_group.inactive}</strong></div><div><span>Com defeito</span><strong>${item.inventory_group.defect}</strong></div><div><span>Estoque mínimo</span><strong>${item.minimum_stock}</strong></div><div><span>Variações por modelo</span><strong>${item.inventory_group.variants.length}</strong></div></div><p class="sp-muted">Os quantitativos são calculados diretamente dos registros físicos do Inventário. TAG, série, local e histórico permanecem em cada unidade.</p>`
    : `<div class="sp-fields"><div><span>Descrição</span><strong>${safe(item.description || '—')}</strong></div><div><span>Tipo de controle</span><strong>${item.tracking_type === 'unit' ? 'Unidades rastreáveis' : 'Por quantidade'}</strong></div><div><span>Disponível</span><strong>${quantityAvailable(item)}</strong></div><div><span>Unidades cadastradas</span><strong>${item.tracking_type === 'unit' ? item.total_units : '—'}</strong></div><div><span>Estoque mínimo</span><strong>${item.minimum_stock}</strong></div><div><span>Local padrão</span><strong>${safe(item.default_location)}</strong></div><div><span>Observações</span><strong>${safe(item.notes || '—')}</strong></div></div>${canEdit() && item.tracking_type === 'quantity' && !item.inactive ? '<div class="sp-card-actions"><button class="sp-btn primary" data-sp-action="adjust">Movimentar estoque</button></div>' : ''}`;
  const renderVariants = item => {
    if (isInventory(item)) {
      const variants = item.inventory_group.variants;
      return `<div class="sp-section-title"><h3>Modelos do Inventário · ${variants.length}</h3></div>${variants.map(row => `<button type="button" class="sp-card sp-inventory-variant" data-sp-variant="${safe(row.id)}">${img(row.image_path || item.image_path)}<span><b>${safe(row.name)}</b><small>${safe(row.brand || 'Marca não informada')} · ${row.total} unidade(s)</small>${row.inactive || row.defect ? `<small>Inativos: ${row.inactive} · Defeito: ${row.defect}</small>` : ''}</span><span><small>Ativos</small><strong>${row.active}</strong></span><span><small>Reserva</small><strong>${row.reserve}</strong></span><span><small>Manutenção</small><strong>${row.maintenance}</strong></span></button>`).join('') || '<p class="sp-muted">Nenhum modelo encontrado no Inventário.</p>'}`;
    }
    const variants = state.detail?.variants || [];
    const title = item.category.toLocaleLowerCase('pt-BR').includes('cabo') ? 'Variações por tipo de conector' : 'Variações por tipo/modelo';
    const cards = variants.length ? variants.map(row => `<article class="sp-card sp-variant-card"><div class="sp-variant-row">
      ${img(row.image_path || item.image_path)}<div class="sp-variant-copy"><b>${safe(row.name)}</b>${row.inactive ? badge('Inativa') : ''}<small>${safe(row.description || row.location || item.default_location)}</small></div>
      <div class="sp-variant-value"><small>Estoque</small><strong>${item.tracking_type === 'unit' ? (state.detail?.units || []).filter(unit => unit.variant_id === row.id && unit.status === 'Em estoque').length : row.quantity_stock}</strong></div>
      <div class="sp-variant-value"><small>Mínimo</small><strong class="${row.minimum_stock ? 'sp-minimum' : ''}">${row.minimum_stock}</strong></div></div>
      ${canEdit() ? `<details class="sp-variant-menu"><summary aria-label="Ações de ${safe(row.name)}">•••</summary><div class="sp-variant-menu-list"><button data-sp-action="variant-edit" data-id="${row.id}">Editar</button>${state.integrationReady ? `<button data-sp-action="variant-active" data-id="${row.id}">${row.inactive ? 'Reativar' : 'Inativar'} variação</button>` : ''}${item.tracking_type === 'quantity' && !row.inactive ? `<button data-sp-action="adjust" data-id="${row.id}">Movimentar estoque</button>` : ''}</div></details>` : ''}
    </article>`).join('') : '<p class="sp-muted">Nenhuma variação cadastrada.</p>';
    const form = canEdit() && state.variantFormOpen ? `<form id="spInlineVariantForm" class="sp-variant-form"><h3>Adicionar nova variação</h3>
      <div class="sp-variant-form-grid">
      <div class="sp-variant-form-fields"><label>Tipo / modelo / conector<input name="name" placeholder="Ex.: IEC C13" required maxlength="120"></label>
      <div class="sp-variant-form-numbers">${item.tracking_type === 'quantity' ? '<label>Estoque inicial<input name="initial_stock" type="number" min="0" value="0" required></label>' : ''}<label>Estoque mínimo<input name="minimum_stock" type="number" min="0" value="0" required></label></div>
      <button class="sp-btn primary" type="submit">＋ Adicionar variação</button><button class="sp-btn" type="button" data-sp-action="variant-cancel">Cancelar</button></div></div><p class="sp-error" role="alert"></p></form>` : '';
    return `<div class="sp-section-title"><h3>${title}</h3>${canEdit() && !state.variantFormOpen ? '<button class="sp-btn primary" data-sp-action="variant-focus">＋ Adicionar variação</button>' : ''}</div>${cards}${form}`;
  };
  const renderUnits = item => {
    if (isInventory(item)) {
      const group = item.inventory_group;
      const variant = group.variants.find(row => row.id === state.selectedVariantId);
      const units = (variant ? variant.units : group.units).filter(unit => !state.unitStatus || unit.status === state.unitStatus);
      return `<div class="sp-section-title"><h3>${variant ? `${safe(variant.brand)} ${safe(variant.name)}` : 'Todas as unidades'} · ${units.length}</h3>${variant ? '<button type="button" class="sp-btn" data-sp-action="all-units">Todas as unidades</button>' : ''}</div><select data-sp-filter="unit-status" aria-label="Filtrar unidades por status"><option value="">Todos os status</option>${options(['Ativo','Reserva','Manutenção','Inativo','Defeito','Atenção'])}</select><div class="sp-inventory-units">${units.map(unit => `<article class="sp-card" id="unit-${safe(unit.id)}"><div class="sp-card-row"><div><b>${safe(unit.tag || unit.serial || unit.equipment)}</b><small>${safe(unit.equipment)} · ${safe(unit.brand)} ${safe(unit.model)}</small><small>Nº série: ${safe(unit.serial || '—')} · Setor: ${safe(unit.sector || '—')}</small><small>Local: ${safe(unit.location || '—')}</small></div>${badge(unit.status)}</div><div class="sp-card-actions"><a class="sp-btn" href="inventory.html?table=${encodeURIComponent(unit.table_id)}&item=${encodeURIComponent(unit.id)}">Abrir no Inventário</a><button type="button" class="sp-btn" data-sp-action="inventory-history" data-id="${safe(unit.id)}">Histórico</button></div></article>`).join('') || '<p class="sp-muted">Nenhuma unidade para este modelo ou filtro.</p>'}</div>`;
    }
    const units = state.detail?.units || [];
    const unitFilter = state.unitStatus || '';
    return `<div class="sp-section-title"><h3>Unidades rastreáveis · ${units.length}</h3>${canEdit() ? '<button class="sp-btn primary" data-sp-action="unit">＋ Adicionar unidade</button>' : ''}</div><select data-sp-filter="unit-status" aria-label="Filtrar unidades por status"><option value="">Todos os status</option>${options(['Em estoque','Instalado','Reserva','Manutenção','Defeito','Inativo'])}</select><div style="margin-top:9px">${units.filter(unit => !unitFilter || unit.status === unitFilter).map(unit => {
      const equipment = equipmentFor(unit);
      const order = (state.detail?.maintenance || []).find(link => link.supply_unit_id === unit.id && !link.closed_at);
      return `<article class="sp-card" id="unit-${unit.id}"><div class="sp-card-row"><div><b>${safe(unit.code)}</b><small>Série: ${safe(unit.serial_number || '—')} · Local: ${safe(unit.physical_location)}</small><small>Instalado em: ${equipmentLink(equipment)}</small><small>Atualizado em: ${fmtDate(unit.updated_at)}</small></div>${badge(unit.status)}</div>${order ? `<small>Controle TI: <a href="control.html?table=${order.control_items?.table_id || ''}&item=${order.control_item_id}">${safe(order.status)} · abrir manutenção</a></small>` : ''}${canEdit() ? `<div class="sp-card-actions">${unit.status !== 'Instalado' && unit.status !== 'Manutenção' && unit.status !== 'Inativo' ? `<button class="sp-btn primary" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Instalado">Instalar</button>` : ''}${unit.status === 'Instalado' ? `<button class="sp-btn" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Em estoque">Remover</button><button class="sp-btn" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Instalado">Transferir</button><button class="sp-btn" data-sp-action="replace" data-id="${unit.id}">Substituir</button>` : ''}${unit.status !== 'Manutenção' && unit.status !== 'Inativo' ? `<button class="sp-btn" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Manutenção">Manutenção</button>` : ''}${unit.status !== 'Manutenção' ? `<button class="sp-btn" data-sp-action="unit-status" data-id="${unit.id}">${unit.status === 'Inativo' ? 'Reativar' : 'Outros estados'}</button>` : ''}<button class="sp-btn" data-sp-action="unit-edit" data-id="${unit.id}">Editar</button><button class="sp-btn" data-sp-action="unit-history" data-id="${unit.id}">Histórico</button></div>` : ''}</article>`;
    }).join('') || '<p class="sp-muted">Nenhuma unidade para este filtro.</p>'}</div>`;
  };
  const renderTimeline = type => {
    const rows = type === 'movements' ? state.detail?.movements || [] : state.detail?.logs || [];
    return `<div class="sp-section-title"><h3>${type === 'movements' ? 'Movimentações' : 'Logs'}</h3></div>${rows.length ? rows.map(row => `<article class="sp-log"><time>${fmtDate(row.created_at)} · ${safe(row.actor_name || 'Equipe ALDECKOT')}</time><b>${safe(type === 'movements' ? row.type : row.action)}${row.supply_unit_id ? ` · ${safe((state.detail?.units || []).find(unit => unit.id === row.supply_unit_id)?.code || '')}` : ''}</b><p>${safe(type === 'movements' ? `${row.origin || '—'} → ${row.destination || '—'} · ${row.previous_stock} → ${row.new_stock} disponíveis · ${row.reason}` : `${row.old_value ? `${row.old_value} → ` : ''}${row.new_value || ''}${row.details ? ` · ${row.details}` : ''}`)}</p></article>`).join('') : '<p class="sp-muted">Nenhum evento registrado.</p>'}`;
  };
  const renderCompatibility = item => `<div class="sp-fields"><div><span>Categoria de componente</span><strong>${safe(item.category)}</strong></div><div><span>Equipamentos vinculáveis</span><strong>Inventário e Gestão TI</strong></div></div><p class="sp-muted">Na substituição, somente componentes da mesma categoria são aceitos. A instalação usa o ID real do equipamento selecionado.</p>`;
  const renderDetail = () => {
    const item = active();
    if (!item) return '<aside class="sp-detail" tabindex="0" aria-label="Detalhes do suprimento"><div class="sp-empty">Selecione um suprimento na tabela para ver seus detalhes.</div></aside>';
    const inventory = isInventory(item);
    const tabs = inventory ? [['general','Geral'],['variants','Variações'],['units','Unidades']]
      : [['general','Geral'],['variants','Variações'],...(item.tracking_type === 'unit' ? [['units','Unidades']] : []),['movements','Movimentações'],['compatibility','Compatibilidade'],['logs','Logs']];
    const body = state.activeTab === 'variants' ? renderVariants(item) : state.activeTab === 'units' && (item.tracking_type === 'unit' || inventory) ? renderUnits(item)
      : state.activeTab === 'movements' || state.activeTab === 'logs' ? renderTimeline(state.activeTab)
      : state.activeTab === 'compatibility' ? renderCompatibility(item) : renderGeneral(item);
    const detailFields = inventory
      ? `<div class="sp-detail-fields"><span>Fonte</span><b>Inventário</b><span>Total</span><b>${item.total_units} unidades</b><span>Estoque</span><b class="sp-stock">${item.available_stock} em Reserva</b><span>Indicador</span><b>${item.active_count} Ativos</b><span>Mínimo</span><b>${item.minimum_stock}</b></div>`
      : `<div class="sp-detail-fields"><span>Categoria</span><b>${safe(item.category)}</b><span>Marca</span><b>${safe(item.brand || '—')}</b><span>Modelo</span><b>${safe(item.model || '—')}</b><span>Estoque</span><b class="sp-stock">${quantityAvailable(item)} disponíveis</b><span>Estoque mínimo</span><b>${item.minimum_stock}</b><span>Local padrão</span><b>${safe(item.default_location)}</b></div>`;
    return `<aside class="sp-detail" tabindex="0" aria-label="Detalhes de ${safe(item.name)}"><div class="sp-detail-top"><div>${img(item.image_path,'sp-main-image')}</div><div><div class="sp-detail-title"><h2>${safe(item.name)}</h2>${canEdit() ? `<details class="sp-variant-menu sp-detail-menu"><summary aria-label="Ações de ${safe(item.name)}">•••</summary><div class="sp-variant-menu-list"><button data-sp-action="edit">Editar</button>${inventory ? '' : `<button data-sp-action="active">${item.inactive ? 'Reativar' : 'Inativar'} suprimento</button>${state.integrationReady ? '<button data-sp-action="delete">Excluir</button>' : ''}`}</div></details>` : ''}<button class="sp-icon-btn" data-sp-action="close" aria-label="Fechar painel">×</button></div>${badge(item.stock_status)}${detailFields}</div></div><nav class="sp-detail-tabs" aria-label="Abas do suprimento">${tabs.map(([id,label]) => `<button data-sp-tab="${id}" class="${state.activeTab === id ? 'active' : ''}">${label}</button>`).join('')}</nav><div class="sp-detail-body">${state.detail ? body : state.detailError ? `<p class="sp-error" role="alert">${safe(state.detailError)}</p>` : '<p class="sp-muted aldeckot-inline-loading" role="status">Carregando detalhes…</p>'}</div></aside>`;
  };
  const renderHeader = () => `<header class="sp-header">
    <div class="sp-heading module-header-summary">
      <div class="module-header-summary-copy"><h1 class="module-header-summary-title">Suprimentos</h1><p class="module-header-summary-description">Controle de estoque de materiais e consumíveis de TI.</p><div class="module-header-summary-tags"><span>Estoque</span><span>Componentes</span><span>Manutenção</span></div></div>
      <span class="module-header-summary-art supplies" aria-hidden="true"></span>
    </div>
    <div class="sp-header-actions" role="toolbar" aria-label="Ações de Suprimentos">
      <button class="sp-header-action sp-export-action" type="button" data-sp-action="export" title="Exportar em PDF" aria-label="Exportar em PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h4M8.5 14.5h1.2a1.2 1.2 0 0 0 0-2.4H8.5v4.8M12 16.9v-4.8h1.1a2.4 2.4 0 1 1 0 4.8H12ZM16.3 16.9v-4.8h2.5M16.3 14.5h2"/></svg></button>
      <button class="sp-header-action sp-backup-action" type="button" data-sp-action="backup" title="Sistema de backup" aria-label="Sistema de backup"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="10.5" cy="5" rx="5.5" ry="2.5"/><path d="M5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.1 0 2.1-.1 3-.4M16 5v5M5 10c0 1.4 2.5 2.5 5.5 2.5S16 11.4 16 10M16.2 17.5l1.8 1.8 3.4-4"/></svg></button>
      <a class="system-header-brand" href="index.html" aria-label="Voltar para a Home do Aldeckot"><span class="system-header-brand-mark" aria-hidden="true"><img class="official-logo-image" src="assets/aldeckot-logo.svg" alt=""></span><span class="system-header-brand-copy"><b>Aldeckot</b></span></a>
    </div>
  </header>`;
  const render = () => {
    const mainScroll = app.querySelector('.sp-main')?.scrollTop || 0;
    const detailScroll = app.querySelector('.sp-detail')?.scrollTop || 0;
    app.innerHTML = `${renderHeader()}${state.error ? `<div class="sp-alert" role="alert">${safe(state.error)}</div>` : ''}${state.integrationReady === false ? '<div class="sp-alert" role="status">A integração estrutural aguarda a migração 061 no Supabase. As novas ações de inativação de variação e exclusão ficam indisponíveis até a ativação.</div>' : ''}<div class="sp-layout"><section class="sp-main" tabindex="0" aria-label="Lista de suprimentos">${renderTable()}</section>${renderDetail()}</div>`;
    app.querySelector('[data-sp-filter="status"]').value = state.status;
    const unitFilter = app.querySelector('[data-sp-filter="unit-status"]');
    if (unitFilter) unitFilter.value = state.unitStatus || '';
    app.querySelector('.sp-main').scrollTop = mainScroll;
    app.querySelector('.sp-detail').scrollTop = detailScroll;
    hydrateImages(app);
  };
  const hydrateImages = root => {
    root.querySelectorAll('[data-supply-image]').forEach(async node => {
      const path = node.dataset.supplyImage;
      if (!path) return;
      try {
        let url = state.images.get(path);
        if (!url) { url = await api.imageUrl(path); state.images.set(path, url); }
        if (node.isConnected && url) node.innerHTML = `<img src="${safe(url)}" alt="Imagem do suprimento">`;
      } catch { if (node.isConnected) node.innerHTML = imagePlaceholder; }
    });
  };
  const load = async () => {
    state.error = '';
    try {
      let [manual, snapshot, integrationReady] = await Promise.all([api.list(), api.inventorySnapshot(), api.integrationReady()]);
      state.integrationReady = integrationReady;
      const groups = inventoryCatalog.groupInventory(snapshot.tables, snapshot.items);
      let projected = inventoryCatalog.project(manual, groups);
      if (canEdit() && !state.catalogUnavailable && groups.some(group => !state.ensuredGroups.has(group.key))) {
        if (!state.catalogPromise) {
          const pending = projected.filter(row => isInventory(row) && !state.ensuredGroups.has(row.inventory_group.key))
            .map(row => ({ key: row.inventory_group.key, name: row.inventory_group.name, existingId: row.manual_id }));
          state.catalogPromise = api.ensureInventoryCatalog(pending).finally(() => { state.catalogPromise = null; });
        }
        const available = await state.catalogPromise;
        if (available) {
          groups.forEach(group => state.ensuredGroups.add(group.key));
          manual = await api.list();
          projected = inventoryCatalog.project(manual, groups);
        } else state.catalogUnavailable = true;
      }
      state.items = projected;
      if (state.selectedId && !active()) { state.selectedId = null; state.detail = null; }
      render();
      if (state.selectedId) await loadDetail();
    } catch (error) {
      state.error = /supply_stock_summary|supplies|supply_units/i.test(error.message || '')
        ? 'A estrutura de Suprimentos ainda não está disponível no Supabase. Aplique supabase/058_supplies.sql para ativar o módulo.'
        : error.message || 'Não foi possível carregar Suprimentos.';
      state.items = []; render();
    }
  };
  const loadDetail = async () => {
    const id = state.selectedId;
    if (!id) return;
    const version = ++state.renderVersion;
    state.detail = null; state.detailError = ''; render();
    try {
      const item = active();
      const detail = isInventory(item)
        ? { variants: item.inventory_group.variants, units: item.inventory_group.units, movements: [], logs: [], maintenance: [] }
        : await api.detail(id);
      if (version !== state.renderVersion || id !== state.selectedId) return;
      state.detail = detail;
      render();
      const unitId = params.get('unit');
      if (unitId) document.getElementById(`unit-${unitId}`)?.scrollIntoView({ block: 'center' });
    } catch (error) {
      if (version !== state.renderVersion || id !== state.selectedId) return;
      state.detailError = 'Não foi possível carregar os detalhes. Selecione o item novamente para tentar de novo.';
      render();
      notify(error.message || 'Falha ao abrir suprimento.', true);
    }
  };
  const refresh = async () => { await load(); };
  const select = async id => {
    if (id === state.selectedId) { if (state.detailError) await loadDetail(); return; }
    state.selectedId = id; state.activeTab = isInventory(state.items.find(row => row.id === id)) ? 'variants' : 'general';
    state.unitStatus = ''; state.selectedVariantId = null; state.variantFormOpen = false;
    history.replaceState(null, '', id ? `supplies.html?item=${encodeURIComponent(id)}` : 'supplies.html');
    await loadDetail();
  };
  const showDialog = (title, body, onSubmit, wide = false) => {
    state.onSubmit = onSubmit;
    dialogLayer.hidden = false;
    dialogLayer.innerHTML = `<section class="sp-dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${safe(title)}"><header><h2>${safe(title)}</h2><button class="sp-icon-btn" type="button" data-sp-dialog-close aria-label="Fechar">×</button></header><form id="spActionForm">${body}<p class="sp-error" role="alert"></p><footer class="sp-dialog-footer"><button class="sp-btn" type="button" data-sp-dialog-close>Cancelar</button><button class="sp-btn primary" type="submit">Confirmar</button></footer></form></section>`;
    dialogLayer.querySelector('input:not([type=hidden]), select, textarea')?.focus();
  };
  const closeDialog = () => {
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    dialogLayer.hidden = true; dialogLayer.innerHTML = ''; state.onSubmit = null;
  };
  const field = (label, name, value = '', extra = '') => `<label>${safe(label)}<input name="${name}" value="${safe(value)}" ${extra}></label>`;
  const textArea = (label, name, value = '') => `<label class="full">${safe(label)}<textarea name="${name}">${safe(value)}</textarea></label>`;
  const imageFields = row => `<div class="sp-image-editor"><span>Imagem</span>${img(row.image_path,'sp-edit-image')}<label>Adicionar ou substituir<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>${row.image_path ? '<label><input type="checkbox" name="remove_image" value="1"> Remover imagem atual</label>' : ''}<div data-sp-preview></div><small>PNG, JPG ou WebP até 5 MB. As variações herdam a imagem principal.</small></div>`;
  const saveEditedImage = async (form, target, id, previousPath) => {
    const image = form.querySelector('[name=image]')?.files?.[0];
    const remove = new FormData(form).get('remove_image') === '1';
    if (image && remove) throw new Error('Escolha entre substituir ou remover a imagem.');
    if (image) { await api.uploadImage(target, id, image, previousPath); state.images.delete(previousPath); }
    else if (remove && previousPath) { await api.removeImage(target, id, previousPath); state.images.delete(previousPath); }
    return Boolean(image || remove);
  };
  const itemDialog = item => {
    if (isInventory(item)) {
      if (!item.manual_id) throw new Error('O vínculo visual do Inventário ainda não está disponível. Aguarde a atualização automática e tente novamente.');
      showDialog(`Editar imagem — ${item.name}`, `<p class="sp-muted">Sincronizado do Inventário. TAG, modelo, status, quantidade e localização são somente leitura.</p>${imageFields(item)}`, async form => {
        if (!await saveEditedImage(form, 'supply', item.manual_id, item.image_path)) throw new Error('Escolha uma imagem ou marque a remoção.');
        notify('Imagem atualizada.');
      });
      hydrateImages(dialogLayer);
      return;
    }
    showDialog(item ? `Editar ${item.name}` : 'Adicionar suprimento', `<div class="sp-form">
      ${field('Nome do item *','name',item?.name || '', 'required maxlength="160"')}
      ${field('Categoria *','category',item?.category || '', 'required maxlength="80"')}
      ${field('Marca','brand',item?.brand || '', 'maxlength="100"')}
      ${field('Modelo','model',item?.model || '', 'maxlength="100"')}
      <label>Tipo de controle<select name="tracking_type"><option value="quantity">Por quantidade</option><option value="unit">Unidades rastreáveis</option></select></label>
      ${field('Estoque mínimo','minimum_stock',item?.minimum_stock ?? 0,'type="number" min="0" required')}
      ${field('Local padrão','default_location',item?.default_location || 'Almoxarifado','required maxlength="100"')}
      ${textArea('Descrição','description',item?.description || '')}
      ${textArea('Observações','notes',item?.notes || '')}</div>${item ? imageFields(item) : ''}`, async form => {
      const data = new FormData(form);
      if (!item && state.items.some(row => isInventory(row)
        && inventoryCatalog.alias(row.name) === inventoryCatalog.alias(data.get('name')))) {
        throw new Error('Este tipo já está vinculado ao Inventário. Abra o item existente em Suprimentos.');
      }
      const id = await api.saveItem({
        p_id: item?.id || null, p_name: data.get('name'), p_category: data.get('category'), p_brand: data.get('brand'),
        p_model: data.get('model'), p_description: data.get('description'), p_tracking_type: data.get('tracking_type'),
        p_minimum_stock: Number(data.get('minimum_stock')), p_default_location: data.get('default_location'), p_notes: data.get('notes')
      });
      if (item) await saveEditedImage(form, 'supply', id, item.image_path);
      state.selectedId = id; state.activeTab = 'general';
      history.replaceState(null,'',`supplies.html?item=${encodeURIComponent(id)}`);
      notify(item ? 'Suprimento atualizado.' : 'Suprimento criado.');
    });
    dialogLayer.querySelector('[name=tracking_type]').value = item?.tracking_type || 'quantity';
    hydrateImages(dialogLayer);
  };
  const variantDialog = variant => {
    const item = active();
    showDialog(variant ? 'Editar variação' : 'Adicionar variação', `<div class="sp-form">
      ${field('Nome da variação *','name',variant?.name || '', 'required maxlength="120"')}
      ${field('Estoque mínimo','minimum_stock',variant?.minimum_stock ?? 0,'type="number" min="0" required')}
      ${field('Local físico','location',variant?.location || item.default_location)}
      ${textArea('Descrição','description',variant?.description || '')}</div>${variant ? imageFields(variant) : ''}`, async form => {
      const data = new FormData(form);
      const id = await api.saveVariant({ p_id: variant?.id || null, p_supply_id: item.id, p_name: data.get('name'),
        p_description: data.get('description'), p_minimum_stock: Number(data.get('minimum_stock')), p_location: data.get('location') });
      if (variant) await saveEditedImage(form, 'variant', id, variant.image_path);
      notify(variant ? 'Variação atualizada.' : 'Variação criada.');
    });
    hydrateImages(dialogLayer);
  };
  const quantityDialog = variant => {
    const item = active();
    const current = variant ? variant.quantity_stock : item.quantity_stock;
    showDialog(`Movimentar ${variant?.name || item.name}`, `<p class="sp-muted">Saldo atual deste registro: ${current}. A saída não poderá superar o saldo.</p><div class="sp-form">
      <label>Operação<select name="direction"><option value="entry">Entrada</option><option value="exit">Saída</option></select></label>
      ${field('Quantidade *','quantity',1,'type="number" min="1" required')}
      ${textArea('Motivo *','reason')}</div>`, async form => {
      const data = new FormData(form);
      if (!String(data.get('reason')).trim()) throw new Error('Informe o motivo.');
      const signed = Number(data.get('quantity')) * (data.get('direction') === 'exit' ? -1 : 1);
      await api.adjustQuantity({ p_supply_id: item.id, p_variant_id: variant?.id || null, p_delta: signed, p_reason: data.get('reason') });
      notify('Estoque e histórico atualizados.');
    });
  };
  const unitDialog = () => {
    const item = active();
    showDialog('Adicionar unidade rastreável', `<div class="sp-form">${field('Código da unidade *','code','','required maxlength="100" placeholder="Ex.: Fonte 0015"')}
      ${field('Número de série','serial_number')}${field('Local físico','location',item.default_location)}
      <label>Variação<select name="variant_id"><option value="">Sem variação</option>${(state.detail?.variants || []).map(row => `<option value="${row.id}">${safe(row.name)}</option>`).join('')}</select></label></div>`, async form => {
      const data = new FormData(form);
      await api.createUnit({ p_supply_id: item.id, p_variant_id: data.get('variant_id') || null,
        p_code: data.get('code'), p_serial_number: data.get('serial_number'), p_location: data.get('location') });
      state.activeTab = 'units'; notify('Unidade criada e adicionada ao estoque disponível.');
    });
  };
  const unitEditDialog = unit => showDialog(`Editar ${unit.code}`, `<div class="sp-form">
    ${field('Código da unidade *','code',unit.code,'required maxlength="100"')}
    ${field('Número de série','serial_number',unit.serial_number)}
    ${field('Local físico','location',unit.physical_location)}
    </div>`, async form => {
    const data = new FormData(form);
    await api.editUnit({ p_unit_id: unit.id, p_code: data.get('code'),
      p_serial_number: data.get('serial_number'), p_location: data.get('location') });
    notify('Identificação da unidade atualizada e registrada no histórico.');
  });
  const targetMarkup = (selected = '') => `<div class="sp-target-picker"><label>Buscar equipamento<input type="search" data-sp-target-search placeholder="TAG, nome, série, modelo ou código"></label>
    <div class="sp-target-list">${state.equipment.slice(0,50).map(row => `<label data-sp-target-row data-search="${safe([row.name,row.tag,row.serial,row.model,row.location].join(' ').toLowerCase())}"><input type="radio" name="target" value="${row.source}:${row.id}" ${selected === `${row.source}:${row.id}` ? 'checked' : ''}><span><b>${safe(row.name)}</b><small>${safe(row.source === 'inventory' ? 'Inventário' : 'Gestão TI')} · ${safe(row.tag || row.serial || row.model || 'Sem TAG')} · ${safe(row.location || '')}</small></span></label>`).join('')}</div><small class="sp-muted" data-sp-target-count>${Math.min(state.equipment.length,50)} de ${state.equipment.length} equipamentos</small></div>`;
  const transitionDialog = (unit, preset) => {
    const statuses = preset ? [preset] : ['Em estoque','Reserva','Defeito','Inativo',...(unit.status === 'Instalado' ? ['Instalado'] : [])];
    const statusField = statuses.length === 1 ? `<input type="hidden" name="status" value="${safe(statuses[0])}"><p>Destino operacional: ${badge(statuses[0])}</p>`
      : `<label>Status operacional<select name="status" data-sp-transition-status>${options(statuses)}</select></label>`;
    const showTarget = statuses[0] === 'Instalado';
    showDialog(`${unit.code} — ${preset || 'alterar situação'}`, `<div class="sp-form">${statusField}${field('Local físico','location',unit.physical_location || active().default_location)}${textArea('Motivo / defeito *','reason')}</div><div data-sp-transition-target ${showTarget ? '' : 'hidden'}>${targetMarkup(unit.status === 'Instalado' ? `${unit.installed_inventory_item_id ? 'inventory' : 'management'}:${unit.installed_inventory_item_id || unit.installed_management_record_id}` : '')}</div>`, async form => {
      const data = new FormData(form);
      const status = String(data.get('status'));
      const reason = String(data.get('reason') || '').trim();
      if (!reason) throw new Error('Informe o motivo da alteração.');
      const target = status === 'Instalado' ? String(data.get('target') || '') : '';
      if (status === 'Instalado' && !target) throw new Error('Selecione o equipamento por ID.');
      const [source, id] = target.split(':');
      const explicitReason = unit.status === 'Inativo' && status !== 'Inativo' ? `REATIVAR: ${reason}`
        : unit.status === 'Defeito' && status === 'Em estoque' ? `REPARO: ${reason}` : reason;
      await api.transitionUnit({ p_unit_id: unit.id, p_status: status,
        p_inventory_item_id: source === 'inventory' ? id : null,
        p_management_record_id: source === 'management' ? id : null,
        p_location: data.get('location') || null, p_reason: explicitReason });
      state.activeTab = 'units'; notify(status === 'Manutenção' ? 'Manutenção aberta automaticamente no Controle TI.' : 'Unidade, equipamento, estoque e histórico sincronizados.');
    }, true);
  };
  const replaceDialog = async unit => {
    const list = await api.availableReplacements(active().category);
    const candidates = list.filter(row => row.id !== unit.id);
    if (!candidates.length) { notify('Não há outra unidade disponível da mesma categoria.', true); return; }
    showDialog(`Substituir ${unit.code}`, `<p class="sp-muted">A nova unidade será instalada em ${safe(equipmentFor(unit)?.name || 'equipamento atual')}. A operação é atômica.</p><div class="sp-form">
      <label>Nova unidade<select name="new_unit_id">${candidates.map(row => `<option value="${row.id}">${safe(row.code)} · ${safe(row.supplies?.name || '')}</option>`).join('')}</select></label>
      <label>Destino da unidade retirada<select name="old_destination">${options(['Em estoque','Reserva','Manutenção','Defeito','Inativo'])}</select></label>
      ${textArea('Motivo *','reason')}</div>`, async form => {
      const data = new FormData(form);
      if (!String(data.get('reason')).trim()) throw new Error('Informe o motivo da substituição.');
      await api.replaceUnit({ p_old_unit_id: unit.id, p_new_unit_id: data.get('new_unit_id'),
        p_old_destination: data.get('old_destination'), p_reason: data.get('reason') });
      notify('Componente substituído e histórico de ambas as unidades atualizado.');
    });
  };
  const historyDialog = unit => {
    const events = (state.detail?.movements || []).filter(row => row.supply_unit_id === unit.id);
    const orders = (state.detail?.maintenance || []).filter(row => row.supply_unit_id === unit.id);
    showDialog(`Histórico — ${unit.code}`, `<div style="max-height:55vh;overflow:auto">${events.map(row => `<article class="sp-log"><time>${fmtDate(row.created_at)}</time><b>${safe(row.type)}</b><p>${safe(`${row.origin || '—'} → ${row.destination || '—'} · ${row.reason}`)}</p></article>`).join('') || '<p class="sp-muted">Nenhuma movimentação registrada.</p>'}<h3>Manutenções</h3>${orders.map(row => `<article class="sp-log"><time>${fmtDate(row.opened_at)} — ${fmtDate(row.closed_at)}</time><b>${safe(row.status)}</b><p>${safe(row.defect)}${row.destination ? ` · Destino: ${safe(row.destination)}` : ''}</p><a href="control.html?table=${row.control_items?.table_id || ''}&item=${row.control_item_id}">Abrir no Controle TI</a></article>`).join('') || '<p class="sp-muted">Nenhuma manutenção registrada.</p>'}</div>`, null, true);
    dialogLayer.querySelector('[type=submit]').hidden = true;
  };
  const inventoryHistoryDialog = async unit => {
    const [logs, replacements] = await Promise.all([api.inventoryHistory(unit.id), api.inventoryReplacements(unit.id)]);
    const groupUnits = active()?.inventory_group?.units || [];
    const label = id => {
      const row = groupUnits.find(candidate => candidate.id === id);
      return row?.tag || row?.serial || row?.equipment || id;
    };
    showDialog(`Histórico — ${unit.tag || unit.serial || unit.equipment}`,
      `<p class="sp-muted">Registro original do Inventário · ${safe(unit.equipment)} · ${safe(unit.model)}</p><div class="sp-history-list">${replacements.rows.map(row => `<article class="sp-log"><time>${fmtDate(row.created_at)}</time><b>Substituição vinculada</b><p>${safe(row.removed_tag || label(row.removed_identity))} saiu de ${safe(row.previous_location)} para ${safe(row.removed_location)} (${safe(row.removed_status)}). ${safe(row.installed_tag || label(row.installed_identity))} entrou no lugar. Motivo: ${safe(row.reason)}</p></article>`).join('')}${logs.map(row => `<article class="sp-log"><time>${fmtDate(row.created_at)}</time><p>${safe(row.message)}</p></article>`).join('') || (!replacements.rows.length ? '<p class="sp-muted">Nenhum registro no histórico desta unidade.</p>' : '')}${replacements.unavailable ? '<p class="sp-muted">Vínculos estruturados de substituição aguardam a migração 060.</p>' : ''}</div><a class="sp-btn" href="inventory.html?table=${encodeURIComponent(unit.table_id)}&item=${encodeURIComponent(unit.id)}">Abrir registro original</a>`, null, true);
    dialogLayer.querySelector('[type=submit]').hidden = true;
  };
  const belowMinimumDialog = () => {
    const rows = state.items.filter(row => !row.inactive && row.stock_status === 'Estoque baixo');
    showDialog('Itens abaixo do mínimo', rows.length
      ? `<div class="sp-history-list">${rows.map(row => `<button type="button" class="sp-card sp-below-row" data-sp-dialog-select="${safe(row.id)}"><b>${safe(row.name)}</b><span>Estoque ${quantityAvailable(row)} · mínimo ${row.minimum_stock}</span></button>`).join('')}</div>`
      : '<p class="sp-muted">Nenhum item está abaixo do estoque mínimo.</p>', null, true);
    dialogLayer.querySelector('[type=submit]').hidden = true;
  };
  const activeDialog = item => showDialog(item.inactive ? 'Reativar suprimento' : 'Inativar suprimento',
    `<p class="sp-muted">${item.inactive ? 'Reativar' : 'Inativar'} o produto principal ${safe(item.name)}? O histórico será mantido. Unidades instaladas ou em manutenção precisam ser resolvidas antes de inativar.</p>${textArea('Motivo *','reason')}`,
    async form => {
      const reason = new FormData(form).get('reason');
      await api.setActive({ p_supply_id: item.id, p_active: item.inactive, p_reason: reason });
      notify(item.inactive ? 'Suprimento reativado.' : 'Suprimento inativado.');
    });
  const deleteDialog = item => showDialog(`Excluir ${item.name}`,
    `<p class="sp-muted">Excluir o cadastro ${safe(item.name)}? A exclusão só é permitida para itens locais sem estoque, variações, unidades ou movimentações. Se o item já teve uso operacional, inative-o para preservar o histórico.</p>${textArea('Motivo *','reason')}`,
    async form => {
      await api.deleteItem({ p_supply_id: item.id, p_reason: new FormData(form).get('reason') });
      state.selectedId = null; state.detail = null;
      history.replaceState(null, '', 'supplies.html');
      notify('Cadastro excluído. Histórico preservado.');
    });
  const variantActiveDialog = variant => showDialog(variant.inactive ? 'Reativar variação' : 'Inativar variação',
    `<p class="sp-muted">${variant.inactive ? 'Reativar' : 'Inativar'} a variação ${safe(variant.name)} de ${safe(active().name)}? O produto principal e as demais variações não serão alterados.</p>${textArea('Motivo *','reason')}`,
    async form => {
      await api.setVariantActive({ p_variant_id: variant.id, p_active: variant.inactive, p_reason: new FormData(form).get('reason') });
      notify(variant.inactive ? 'Variação reativada com sucesso.' : 'Variação inativada com sucesso.');
    });
  const exportPdf = () => {
    const rows = filtered().map(row => `<tr><td>${safe(row.name)}</td><td>${safe(row.category)}</td><td>${safe(inventoryField(row, 'brand', 'Várias marcas'))}</td><td>${safe(inventoryField(row, 'model', 'Vários modelos'))}</td><td>${quantityAvailable(row)}</td><td>${Number(row.minimum_stock || 0)}</td><td>${safe(row.stock_status)}</td></tr>`).join('')
      || '<tr><td colspan="7">Nenhum suprimento corresponde aos filtros atuais.</td></tr>';
    const popup = window.open('', '_blank', 'width=1100,height=760');
    if (!popup) { notify('Permita a abertura da janela de impressão para exportar o resumo.', true); return; }
    popup.onload = () => { popup.focus(); popup.print(); };
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Suprimentos — ALDECKOT</title><style>body{font-family:Arial,sans-serif;color:#152c43;padding:28px}h1{margin:0;color:#087998}p{color:#58718a}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:9px;border-bottom:1px solid #c8d8e5;text-align:left;font-size:12px}th{background:#e9f6fb;color:#17617c}@media print{body{padding:10px}thead{display:table-header-group}}</style></head><body><h1>Suprimentos — ALDECKOT</h1><p>Resumo de estoque · ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr><th>Item</th><th>Categoria</th><th>Marca</th><th>Modelo</th><th>Estoque</th><th>Mínimo</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    popup.document.close();
  };
  app.addEventListener('click', async event => {
    const tab = event.target.closest('[data-sp-tab]');
    if (tab) { state.activeTab = tab.dataset.spTab; state.variantFormOpen = false; render(); return; }
    const inventoryVariant = event.target.closest('[data-sp-variant]');
    if (inventoryVariant) { state.selectedVariantId = inventoryVariant.dataset.spVariant; state.unitStatus = ''; state.activeTab = 'units'; render(); return; }
    const page = event.target.closest('[data-sp-page]');
    if (page) { state.page = Number(page.dataset.spPage); render(); app.querySelector('.sp-main').scrollTop = 0; return; }
    const open = event.target.closest('[data-sp-open], [data-supply-id]');
    if (open) { await select(open.dataset.spOpen || open.dataset.supplyId); return; }
    const button = event.target.closest('[data-sp-action]');
    if (!button) return;
    const action = button.dataset.spAction;
    if (action === 'close') { state.selectedId = null; state.detail = null; history.replaceState(null,'','supplies.html'); render(); return; }
    if (action === 'export') { exportPdf(); return; }
    if (action === 'backup') { window.AldeckotSuppliesBackup?.open(); return; }
    if (action === 'below-minimum') { belowMinimumDialog(); return; }
    if (action === 'all-units') { state.selectedVariantId = null; render(); return; }
    if (action === 'inventory-history') {
      const inventoryUnit = active()?.inventory_group?.units.find(row => row.id === button.dataset.id);
      if (inventoryUnit) {
        try { await inventoryHistoryDialog(inventoryUnit); }
        catch (error) { notify(error.message || 'Não foi possível abrir o histórico.', true); }
      }
      return;
    }
    if (!canEdit()) return;
    const item = active();
    const variant = (state.detail?.variants || []).find(row => row.id === button.dataset.id);
    const unit = (state.detail?.units || []).find(row => row.id === button.dataset.id);
    try {
      if (action === 'add') itemDialog(null);
      else if (action === 'edit') itemDialog(item);
      else if (action === 'variant-focus') { state.variantFormOpen = true; render(); app.querySelector('#spInlineVariantForm [name=name]')?.focus(); }
      else if (action === 'variant-cancel') { state.variantFormOpen = false; render(); }
      else if (action === 'variant') variantDialog(null);
      else if (action === 'variant-edit') variantDialog(variant);
      else if (action === 'variant-active') variantActiveDialog(variant);
      else if (action === 'adjust') quantityDialog(variant);
      else if (action === 'unit') unitDialog();
      else if (action === 'unit-edit') unitEditDialog(unit);
      else if (action === 'unit-transition') transitionDialog(unit, button.dataset.status);
      else if (action === 'unit-status') transitionDialog(unit, null);
      else if (action === 'replace') await replaceDialog(unit);
      else if (action === 'unit-history') historyDialog(unit);
      else if (action === 'active') activeDialog(item);
      else if (action === 'delete' && !isInventory(item)) deleteDialog(item);
    } catch (error) { notify(error.message || 'Não foi possível abrir esta ação.', true); }
  });
  app.addEventListener('input', event => {
    if (event.target.matches('[data-sp-search]')) {
      state.query = event.target.value; state.page = 1;
      const cursor = event.target.selectionStart;
      render(); const input = app.querySelector('[data-sp-search]'); input.focus(); input.setSelectionRange(cursor,cursor);
    }
  });
  app.addEventListener('change', event => {
    const field = event.target.closest('[data-sp-filter]');
    if (!field) return;
    if (field.dataset.spFilter === 'unit-status') state.unitStatus = field.value;
    else { state[field.dataset.spFilter] = field.value; state.page = 1; }
    render();
  });
  app.addEventListener('submit', async event => {
    if (event.target.id !== 'spInlineVariantForm') return;
    event.preventDefault();
    if (!canEdit() || state.busy) return;
    const form = event.target;
    const submit = form.querySelector('[type=submit]');
    const errorNode = form.querySelector('.sp-error');
    const data = new FormData(form);
    state.busy = true; submit.disabled = true; submit.classList.add('aldeckot-loading-button'); submit.setAttribute('aria-busy', 'true'); errorNode.textContent = '';
    try {
      const id = await api.saveVariant({ p_id: null, p_supply_id: active().id, p_name: data.get('name'),
        p_description: '', p_minimum_stock: Number(data.get('minimum_stock')), p_location: active().default_location });
      const initial = Number(data.get('initial_stock') || 0);
      if (initial > 0 && active().tracking_type === 'quantity')
        await api.adjustQuantity({ p_supply_id: active().id, p_variant_id: id, p_delta: initial, p_reason: 'Estoque inicial da variação' });
      state.variantFormOpen = false;
      await refresh();
      notify('Variação adicionada. Estoque atualizado.');
    } catch (error) {
      errorNode.textContent = error.message || 'Não foi possível adicionar a variação.';
      submit.disabled = false;
    } finally { state.busy = false; submit.classList.remove('aldeckot-loading-button'); submit.removeAttribute('aria-busy'); }
  });
  dialogLayer.addEventListener('click', event => {
    const row = event.target.closest('[data-sp-dialog-select]');
    if (row) { const id = row.dataset.spDialogSelect; closeDialog(); select(id); return; }
    if (event.target === dialogLayer || event.target.closest('[data-sp-dialog-close]')) closeDialog();
  });
  dialogLayer.addEventListener('change', event => {
    if (event.target.matches('[data-sp-transition-status]')) {
      const target = dialogLayer.querySelector('[data-sp-transition-target]');
      if (target) target.hidden = event.target.value !== 'Instalado';
    }
    if (event.target.matches('[name=image]')) {
      const preview = dialogLayer.querySelector('[data-sp-preview]');
      const file = event.target.files?.[0];
      if (!preview || !file) return;
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(file);
      preview.innerHTML = `<img class="sp-preview" src="${safe(state.previewUrl)}" alt="Prévia da imagem">`;
    }
  });
  dialogLayer.addEventListener('input', event => {
    if (!event.target.matches('[data-sp-target-search]')) return;
    const list = dialogLayer.querySelector('.sp-target-list');
    const count = dialogLayer.querySelector('[data-sp-target-count]');
    const term = event.target.value.trim().toLocaleLowerCase('pt-BR');
    const selected = dialogLayer.querySelector('[name=target]:checked')?.value;
    const matches = state.equipment.filter(row => [row.name,row.tag,row.serial,row.model,row.location].join(' ').toLocaleLowerCase('pt-BR').includes(term));
    list.innerHTML = matches.slice(0,50).map(row => `<label data-sp-target-row><input type="radio" name="target" value="${row.source}:${row.id}" ${selected === `${row.source}:${row.id}` ? 'checked' : ''}><span><b>${safe(row.name)}</b><small>${safe(row.source === 'inventory' ? 'Inventário' : 'Gestão TI')} · ${safe(row.tag || row.serial || row.model || 'Sem TAG')} · ${safe(row.location || '')}</small></span></label>`).join('') || '<p class="sp-muted">Nenhum equipamento corresponde à busca.</p>';
    count.textContent = `${Math.min(matches.length,50)} de ${matches.length} equipamentos`;
  });
  dialogLayer.addEventListener('submit', async event => {
    if (event.target.id !== 'spActionForm') return;
    event.preventDefault();
    if (!state.onSubmit || state.busy) return;
    state.busy = true;
    const submit = event.target.querySelector('[type=submit]');
    submit.disabled = true;
    submit.classList.add('aldeckot-loading-button');
    submit.setAttribute('aria-busy', 'true');
    try {
      await state.onSubmit(event.target);
      closeDialog();
      await refresh();
    } catch (error) {
      event.target.querySelector('.sp-error').textContent = error.message || 'Não foi possível concluir a operação.';
      submit.disabled = false;
    } finally { state.busy = false; submit.classList.remove('aldeckot-loading-button'); submit.removeAttribute('aria-busy'); }
  });
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && !dialogLayer.hidden) closeDialog(); });
  const start = async () => {
    try {
      await window.AldeckotAuthReady;
      await load();
      try { state.equipment = await api.equipment(); }
      catch (error) { notify(`Equipamentos temporariamente indisponíveis: ${error.message}`, true); }
      api.subscribe(() => {
        load();
        window.dispatchEvent(new CustomEvent('aldeckot:realtime-change', { detail: { table: 'supply_units' } }));
      }).catch(() => {});
    } catch (error) {
      state.error = error.message || 'Não foi possível conectar ao Supabase.';
      state.items = []; render();
    }
  };
  window.AldeckotSuppliesOpenDetails = async (id, unitId) => {
    if (!id) return;
    state.selectedId = id;
    state.activeTab = unitId ? 'units' : 'general';
    history.replaceState(null,'',`supplies.html?item=${encodeURIComponent(id)}${unitId ? `&unit=${encodeURIComponent(unitId)}` : ''}`);
    await loadDetail();
  };
  start();
})();
