(() => {
  const app = document.getElementById('suppliesApp');
  const dialogLayer = document.getElementById('suppliesDialog');
  const toastNode = document.getElementById('suppliesToast');
  const api = window.AldeckotSupplies;
  const inventoryCatalog = window.AldeckotInventorySupplies;
  const variations = window.AldeckotSupplyVariations;
  const supplyHistory = window.AldeckotSupplyHistory;
  const params = new URLSearchParams(location.search);
  const pageSizes = [10, 25, 50, 100];
  const pageSizeKey = 'aldeckot:supplies:page-size';
  const savedPageSize = (() => {
    try { return Number(window.localStorage.getItem(pageSizeKey)); } catch { return 0; }
  })();
  const state = {
    items: [], detail: null, detailError: '', selectedId: params.get('item'), activeTab: params.get('unit') ? 'units' : 'general',
    query: '', status: '', location: '', page: 1,
    pageSize: pageSizes.includes(savedPageSize) ? savedPageSize : 25, selectedVariantId: null,
    equipment: [], images: new Map(), busy: false, error: '', dialog: '', renderVersion: 0,
    ensuredGroups: new Set(), ensuredVariants: new Set(), catalogUnavailable: false, catalogPromise: null,
    variantMetadataAvailable: null,
    variantFormOpen: false, integrationReady: null, alertQuery: '', movementResume: null
  };
  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const fmtDate = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const canEdit = () => Boolean(window.AldeckotAuth?.isAdmin) && !state.error;
  const active = () => state.items.find(row => row.id === state.selectedId);
  const selectedVariant = item => (isInventory(item) ? item.inventory_group.variants : item.variation_rows || [])
    .find(row => row.id === state.selectedVariantId);
  const isInventory = item => item?.source === 'inventory';
  const statusTone = status => ({ 'Normal': 'normal', 'Estoque baixo': 'low', 'Sem estoque': 'none', 'Inativo': 'inactive',
    'Em estoque': 'normal', 'Instalado': 'installed', 'Ativo': 'normal', 'Reserva': 'reserve',
    'Manutenção': 'maintenance', 'Defeito': 'defect', 'Inativo': 'inactive', 'Saída': 'inactive', 'Troca': 'inactive', 'Atenção': 'attention' })[status] || 'inactive';
  const badge = status => `<span class="sp-badge ${statusTone(status)}">${safe(status)}</span>`;
  const unitState = unit => unit.exited_at ? 'Saída' : unit.status;
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
  const stockTone = row => {
    const available = quantityAvailable(row);
    const minimum = Math.max(0, Number(row.minimum_stock || 0));
    if (row.stock_status === 'Estoque baixo') return { className: 'below', label: 'Modelo abaixo do mínimo' };
    if (available === 0 || available < minimum) return { className: 'below', label: available === 0 ? 'Sem estoque' : 'Abaixo do mínimo' };
    if (minimum > 0 && available <= minimum + Math.max(1, Math.ceil(minimum * .2))) return { className: 'near', label: 'Próximo do mínimo' };
    return { className: 'above', label: 'Acima do mínimo' };
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
    const belowMinimum = variations.alerts(operational).length;
    return `<section class="sp-metrics" aria-label="Indicadores">${metric('total','Total de itens',operational.length)}${metric('stock','Em estoque',available)}${metric('warning','Abaixo do mínimo',belowMinimum,belowMinimum ? 'warn has-alert' : 'warn','below-minimum')}${metric('empty','Sem estoque',operational.filter(row => row.stock_status === 'Sem estoque').length,'empty')}</section>`;
  };
  const options = values => values.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join('');
  const unitStatusOptions = values => values.map(value => `<option value="${safe(value)}"${state.unitStatus === value ? ' selected' : ''}>${safe(value)}</option>`).join('');
  const renderTable = () => {
    const rows = filtered();
    const max = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > max) state.page = max;
    const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const firstPage = Math.max(1, Math.min(state.page - 3, max - 6));
    const lastPage = Math.min(max, firstPage + 6);
    return `${metrics()}<div class="sp-toolbar"><label class="sp-search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 5 5"/></svg><input class="sp-search" data-sp-search type="search" placeholder="Buscar por nome, categoria, marca, modelo..." value="${safe(state.query)}" aria-label="Buscar suprimentos"></label>${canEdit() ? '<button class="sp-btn primary sp-toolbar-add" data-sp-action="add" type="button">＋ Adicionar</button>' : ''}<select data-sp-filter="status" aria-label="Filtrar status"><option value="">Todos os status</option>${options(['Normal','Estoque baixo','Sem estoque','Inativo'])}</select></div>
    <div class="sp-table-wrap"><table class="sp-table"><thead><tr><th>Imagem</th><th>Nome do item</th><th>Categoria</th><th>Estoque</th><th>Mínimo</th><th>Indicador</th><th>Status</th></tr></thead><tbody>${pageRows.length ? pageRows.map(row => {
      const tone = stockTone(row);
      return `<tr data-supply-id="${safe(row.id)}" class="${row.id === state.selectedId ? 'selected' : ''}"><td>${img(row.image_path)}</td><td><button type="button" class="sp-item-open" data-sp-open="${safe(row.id)}" aria-label="Abrir ${safe(row.name)}">${safe(row.name)}</button><br><small class="sp-muted">${isInventory(row) ? `${row.total_units} equipamentos no Inventário` : row.tracking_type === 'unit' ? `${row.total_units} unidades cadastradas` : 'Por quantidade'}</small></td><td>${safe(row.category)}</td><td class="sp-stock sp-stock-${tone.className}" title="${tone.label}">${quantityAvailable(row)}</td><td>${row.minimum_stock}</td><td>${Number(row.active_count || 0)}</td><td>${badge(row.stock_status)}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="sp-empty">Nenhum suprimento encontrado. Os indicadores e a tabela mostram somente dados reais.</td></tr>'}</tbody></table></div>
    <div class="sp-pagination"><span>Mostrando ${pageRows.length ? (state.page - 1) * state.pageSize + 1 : 0} a ${Math.min(state.page * state.pageSize, rows.length)} de ${rows.length} itens</span><label class="sp-page-size">Itens por página <select data-sp-page-size aria-label="Itens por página">${pageSizes.map(size => `<option value="${size}"${size === state.pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select></label><nav class="sp-pages" aria-label="Páginas"><button type="button" data-sp-page="${state.page - 1}" aria-label="Página anterior" ${state.page === 1 ? 'disabled' : ''}>‹</button>${firstPage > 1 ? `<button type="button" data-sp-page="1">1</button>${firstPage > 2 ? '<span aria-hidden="true">…</span>' : ''}` : ''}${Array.from({length: lastPage - firstPage + 1}, (_, index) => firstPage + index).map(page => `<button type="button" data-sp-page="${page}" class="${state.page === page ? 'active' : ''}" ${state.page === page ? 'aria-current="page"' : ''}>${page}</button>`).join('')}${lastPage < max ? `${lastPage < max - 1 ? '<span aria-hidden="true">…</span>' : ''}<button type="button" data-sp-page="${max}">${max}</button>` : ''}<button type="button" data-sp-page="${state.page + 1}" aria-label="Próxima página" ${state.page === max ? 'disabled' : ''}>›</button></nav></div>`;
  };
  const renderGeneral = item => isInventory(item)
    ? `<div class="sp-fields"><div><span>Fonte dos equipamentos</span><strong>Inventário</strong></div><div><span>Total de unidades</span><strong>${item.total_units}</strong></div><div><span>Em Reserva (Estoque)</span><strong>${item.available_stock}</strong></div><div><span>Ativos (Indicador)</span><strong>${item.active_count}</strong></div><div><span>Em manutenção</span><strong>${item.inventory_group.maintenance}</strong></div><div><span>Inativos</span><strong>${item.inventory_group.inactive}</strong></div><div><span>Com defeito</span><strong>${item.inventory_group.defect}</strong></div><div><span>Estoque mínimo</span><strong>${item.minimum_stock}</strong></div><div><span>Variações por modelo</span><strong>${item.inventory_group.variants.length}</strong></div></div><p class="sp-muted">Os quantitativos são calculados diretamente dos registros físicos do Inventário. TAG, série, local e histórico permanecem em cada unidade.</p>${item.legacy_minimum_unallocated ? `<p class="sp-muted">Mínimo legado do item: ${item.legacy_minimum_unallocated}. Ele foi preservado, mas precisa ser distribuído manualmente entre os modelos; não gera alerta até a distribuição.</p>` : ''}`
    : `<div class="sp-fields"><div><span>Descrição</span><strong>${safe(item.description || '—')}</strong></div><div><span>Tipo de controle</span><strong>${item.tracking_type === 'unit' ? 'Unidades rastreáveis' : 'Por quantidade'}</strong></div><div><span>Disponível</span><strong>${quantityAvailable(item)}</strong></div><div><span>Unidades cadastradas</span><strong>${item.tracking_type === 'unit' ? item.total_units : '—'}</strong></div><div><span>Estoque mínimo</span><strong>${item.minimum_stock}</strong></div><div><span>Local padrão</span><strong>${safe(item.default_location)}</strong></div><div><span>Observações</span><strong>${safe(item.notes || '—')}</strong></div></div>${canEdit() && item.tracking_type === 'quantity' && !item.inactive ? '<div class="sp-card-actions"><button class="sp-btn primary" data-sp-action="adjust">Movimentar estoque</button></div>' : ''}`;
  const renderVariants = item => {
    if (isInventory(item)) {
      const variants = item.inventory_group.variants;
      return `<div class="sp-section-title"><h3>Modelos do Inventário · ${variants.length}</h3></div>${variants.map(row => `<button type="button" class="sp-card sp-inventory-variant sp-health-${variations.health(row).tone} ${state.selectedVariantId === row.id ? 'selected' : ''}" data-sp-variant="${safe(row.id)}">${img(row.image_path || item.image_path)}<span><b>${safe(row.name)}</b><small>${safe(row.brand || 'Marca não informada')} · ${row.total} unidade(s)</small>${row.inactive || row.defect ? `<small>${[['Inativos', row.inactive], ['Defeito', row.defect]].filter(([, count]) => count > 0).map(([label, count]) => `${label}: ${count}`).join(' · ')}</small>` : ''}</span><span><small>Ativos</small><strong>${row.active}</strong></span><span><small>Reserva</small><strong>${row.reserve}</strong></span><span><small>Mínimo</small><strong>${row.minimum_stock}</strong></span></button>`).join('') || '<p class="sp-muted">Nenhum modelo encontrado no Inventário.</p>'}`;
    }
    const variants = item.variation_rows || [];
    const title = item.category.toLocaleLowerCase('pt-BR').includes('cabo') ? 'Variações por tipo de conector' : 'Variações por tipo/modelo';
    const cards = variants.length ? variants.map(row => `<article class="sp-card sp-variant-card sp-health-${variations.health(row).tone} ${state.selectedVariantId === row.id ? 'selected' : ''}" data-sp-variant="${safe(row.id)}" role="button" tabindex="0" aria-label="Selecionar ${safe(row.name)}"><div class="sp-variant-row">
      ${img(row.image_path || item.image_path)}<div class="sp-variant-copy"><b>${safe(row.name)}</b>${row.disabled ? badge('Inativa') : ''}<small>${safe([row.brand, row.model, row.description].filter(Boolean).join(' · ') || row.location || item.default_location)}</small></div>
      <div class="sp-variant-value"><small>Estoque</small><strong>${row.reserve}</strong></div>
      <div class="sp-variant-value"><small>Mínimo</small><strong class="${row.minimum_stock ? 'sp-minimum' : ''}">${row.minimum_stock}</strong></div></div>
      ${canEdit() ? `<details class="sp-variant-menu"><summary aria-label="Ações de ${safe(row.name)}">•••</summary><div class="sp-variant-menu-list"><button data-sp-action="${row.base ? 'edit' : 'variant-edit'}" data-id="${row.id}">Editar</button>${!row.base && state.integrationReady ? `<button data-sp-action="variant-active" data-id="${row.id}">${row.inactive ? 'Reativar' : 'Inativar'} variação</button>` : ''}${item.tracking_type === 'quantity' && !row.disabled ? `<button data-sp-action="adjust" data-id="${safe(row.id)}">Movimentar estoque</button>` : ''}</div></details>` : ''}
    </article>`).join('') : '<p class="sp-muted">Nenhuma variação cadastrada.</p>';
    const form = canEdit() && state.variantFormOpen ? `<form id="spInlineVariantForm" class="sp-variant-form"><h3>Adicionar nova variação</h3>
      <div class="sp-variant-form-grid">
      <div class="sp-variant-form-fields"><label>Marca<input name="brand" placeholder="Ex.: Epson" maxlength="120"></label><label>Modelo<input name="model" placeholder="Ex.: 544" maxlength="120"></label><label>Características<input name="description" placeholder="Ex.: Azul, 500 ml, USB-C" maxlength="1000"></label><small>Informe o modelo ou uma característica. Marca, modelo e características identificam a variação.</small>
      <div class="sp-variant-form-numbers">${item.tracking_type === 'quantity' ? '<label>Estoque inicial<input name="initial_stock" type="number" min="0" value="0" required></label>' : ''}<label>Estoque mínimo<input name="minimum_stock" type="number" min="0" value="0" required></label></div>
      <button class="sp-btn primary" type="submit">＋ Adicionar variação</button><button class="sp-btn" type="button" data-sp-action="variant-cancel">Cancelar</button></div></div><p class="sp-error" role="alert"></p></form>` : '';
    return `<div class="sp-section-title"><h3>${title}</h3>${canEdit() && !state.variantFormOpen ? '<button class="sp-btn primary" data-sp-action="variant-focus">＋ Adicionar variação</button>' : ''}</div>${cards}${form}`;
  };
  const renderUnits = item => {
    if (isInventory(item)) {
      const group = item.inventory_group;
      const variant = group.variants.find(row => row.id === state.selectedVariantId);
      const units = (variant ? variant.units : group.units).filter(unit => !state.unitStatus || unit.status === state.unitStatus);
      return `<div class="sp-section-title"><h3>${variant ? `${safe(variant.brand)} ${safe(variant.name)}` : 'Todas as unidades'} · ${units.length}</h3>${variant ? '<button type="button" class="sp-btn" data-sp-action="all-units">Todas as unidades</button>' : ''}</div><select data-sp-filter="unit-status" aria-label="Filtrar unidades por status"><option value=""${state.unitStatus ? '' : ' selected'}>Todos os status</option>${unitStatusOptions(['Ativo','Reserva','Manutenção','Inativo','Defeito','Atenção'])}</select><div class="sp-inventory-units">${units.map(unit => `<article class="sp-card" id="unit-${safe(unit.id)}"><div class="sp-card-row"><div><b>${safe(unit.tag || unit.serial || unit.equipment)}</b><small>${safe(unit.equipment)} · ${safe(unit.brand)} ${safe(unit.model)}</small><small>Nº série: ${safe(unit.serial || '—')} · Setor: ${safe(unit.sector || '—')}</small><small>Local: ${safe(unit.location || '—')}</small></div>${badge(unit.status)}</div><div class="sp-card-actions"><a class="sp-btn" href="inventory.html?table=${encodeURIComponent(unit.table_id)}&item=${encodeURIComponent(unit.id)}">Abrir no Inventário</a><button type="button" class="sp-btn" data-sp-action="inventory-history" data-id="${safe(unit.id)}">Histórico</button></div></article>`).join('') || '<p class="sp-muted">Nenhuma unidade para este modelo ou filtro.</p>'}</div>`;
    }
    const variant = selectedVariant(item);
    const units = variations.unitsForVariant(state.detail?.units || [], variant);
    const unitFilter = state.unitStatus || '';
    const visibleUnits = units.filter(unit => !unitFilter || unitState(unit) === unitFilter);
    const canExit = canEdit() && !item.inactive && units.some(unit => variations.exitEligible(unit,
      (state.detail?.variants || []).find(variant => variant.id === unit.variant_id)));
    return `<div class="sp-section-title"><h3>${variant ? safe(variant.name) : 'Todas as unidades rastreáveis'} · ${visibleUnits.length}</h3>${variant ? '<button type="button" class="sp-btn" data-sp-action="all-units">Todas as unidades</button>' : ''}${canEdit() ? '<button class="sp-btn primary" data-sp-action="unit">＋ Adicionar unidade</button>' : ''}${canExit ? '<button class="sp-btn" data-sp-action="unit-exit">Saída de unidades</button>' : ''}</div><select data-sp-filter="unit-status" aria-label="Filtrar unidades por status"><option value=""${unitFilter ? '' : ' selected'}>Todos os status</option>${unitStatusOptions(['Em estoque','Instalado','Reserva','Manutenção','Defeito','Inativo','Saída'])}</select><div style="margin-top:9px">${visibleUnits.map(unit => {
      const equipment = equipmentFor(unit);
      const order = (state.detail?.maintenance || []).find(link => link.supply_unit_id === unit.id && !link.closed_at);
      return `<article class="sp-card" id="unit-${safe(unit.id)}"><div class="sp-card-row"><div><b>${safe(unit.code || unit.serial_number || 'Unidade sem TAG')}</b><small>ID: ${safe(unit.id)} · Série: ${safe(unit.serial_number || '—')}</small><small>Local: ${safe(unit.physical_location)} · Instalado em: ${equipmentLink(equipment)}</small><small>Atualizado em: ${fmtDate(unit.updated_at)}</small>${unit.exited_at ? `<small>Saída: ${fmtDate(unit.exited_at)} · ${safe(unit.exit_reason || 'Motivo no histórico')}</small>` : ''}</div>${badge(unitState(unit))}</div>${order ? `<small>Controle TI: <a href="control.html?table=${order.control_items?.table_id || ''}&item=${order.control_item_id}">${safe(order.status)} · abrir manutenção</a></small>` : ''}${canEdit() ? `<div class="sp-card-actions">${unit.exited_at ? '' : `${unit.status !== 'Instalado' && unit.status !== 'Manutenção' && unit.status !== 'Inativo' ? `<button class="sp-btn primary" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Instalado">Instalar</button>` : ''}${unit.status === 'Instalado' ? `<button class="sp-btn" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Em estoque">Remover</button><button class="sp-btn" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Instalado">Transferir</button><button class="sp-btn" data-sp-action="replace" data-id="${unit.id}">Substituir</button>` : ''}${unit.status !== 'Manutenção' && unit.status !== 'Inativo' ? `<button class="sp-btn" data-sp-action="unit-transition" data-id="${unit.id}" data-status="Manutenção">Manutenção</button>` : ''}${unit.status !== 'Manutenção' ? `<button class="sp-btn" data-sp-action="unit-status" data-id="${unit.id}">${unit.status === 'Inativo' ? 'Reativar' : 'Outros estados'}</button>` : ''}<button class="sp-btn" data-sp-action="unit-edit" data-id="${unit.id}">Editar</button>`}<button class="sp-btn" data-sp-action="unit-history" data-id="${unit.id}">Histórico</button></div>` : ''}</article>`;
    }).join('') || '<p class="sp-muted">Nenhuma unidade para este filtro.</p>'}</div>`;
  };
  const renderTimeline = type => {
    if (type === 'logs') {
      const item = active();
      const units = isInventory(item) ? item.inventory_group.units : state.detail?.units || [];
      const all = supplyHistory.timeline(state.detail?.logs || [], state.detail?.inventoryLogs || [], units);
      const selectedId = state.selectedVariantId;
      const selectedRows = !selectedId ? all : all.filter(row => selectedId.startsWith('base:')
        ? Boolean(row.supply_unit_id) && !row.variant_id : row.variant_id === selectedId);
      const quantityMovements = selectedId && item?.tracking_type === 'quantity' && !isInventory(item)
        ? (state.detail?.movements || []).filter(row => row.type === 'Entrada' || row.type === 'Saída')
          .filter(row => selectedId.startsWith('base:') ? !row.variant_id : row.variant_id === selectedId)
          .map(supplyHistory.movementEntry) : [];
      const rows = [...selectedRows, ...quantityMovements]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      return `<div class="sp-section-title"><h3>Histórico de atividades</h3></div><div class="sp-history-list">${rows.length
        ? rows.map(row => `<article class="sp-history-entry"><time datetime="${safe(row.created_at || '')}">${fmtDate(row.created_at)}</time><div class="sp-history-content"><div class="sp-history-heading"><b>${safe(row.title)}</b><span class="sp-history-source ${row.source === 'Inventário' ? 'inventory' : 'supplies'}">${safe(row.source)}</span></div>${row.message ? `<p>${safe(row.message)}</p>` : ''}${row.context || row.actor ? `<small>${safe([row.context, row.actor && `por ${row.actor}`].filter(Boolean).join(' · '))}</small>` : ''}</div></article>`).join('')
        : '<p class="sp-muted">Nenhum registro no histórico deste equipamento.</p>'}</div>`;
    }
    const all = type === 'movements' ? state.detail?.movements || [] : state.detail?.logs || [];
    const rows = state.selectedVariantId ? all.filter(row => state.selectedVariantId.startsWith('base:')
      ? !row.variant_id : row.variant_id === state.selectedVariantId) : all;
    return `<div class="sp-section-title"><h3>Movimentações</h3></div>${rows.length ? rows.map(row => `<article class="sp-log"><time>${fmtDate(row.created_at)} · ${safe(row.actor_name || 'Equipe ALDECKOT')}</time><b>${safe(row.type)}${row.supply_unit_id ? ` · ${safe((state.detail?.units || []).find(unit => unit.id === row.supply_unit_id)?.code || '')}` : ''}</b><p>${safe(`${row.origin || '—'} → ${row.destination || '—'} · ${row.previous_stock} → ${row.new_stock} disponíveis · ${row.reason}`)}</p></article>`).join('') : '<p class="sp-muted">Nenhum evento registrado.</p>'}`;
  };
  const renderCompatibility = item => {
    const relations = state.detail?.compatibility || [];
    const available = state.detail?.compatibilityAvailable;
    return `<div class="sp-fields"><div><span>Categoria do suprimento</span><strong>${safe(item.category)}</strong></div><div><span>Regra por categoria</span><strong>Preservada</strong></div></div><p class="sp-muted">A substituição continua limitada à mesma categoria. Relações por modelo são cadastradas explicitamente; ausência de relação não significa incompatibilidade.</p>
      <div class="sp-section-title"><h3>Modelos compatíveis · ${relations.length}</h3>${available && canEdit() ? '<button type="button" class="sp-btn primary" data-sp-action="compat-add">＋ Adicionar modelo</button>' : ''}</div>
      ${available ? relations.length ? `<div class="sp-compat-list">${relations.map(row => `<article class="sp-card sp-compat-card"><div><b>${safe([row.brand, row.model].filter(Boolean).join(' ') || row.model)}</b><small>${safe([row.equipment_category, row.connection_type, row.specification].filter(Boolean).join(' · ') || 'Modelo cadastrado')}</small></div>${canEdit() ? `<div class="sp-card-actions"><button type="button" class="sp-btn" data-sp-action="compat-edit" data-id="${safe(row.id)}">Editar</button><button type="button" class="sp-btn" data-sp-action="compat-remove" data-id="${safe(row.id)}">Inativar</button></div>` : ''}</article>`).join('')}</div>` : '<p class="sp-muted">Nenhum modelo específico informado. Consulte a regra por categoria antes de decidir a instalação.</p>' : `<p class="sp-muted">${state.detail?.compatibilityMissingCatalog ? 'O vínculo de catálogo do Inventário ainda está sendo preparado. Aguarde a atualização automática.' : 'Compatibilidade por modelo indisponível até a migração 074.'} A regra por categoria continua ativa.</p>`}`;
  };
  const renderVariationFields = (variant, inventory) => {
    const health = variations.health(variant);
    const optional = [
      [inventory ? 'Ativos' : 'Instalados', variant.active],
      ['Manutenção', variant.maintenance], ['Defeito', variant.defect], ['Inativo', variant.inactive]
    ].filter(([, count]) => Number(count || 0) > 0)
      .map(([label, count]) => `<span>${label}</span><b>${count}</b>`).join('');
    return `<div class="sp-detail-fields"><span>Marca</span><b>${safe(variant.brand || '—')}</b><span>Modelo</span><b>${safe(variant.model || '—')}</b><span>Total</span><b>${variant.total}</b><span>Estoque disponível</span><b class="sp-stock">${variant.reserve}</b><span>Mínimo</span><b>${variant.minimum_stock}</b><span>Situação</span><b class="sp-variation-health ${health.tone}">${safe(health.label)}</b>${optional}</div>`;
  };
  const renderDetail = () => {
    const item = active();
    if (!item) return '<aside class="sp-detail" tabindex="0" aria-label="Detalhes do suprimento"><div class="sp-empty">Selecione um suprimento na tabela para ver seus detalhes.</div></aside>';
    const inventory = isInventory(item);
    const chosen = selectedVariant(item);
    const tabs = inventory ? [['general','Geral'],['variants','Variações'],['units','Unidades'],['compatibility','Compatibilidade'],['logs','Logs']]
      : [['general','Geral'],['variants','Variações'],...(item.tracking_type === 'unit' ? [['units','Unidades']] : []),['movements','Movimentações'],['compatibility','Compatibilidade'],['logs','Logs']];
    const body = state.activeTab === 'variants' ? renderVariants(item) : state.activeTab === 'units' && (item.tracking_type === 'unit' || inventory) ? renderUnits(item)
      : state.activeTab === 'movements' || state.activeTab === 'logs' ? renderTimeline(state.activeTab)
      : state.activeTab === 'compatibility' ? renderCompatibility(item) : renderGeneral(item);
    const detailFields = chosen
      ? renderVariationFields(chosen, inventory)
      : inventory
      ? `<div class="sp-detail-fields"><span>Categoria</span><b>${safe(item.category)}</b><span>Origem</span><b>Inventário</b><span>Total</span><b>${item.total_units} unidades</b><span>Estoque</span><b class="sp-stock">${item.available_stock} em Reserva</b><span>Indicador</span><b>${item.active_count} Ativos</b><span>Mínimo</span><b>${item.minimum_stock}</b></div>`
      : `<div class="sp-detail-fields"><span>Categoria</span><b>${safe(item.category)}</b><span>Origem</span><b>Suprimentos</b><span>Marca</span><b>${safe(item.brand || '—')}</b><span>Modelo</span><b>${safe(item.model || '—')}</b><span>Estoque</span><b class="sp-stock">${quantityAvailable(item)} disponíveis</b><span>Estoque mínimo</span><b>${item.minimum_stock}</b><span>Local padrão</span><b>${safe(item.default_location)}</b></div>`;
    const overviewButton = chosen ? `<button type="button" class="sp-btn sp-overview" data-sp-action="overview"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 3 2 8l5 5M2 8h12"/></svg><span>Visão geral</span></button>` : '';
    const variationHealth = chosen && variations.health(chosen);
    const situationBadge = variationHealth
      ? `<span class="sp-badge sp-variation-health ${variationHealth.tone}">${safe(variationHealth.label)}</span>`
      : badge(item.stock_status);
    return `<aside class="sp-detail" tabindex="0" aria-label="Detalhes de ${safe(item.name)}"><div class="sp-detail-top"><div>${img(chosen?.image_path || item.image_path,'sp-main-image')}</div><div><div class="sp-detail-title"><h2>${safe(chosen ? `${item.name} · ${chosen.name}` : item.name)}</h2>${canEdit() ? `<details class="sp-variant-menu sp-detail-menu"><summary aria-label="Ações de ${safe(chosen?.name || item.name)}">•••</summary><div class="sp-variant-menu-list"><button data-sp-action="${chosen && !chosen.base ? 'variant-edit' : 'edit'}" ${chosen && !chosen.base ? `data-id="${safe(chosen.id)}"` : ''}>Editar</button>${chosen || inventory ? '' : `<button data-sp-action="active">${item.inactive ? 'Reativar' : 'Inativar'} suprimento</button>${state.integrationReady ? '<button data-sp-action="delete">Excluir</button>' : ''}`}</div></details>` : ''}<button class="sp-icon-btn" data-sp-action="close" aria-label="Fechar painel">×</button></div>${overviewButton}${situationBadge}${detailFields}</div></div><nav class="sp-detail-tabs" aria-label="Abas do suprimento">${tabs.map(([id,label]) => `<button data-sp-tab="${id}" class="${state.activeTab === id ? 'active' : ''}">${label}</button>`).join('')}</nav><div class="sp-detail-body">${state.detail ? body : state.detailError ? `<p class="sp-error" role="alert">${safe(state.detailError)}</p>` : '<p class="sp-muted aldeckot-inline-loading" role="status">Carregando detalhes…</p>'}</div></aside>`;
  };
  const renderHeader = () => `<header class="sp-header">
    <div class="sp-heading module-header-summary">
      <div class="module-header-summary-copy"><h1 class="module-header-summary-title">Suprimentos</h1><p class="module-header-summary-description">Controle de estoque de materiais e consumíveis de TI.</p><div class="module-header-summary-tags"><span>Estoque</span><span>Componentes</span><span>Manutenção</span></div></div>
      <span class="module-header-summary-art supplies" aria-hidden="true"></span>
    </div>
    <div class="sp-header-actions" role="toolbar" aria-label="Ações de Suprimentos">
      <button class="sp-header-action sp-export-action" type="button" data-sp-action="export" title="Exportar em PDF" aria-label="Exportar em PDF"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h4M8.5 14.5h1.2a1.2 1.2 0 0 0 0-2.4H8.5v4.8M12 16.9v-4.8h1.1a2.4 2.4 0 1 1 0 4.8H12ZM16.3 16.9v-4.8h2.5M16.3 14.5h2"/></svg></button>
      <button class="sp-header-action sp-backup-action" type="button" data-sp-action="backup" title="Sistema de backup" aria-label="Sistema de backup"><svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="10.5" cy="5" rx="5.5" ry="2.5"/><path d="M5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.1 0 2.1-.1 3-.4M16 5v5M5 10c0 1.4 2.5 2.5 5.5 2.5S16 11.4 16 10M16.2 17.5l1.8 1.8 3.4-4"/></svg></button>
      <a class="system-header-brand" href="index.html" aria-label="Voltar para a Home do Aldeckot"><span class="system-header-brand-mark" aria-hidden="true"><img class="official-logo-image" src="assets/aldeckot-symbol.png?v=2.0.71" alt=""></span><span class="system-header-brand-copy"><b>Aldeckot</b></span></a>
    </div>
  </header>`;
  const render = () => {
    const mainScroll = app.querySelector('.sp-main')?.scrollTop || 0;
    const detailScroll = app.querySelector('.sp-detail')?.scrollTop || 0;
    app.innerHTML = `${renderHeader()}${state.error ? `<div class="sp-alert" role="alert">${safe(state.error)}</div>` : ''}${state.integrationReady === false ? '<div class="sp-alert" role="status">A integração estrutural aguarda a migração 061 no Supabase. As novas ações de inativação de variação e exclusão ficam indisponíveis até a ativação.</div>' : ''}${state.variantMetadataAvailable === false ? '<div class="sp-alert" role="status">A edição individual dos modelos do Inventário aguarda a migração 064 no Supabase.</div>' : ''}<div class="sp-layout"><section class="sp-main" tabindex="0" aria-label="Lista de suprimentos">${renderTable()}</section>${renderDetail()}</div>`;
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
      const variantMetadata = await api.inventoryVariantMetadata();
      state.variantMetadataAvailable = variantMetadata.available;
      if (variantMetadata.available && canEdit()) {
        const saved = new Set(variantMetadata.rows.map(row => `${row.supply_id}:${row.inventory_variant_key}`));
        const pending = projected.filter(isInventory).filter(row => row.manual_id)
          .flatMap(row => row.inventory_group.variants.filter(variant =>
            !saved.has(`${row.manual_id}:${variant.key}`) && !state.ensuredVariants.has(`${row.manual_id}:${variant.key}`))
            .map(variant => ({ supplyId: row.manual_id, key: variant.key, name: variant.name,
              brand: variant.brand, model: variant.model, sampleId: variant.units[0]?.id })));
        for (let index = 0; index < pending.length; index += 500) {
          const batch = pending.slice(index, index + 500);
          const success = await api.ensureInventoryVariants(batch);
          if (!success) { state.variantMetadataAvailable = false; break; }
          batch.forEach(row => state.ensuredVariants.add(`${row.supplyId}:${row.key}`));
        }
        if (pending.length && state.variantMetadataAvailable) {
          const updated = await api.inventoryVariantMetadata();
          variantMetadata.rows = updated.rows;
        }
      }
      projected = inventoryCatalog.project(manual, groups, variantMetadata.rows);
      state.items = variations.orderItems(projected);
      if (state.selectedId && !active()) { state.selectedId = null; state.selectedVariantId = null; state.detail = null; }
      if (state.selectedVariantId && active() && !selectedVariant(active())) state.selectedVariantId = null;
      render();
      if (!dialogLayer.hidden && dialogLayer.querySelector('[data-sp-alert-list]')) belowMinimumDialog();
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
        ? await (async () => {
          const [supplyLogs, inventoryLogs] = await Promise.all([
            item.manual_id ? api.logs(item.manual_id) : [],
            api.inventoryGroupHistory(item.inventory_group.units.map(unit => unit.id))
          ]);
          return { variants: item.inventory_group.variants, units: item.inventory_group.units,
            movements: [], logs: supplyLogs, inventoryLogs, maintenance: [] };
        })()
        : await api.detail(id);
      const compatibility = await api.compatibility(isInventory(item) ? item.manual_id : id);
      detail.compatibility = compatibility.rows;
      detail.compatibilityAvailable = compatibility.available;
      detail.compatibilityMissingCatalog = Boolean(compatibility.missingCatalog);
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
    dialogLayer.hidden = true; dialogLayer.innerHTML = ''; state.onSubmit = null; state.movementResume = null;
  };
  const field = (label, name, value = '', extra = '') => `<label>${safe(label)}<input name="${name}" value="${safe(value)}" ${extra}></label>`;
  const textArea = (label, name, value = '') => `<label class="full">${safe(label)}<textarea name="${name}">${safe(value)}</textarea></label>`;
  const compatibilityDialog = row => {
    const item = active();
    const supplyId = isInventory(item) ? item?.manual_id : item?.id;
    if (!supplyId || !state.detail?.compatibilityAvailable) throw new Error('A compatibilidade por modelo ainda não está disponível neste item.');
    showDialog(row ? 'Editar modelo compatível' : 'Adicionar modelo compatível', `<p class="sp-muted">Cadastre apenas modelos cuja compatibilidade técnica foi verificada. A regra por categoria permanece independente.</p><div class="sp-form">
      ${field('Categoria do equipamento','equipment_category',row?.equipment_category || '', 'maxlength="120" placeholder="Ex.: Impressoras"')}
      ${field('Marca do equipamento','brand',row?.brand || '', 'maxlength="120" placeholder="Ex.: Samsung"')}
      ${field('Modelo exato *','model',row?.model || '', 'required maxlength="160"')}
      ${field('Tipo de conexão','connection_type',row?.connection_type || '', 'maxlength="120" placeholder="Ex.: HDMI"')}
      ${textArea('Especificação aplicável','specification',row?.specification || '')}</div>`, async form => {
      const data = new FormData(form);
      await api.saveModelCompatibility({ p_supply_id: supplyId, p_id: row?.id || null,
        p_equipment_category: data.get('equipment_category'), p_brand: data.get('brand'),
        p_model: data.get('model'), p_connection_type: data.get('connection_type'),
        p_specification: data.get('specification') });
      notify(row ? 'Compatibilidade atualizada.' : 'Compatibilidade cadastrada.');
    });
  };
  const deactivateCompatibilityDialog = row => {
    if (!row || !state.detail?.compatibilityAvailable) return;
    showDialog('Inativar compatibilidade', `<p>Inativar a relação com <b>${safe([row.brand, row.model].filter(Boolean).join(' '))}</b>? O registro anterior permanecerá no histórico.</p>`, async () => {
      await api.deactivateModelCompatibility(row.id);
      notify('Relação inativada; histórico preservado.');
    });
  };
  const imageFields = row => `<div class="sp-image-editor"><span>Imagem${row.supply_id && !row.image_path ? ' herdada do item principal' : ''}</span>${img(row.image_path || (row.supply_id ? active()?.image_path : null),'sp-edit-image')}<label>Adicionar ou substituir<input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>${row.image_path ? '<label><input type="checkbox" name="remove_image" value="1"> Remover imagem atual</label>' : ''}<div data-sp-preview></div><small>PNG, JPG ou WebP até 5 MB. As variações herdam a imagem principal.</small></div>`;
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
      ${field('Estoque mínimo da base sem variação','minimum_stock',item?.base_minimum_stock ?? item?.minimum_stock ?? 0,'type="number" min="0" required')}
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
  const variantDialog = (variant, resume = null) => {
    const item = active();
    if (isInventory(item)) {
      if (!variant?.metadata_id || !state.variantMetadataAvailable) throw new Error('Aguarde a migração 064 e a sincronização dos modelos.');
      showDialog(`Editar ${variant.name}`, `<p class="sp-muted">Marca, modelo e quantidades vêm do Inventário e são somente leitura.</p><div class="sp-form">${field('Estoque mínimo','minimum_stock',variant.minimum_stock,'type="number" min="0" step="1" required')}</div>${imageFields(variant)}`, async form => {
        const minimum = Number(new FormData(form).get('minimum_stock'));
        if (!Number.isInteger(minimum) || minimum < 0) throw new Error('Informe um mínimo inteiro não negativo.');
        const image = form.querySelector('[name=image]')?.files?.[0];
        const remove = new FormData(form).get('remove_image') === '1';
        if (minimum !== variant.minimum_stock && (image || remove))
          throw new Error('Salve o mínimo e a imagem em operações separadas para evitar uma alteração parcial.');
        if (minimum !== variant.minimum_stock) await api.setInventoryVariantMinimum(variant.id, minimum);
        else if (!await saveEditedImage(form, 'variant', variant.id, variant.image_path))
          throw new Error('Altere o mínimo ou escolha uma imagem.');
        notify('Variação atualizada.');
      });
      hydrateImages(dialogLayer);
      return;
    }
    state.movementResume = resume;
    showDialog(variant ? 'Editar variação' : 'Adicionar variação', `${resume ? '<p class="sp-muted">Depois de salvar, você voltará à entrada com os dados digitados. O estoque só muda quando confirmar a movimentação.</p>' : ''}<div class="sp-form">
      ${field('Marca','brand',variant?.brand ?? item.brand ?? '', 'maxlength="120"')}
      ${field('Modelo','model',variant?.model ?? variant?.name ?? '', 'maxlength="120"')}
      ${field('Estoque mínimo','minimum_stock',variant?.minimum_stock ?? 0,'type="number" min="0" required')}
      ${field('Local físico','location',variant?.location || item.default_location)}
      ${textArea('Características (cor, dimensão, conector...)','description',variant?.description || '')}</div><p class="sp-muted">Modelo ou características são obrigatórios. Alterações que coincidam com outra variação serão recusadas sem mesclar saldos ou histórico.</p>${resume ? '<button class="sp-btn" type="button" data-sp-variant-back>Voltar à entrada</button>' : ''}${variant ? imageFields(variant) : ''}`, async form => {
      const data = new FormData(form);
      const id = await api.saveLocalVariant({ p_id: variant?.id || null, p_supply_id: item.id,
        p_brand: data.get('brand'), p_model: data.get('model'),
        p_description: data.get('description'), p_minimum_stock: Number(data.get('minimum_stock')), p_location: data.get('location') });
      if (variant) await saveEditedImage(form, 'variant', id, variant.image_path);
      const reused = !variant && item.variation_rows?.some(row => row.id === id);
      notify(variant ? 'Variação atualizada.' : reused ? 'Variação existente selecionada; mínimo preservado.' : 'Variação criada.');
      if (resume) return () => reopenMovement(resume, id);
    });
    hydrateImages(dialogLayer);
  };
  const quantityChoices = item => (item.variation_rows || []).filter(row => !row.base && !row.disabled);
  const quantityOptions = (item, term = '', selectedId = '') => {
    const query = term.trim().toLocaleLowerCase('pt-BR');
    const choices = quantityChoices(item).filter(row =>
      [row.name, row.brand, row.model, row.description, row.location].join(' ').toLocaleLowerCase('pt-BR').includes(query));
    const selectedAvailable = selectedId === 'base' || choices.some(row => row.id === selectedId);
    return `<option value=""${selectedAvailable ? '' : ' selected'} disabled>Escolha a variação ou a base</option><option value="base"${selectedId === 'base' ? ' selected' : ''}>Item principal — Base sem variação</option>${choices.map(row => `<option value="${safe(row.id)}"${selectedId === row.id ? ' selected' : ''}>${safe([row.brand, row.model || row.name, row.description].filter(Boolean).join(' · '))} · ${row.reserve} disponíveis</option>`).join('')}${query && !choices.length ? '<option disabled>Nenhuma variação encontrada</option>' : ''}`;
  };
  const updateQuantityBalance = form => {
    const id = form.querySelector('[name=variant_id]')?.value;
    const item = active();
    const row = id === 'base' ? { reserve: Number(item?.quantity_stock || 0) }
      : quantityChoices(item).find(candidate => candidate.id === id);
    const balance = form.querySelector('[data-sp-quantity-balance]');
    if (balance) balance.textContent = row ? `Saldo disponível nesta seleção: ${row.reserve}. A saída não poderá superar esse saldo.` : 'Escolha a base ou uma variação para ver o saldo.';
  };
  const clearQuantityError = form => {
    const error = form?.querySelector('.sp-error');
    if (error) error.textContent = '';
  };
  const quantityReasons = {
    entry: ['Compra / Reabastecimento', 'Devolução', 'Recebimento', 'Transferência recebida', 'Ajuste de inventário', 'Outro'],
    exit: ['Instalação em PDV', 'Substituição por defeito', 'Consumo', 'Envio para manutenção', 'Transferência', 'Descarte / Inativação', 'Ajuste de inventário', 'Outro']
  };
  const reasonOptions = direction => `<option value="">Selecione o motivo</option>${quantityReasons[direction].map(reason => `<option value="${safe(reason)}">${safe(reason)}</option>`).join('')}`;
  const updateOtherReason = form => {
    const other = form.querySelector('[data-sp-reason-other]');
    const input = other?.querySelector('input');
    if (!other || !input) return;
    other.hidden = form.querySelector('[name=reason_choice]').value !== 'Outro';
    input.required = !other.hidden;
    if (other.hidden) input.value = '';
  };
  const quantityDialog = (variant, draft = null) => {
    const item = active();
    if (!item || isInventory(item) || item.tracking_type !== 'quantity' || item.inactive) throw new Error('Movimentação manual indisponível para este item.');
    showDialog(`Movimentar ${item.name}`, `<div class="sp-form">
      <label>Operação<select name="direction" data-sp-quantity-direction><option value="entry">Entrada</option><option value="exit">Saída</option></select></label>
      ${field('Quantidade *','quantity',1,'type="number" min="1" step="1" required')}
      <label class="full">Buscar variação<input type="search" data-sp-variation-search placeholder="Nome, marca, modelo ou característica"></label>
      <label class="full">Destino do estoque<select name="variant_id" data-sp-quantity-variant required>${quantityOptions(item, '', variant?.id || '')}</select></label>
      <p class="sp-muted full" data-sp-quantity-balance></p>
      <button class="sp-btn full" type="button" data-sp-quantity-new-variant>Cadastrar nova variação</button>
      <label class="full">Motivo *<select name="reason_choice" data-sp-reason-choice required>${reasonOptions('entry')}</select></label>
      <label class="full" data-sp-reason-other hidden>Descreva o motivo *<input name="reason_other" maxlength="160" placeholder="Explique o motivo da movimentação"></label>
      <label class="full">Observação adicional<textarea name="observation" maxlength="500" placeholder="Opcional"></textarea></label></div>`, async form => {
      const data = new FormData(form);
      const id = data.get('variant_id');
      if (!id) throw new Error('Escolha a base sem variação ou uma variação existente.');
      const chosen = id === 'base' ? null : quantityChoices(item).find(row => row.id === id);
      if (id !== 'base' && !chosen) throw new Error('A variação selecionada não está disponível.');
      const quantity = Number(data.get('quantity'));
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Informe uma quantidade inteira positiva.');
      const direction = data.get('direction');
      if (direction !== 'entry' && direction !== 'exit') throw new Error('Escolha Entrada ou Saída.');
      const choice = String(data.get('reason_choice') || '');
      if (!quantityReasons[direction].includes(choice)) throw new Error('Escolha um motivo válido para a operação.');
      const other = String(data.get('reason_other') || '').trim();
      if (choice === 'Outro' && other.length < 5) throw new Error('Descreva o motivo em pelo menos 5 caracteres.');
      const observation = String(data.get('observation') || '').trim();
      const reason = `${choice === 'Outro' ? `Outro: ${other}` : choice}${observation ? ` — ${observation}` : ''}`;
      const current = id === 'base' ? Number(item.quantity_stock || 0) : Number(chosen.quantity_stock || 0);
      if (direction === 'exit' && quantity > current) throw new Error('A saída não pode superar o saldo da variação selecionada.');
      await api.adjustQuantity({ p_supply_id: item.id, p_variant_id: chosen?.id || null,
        p_delta: direction === 'exit' ? -quantity : quantity, p_reason: reason });
      notify('Estoque e histórico atualizados.');
    });
    const form = dialogLayer.querySelector('#spActionForm');
    restoreMovementDraft(form, draft);
    updateQuantityBalance(form);
  };
  const unitEntryRow = (index, item, values = {}) => `<fieldset class="sp-unit-entry" data-sp-unit-row><legend>Unidade ${index + 1}</legend>
    <label>TAG ou código físico<input name="unit_code" value="${safe(values.code || '')}" maxlength="100" placeholder="Opcional — ID interno automático"></label>
    <label>Número de série<input name="unit_serial" value="${safe(values.serial || '')}" maxlength="160" placeholder="Opcional"></label>
    <label>Local físico<input name="unit_location" value="${safe(values.location || item.default_location)}" maxlength="160"></label></fieldset>`;
  const prepareUnitRows = form => {
    const item = active();
    const count = Number(form.querySelector('[name=unit_count]')?.value);
    if (!Number.isSafeInteger(count) || count < 1 || count > 50) throw new Error('Informe de 1 a 50 unidades reais.');
    const saved = [...form.querySelectorAll('[data-sp-unit-row]')].map(row => ({
      code: row.querySelector('[name=unit_code]').value,
      serial: row.querySelector('[name=unit_serial]').value,
      location: row.querySelector('[name=unit_location]').value
    }));
    form.querySelector('[data-sp-unit-rows]').innerHTML = Array.from({ length: count }, (_, index) =>
      unitEntryRow(index, item, saved[index])).join('');
    clearQuantityError(form);
  };
  const captureMovementDraft = form => ({
    supplyId: active()?.id,
    kind: form.querySelector('[name=unit_count]') ? 'unit' : 'quantity',
    selectedId: form.querySelector('[name=variant_id]')?.value || '',
    direction: form.querySelector('[name=direction]')?.value || 'entry',
    quantity: form.querySelector('[name=quantity]')?.value || '1',
    unitCount: form.querySelector('[name=unit_count]')?.value || '1',
    units: [...form.querySelectorAll('[data-sp-unit-row]')].map(row => ({
      code: row.querySelector('[name=unit_code]').value,
      serial: row.querySelector('[name=unit_serial]').value,
      location: row.querySelector('[name=unit_location]').value
    })),
    reasonChoice: form.querySelector('[name=reason_choice]')?.value || '',
    reasonOther: form.querySelector('[name=reason_other]')?.value || '',
    observation: form.querySelector('[name=observation]')?.value || ''
  });
  const restoreMovementDraft = (form, draft) => {
    if (!draft) return;
    const set = (name, value) => { const input = form.querySelector(`[name="${name}"]`); if (input) input.value = value; };
    if (draft.kind === 'quantity') {
      set('direction', draft.direction);
      set('quantity', draft.quantity);
      form.querySelector('[data-sp-reason-choice]').innerHTML = reasonOptions(draft.direction);
      form.querySelector('[data-sp-quantity-new-variant]').hidden = draft.direction !== 'entry';
    } else {
      set('unit_count', draft.unitCount);
      const count = Number(draft.unitCount);
      if (Number.isSafeInteger(count) && count >= 1 && count <= 50) prepareUnitRows(form);
      [...form.querySelectorAll('[data-sp-unit-row]')].forEach((row, index) => {
        const unit = draft.units[index];
        if (!unit) return;
        row.querySelector('[name=unit_code]').value = unit.code;
        row.querySelector('[name=unit_serial]').value = unit.serial;
        row.querySelector('[name=unit_location]').value = unit.location;
      });
    }
    set('reason_choice', draft.reasonChoice);
    set('reason_other', draft.reasonOther);
    set('observation', draft.observation);
    updateOtherReason(form);
  };
  const unitDialog = (variantId = state.selectedVariantId, draft = null) => {
    const item = active();
    if (!item || isInventory(item) || item.tracking_type !== 'unit' || item.inactive)
      throw new Error('Entrada manual indisponível para este item.');
    showDialog('Entrada de unidades rastreáveis', `<p class="sp-muted">Cada linha representa uma unidade real. TAG e série são opcionais; um ID interno único será criado pelo banco.</p><div class="sp-form">
      <label>Quantidade *<input name="unit_count" type="number" min="1" max="50" step="1" value="1" required></label>
      <button class="sp-btn" type="button" data-sp-unit-prepare>Preparar unidades</button>
      <label class="full">Buscar variação<input type="search" data-sp-variation-search placeholder="Nome, marca, modelo ou característica"></label>
      <label class="full">Destino do estoque<select name="variant_id" data-sp-quantity-variant required>${quantityOptions(item, '', variantId?.startsWith('base:') ? 'base' : variantId || '')}</select></label>
      <button class="sp-btn full" type="button" data-sp-quantity-new-variant>Cadastrar nova variação</button>
      <div class="sp-unit-rows full" data-sp-unit-rows>${unitEntryRow(0, item)}</div>
      <label class="full">Motivo *<select name="reason_choice" data-sp-reason-choice required>${reasonOptions('entry')}</select></label>
      <label class="full" data-sp-reason-other hidden>Descreva o motivo *<input name="reason_other" maxlength="160" placeholder="Explique o motivo da entrada"></label>
      <label class="full">Observação adicional<textarea name="observation" maxlength="500" placeholder="Opcional"></textarea></label></div>`, async form => {
      const data = new FormData(form);
      const count = Number(data.get('unit_count'));
      const rows = [...form.querySelectorAll('[data-sp-unit-row]')];
      if (!Number.isSafeInteger(count) || count < 1 || count > 50 || rows.length !== count)
        throw new Error('Prepare e identifique todas as unidades informadas antes de confirmar.');
      const variantId = data.get('variant_id');
      if (!variantId || (variantId !== 'base' && !quantityChoices(item).some(row => row.id === variantId)))
        throw new Error('Escolha a base sem variação ou uma variação existente.');
      const choice = String(data.get('reason_choice') || '');
      if (!quantityReasons.entry.includes(choice)) throw new Error('Escolha um motivo válido para a entrada.');
      const other = String(data.get('reason_other') || '').trim();
      if (choice === 'Outro' && other.length < 5) throw new Error('Descreva o motivo em pelo menos 5 caracteres.');
      const observation = String(data.get('observation') || '').trim();
      const reason = `${choice === 'Outro' ? `Outro: ${other}` : choice}${observation ? ` — ${observation}` : ''}`;
      if (reason.length > 500) throw new Error('Resuma motivo e observação em até 500 caracteres.');
      const units = rows.map(row => ({
        code: row.querySelector('[name=unit_code]').value.trim(),
        serialNumber: row.querySelector('[name=unit_serial]').value.trim(),
        location: row.querySelector('[name=unit_location]').value.trim()
      }));
      const result = await api.createUnits({ p_supply_id: item.id, p_variant_id: variantId === 'base' ? null : variantId,
        p_units: units, p_reason: reason });
      state.activeTab = 'units'; notify(result?.legacy
        ? 'Unidade cadastrada. A migração 065 ainda não está ativa; o motivo selecionado não foi registrado.'
        : `${count} unidade${count === 1 ? '' : 's'} cadastrada${count === 1 ? '' : 's'} no estoque disponível.`);
    }, true);
    restoreMovementDraft(dialogLayer.querySelector('#spActionForm'), draft);
  };
  const reopenMovement = (draft, variantId = null) => {
    if (!draft || active()?.id !== draft.supplyId) {
      notify('O suprimento mudou durante o cadastro. Abra a entrada novamente.', true);
      return;
    }
    const selected = variantId || draft.selectedId;
    if (draft.kind === 'unit') unitDialog(selected, draft);
    else quantityDialog(selected ? { id: selected } : null, draft);
  };
  const updateExitPicker = form => {
    const query = form.querySelector('[data-sp-exit-search]')?.value.trim().toLocaleLowerCase('pt-BR') || '';
    const variant = form.querySelector('[data-sp-exit-variant]')?.value || '';
    let visible = 0;
    for (const row of form.querySelectorAll('[data-sp-exit-row]')) {
      row.hidden = Boolean((query && !row.dataset.search.includes(query)) || (variant && row.dataset.variant !== variant));
      if (!row.hidden) visible++;
    }
    form.querySelector('[data-sp-exit-visible]').textContent = `${visible} unidade${visible === 1 ? '' : 's'} encontrada${visible === 1 ? '' : 's'}`;
    form.querySelector('[data-sp-exit-count]').textContent = `${form.querySelectorAll('[name=exit_unit_id]:checked').length} selecionada(s) para saída`;
    clearQuantityError(form);
  };
  const unitExitDialog = () => {
    const item = active();
    if (!item || isInventory(item) || item.tracking_type !== 'unit' || item.inactive)
      throw new Error('Saída manual indisponível para este item. Equipamentos do Inventário são operados na origem.');
    const units = state.detail?.units || [];
    const variants = state.detail?.variants || [];
    const eligible = unit => variations.exitEligible(unit, variants.find(variant => variant.id === unit.variant_id));
    if (!units.some(eligible)) throw new Error('Não há unidades disponíveis para saída.');
    const variantOptions = `<option value="">Todas as variações</option><option value="base"${state.selectedVariantId?.startsWith('base:') ? ' selected' : ''}>Base sem variação</option>${variants.map(row =>
      `<option value="${safe(row.id)}"${state.selectedVariantId === row.id ? ' selected' : ''}>${safe(row.name)}</option>`).join('')}`;
    const rows = units.map(unit => {
      const variant = variants.find(row => row.id === unit.variant_id);
      const variantName = variant?.name || 'Base sem variação';
      const search = [item.name, item.brand, item.model, variantName, unit.code, unit.serial_number,
        unit.id, unit.physical_location].join(' ').toLocaleLowerCase('pt-BR');
      return `<label class="sp-exit-row${eligible(unit) ? '' : ' unavailable'}" data-sp-exit-row data-search="${safe(search)}" data-variant="${safe(unit.variant_id || 'base')}"><input type="checkbox" name="exit_unit_id" value="${safe(unit.id)}" ${eligible(unit) ? '' : 'disabled'}><span><b>${safe(unit.code || unit.serial_number || 'Unidade sem TAG')}</b><small>${safe(variantName)} · Série: ${safe(unit.serial_number || '—')}</small><small>ID: ${safe(unit.id)}</small></span>${badge(unitState(unit))}</label>`;
    }).join('');
    showDialog(`Saída de unidades — ${item.name}`, `<p class="sp-muted">Selecione as unidades físicas disponíveis. A quantidade da saída será exatamente a quantidade marcada (máximo 50). Unidades instaladas, em manutenção, com defeito, inativas ou já retiradas não podem ser selecionadas.</p><div class="sp-form">
      <label class="full">Buscar produto, variação, marca, modelo, TAG, série ou ID<input type="search" data-sp-exit-search placeholder="Digite para localizar uma unidade"></label>
      <label class="full">Variação<select data-sp-exit-variant>${variantOptions}</select></label>
      <div class="sp-exit-summary full"><span data-sp-exit-visible></span><b data-sp-exit-count>0 selecionada(s) para saída</b></div>
      <div class="sp-exit-picker full">${rows}</div>
      <label class="full">Motivo *<select name="reason_choice" data-sp-reason-choice required>${reasonOptions('exit')}</select></label>
      <label class="full" data-sp-reason-other hidden>Descreva o motivo *<input name="reason_other" maxlength="160" placeholder="Explique o motivo da saída"></label>
      <label class="full">Observação adicional<textarea name="observation" maxlength="500" placeholder="Opcional"></textarea></label></div>`, async form => {
      const unitIds = [...form.querySelectorAll('[name=exit_unit_id]:checked')].map(input => input.value);
      if (unitIds.length < 1 || unitIds.length > 50) throw new Error('Selecione de 1 a 50 unidades para saída.');
      if (new Set(unitIds).size !== unitIds.length || unitIds.some(id => !units.find(unit => unit.id === id && eligible(unit))))
        throw new Error('A seleção contém uma unidade indisponível. Atualize os dados e tente novamente.');
      const data = new FormData(form);
      const choice = String(data.get('reason_choice') || '');
      if (!quantityReasons.exit.includes(choice)) throw new Error('Escolha um motivo válido para a saída.');
      const other = String(data.get('reason_other') || '').trim();
      if (choice === 'Outro' && other.length < 5) throw new Error('Descreva o motivo em pelo menos 5 caracteres.');
      const observation = String(data.get('observation') || '').trim();
      const reason = `${choice === 'Outro' ? `Outro: ${other}` : choice}${observation ? ` — ${observation}` : ''}`;
      if (reason.length > 500) throw new Error('Resuma motivo e observação em até 500 caracteres.');
      await api.exitUnits({ p_supply_id: item.id, p_unit_ids: unitIds, p_reason: reason });
      state.activeTab = 'units'; notify(`${unitIds.length} unidade${unitIds.length === 1 ? '' : 's'} retirada${unitIds.length === 1 ? '' : 's'} do estoque.`);
    }, true);
    updateExitPicker(dialogLayer.querySelector('#spActionForm'));
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
  const alertRows = () => {
    const term = state.alertQuery.trim().toLocaleLowerCase('pt-BR');
    const rows = variations.alerts(state.items).filter(row =>
      [row.itemName,row.brand,row.model].join(' ').toLocaleLowerCase('pt-BR').includes(term));
    if (!rows.length) return '<p class="sp-muted">Nenhum modelo abaixo do mínimo para esta busca.</p>';
    const byItem = new Map();
    for (const row of rows) {
      if (!byItem.has(row.itemId)) byItem.set(row.itemId, []);
      byItem.get(row.itemId).push(row);
    }
    return `<div class="sp-alert-table-wrap"><table class="sp-alert-table"><thead><tr><th>Equipamento / modelo</th><th>Marca</th><th>Reserva</th><th>Mínimo</th><th>Faltam</th><th>Situação</th></tr></thead><tbody>${[...byItem.values()].map(group => `<tr class="sp-alert-group"><th colspan="6">${safe(group[0].itemName)}</th></tr>${group.map(row => `<tr><td><button type="button" data-sp-dialog-select="${safe(row.itemId)}" data-sp-dialog-variant="${safe(row.variantId)}">${safe(row.model)}</button></td><td>${safe(row.brand || '—')}</td><td>${row.stock}</td><td>${row.minimum}</td><td class="sp-alert-deficit">${row.missing}</td><td>${row.stock === 0 ? badge('Sem estoque') : badge('Estoque baixo')}</td></tr>`).join('')}`).join('')}</tbody></table></div>`;
  };
  const belowMinimumDialog = () => {
    showDialog('Modelos abaixo do mínimo', `<label class="sp-alert-search">Buscar equipamento, marca ou modelo<input type="search" data-sp-alert-search value="${safe(state.alertQuery)}"></label><div data-sp-alert-list>${alertRows()}</div>`, null, true);
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
    const printBrand = new URL('assets/aldeckot-symbol.png?v=2.0.71', location.href).href;
    const rows = filtered().map(row => `<tr><td>${safe(row.name)}</td><td>${safe(row.category)}</td><td>${quantityAvailable(row)}</td><td>${Number(row.minimum_stock || 0)}</td><td>${Number(row.active_count || 0)}</td><td>${safe(row.stock_status)}</td></tr>`).join('')
      || '<tr><td colspan="6">Nenhum suprimento corresponde aos filtros atuais.</td></tr>';
    const popup = window.open('', '_blank', 'width=1100,height=760');
    if (!popup) { notify('Permita a abertura da janela de impressão para exportar o resumo.', true); return; }
    popup.onload = () => { popup.focus(); popup.print(); };
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Suprimentos — ALDECKOT</title><style>body{font-family:Arial,sans-serif;color:#152c43;padding:28px}h1{margin:0;color:#087998}p{color:#58718a}table{width:100%;border-collapse:collapse;margin-top:22px}th,td{padding:9px;border-bottom:1px solid #c8d8e5;text-align:left;font-size:12px}th{background:#e9f6fb;color:#17617c}@media print{body{padding:10px}thead{display:table-header-group}}.print-brand{display:block;width:54px;height:36px;object-fit:contain;margin-bottom:3px}</style></head><body><img class="print-brand" src="${printBrand}" alt=""><h1>Suprimentos — ALDECKOT</h1><p>Resumo de estoque · ${new Date().toLocaleString('pt-BR')}</p><table><thead><tr><th>Item</th><th>Categoria</th><th>Estoque</th><th>Mínimo</th><th>Indicador</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    popup.document.close();
  };
  app.addEventListener('click', async event => {
    const tab = event.target.closest('[data-sp-tab]');
    if (tab) { state.activeTab = tab.dataset.spTab; state.variantFormOpen = false; render(); return; }
    const inventoryVariant = event.target.closest('[data-sp-variant]');
    if (inventoryVariant && !event.target.closest('[data-sp-action], .sp-variant-menu')) {
      state.selectedVariantId = inventoryVariant.dataset.spVariant; state.unitStatus = ''; state.activeTab = 'variants'; render(); return;
    }
    const page = event.target.closest('[data-sp-page]');
    if (page && !page.disabled) { state.page = Number(page.dataset.spPage); render(); app.querySelector('.sp-main').scrollTop = 0; return; }
    const open = event.target.closest('[data-sp-open], [data-supply-id]');
    if (open) { await select(open.dataset.spOpen || open.dataset.supplyId); return; }
    const button = event.target.closest('[data-sp-action]');
    if (!button) return;
    const action = button.dataset.spAction;
    if (action === 'close') { state.selectedId = null; state.selectedVariantId = null; state.detail = null; history.replaceState(null,'','supplies.html'); render(); return; }
    if (action === 'overview') { state.selectedVariantId = null; state.activeTab = 'variants'; render(); return; }
    if (action === 'export') { exportPdf(); return; }
    if (action === 'backup') { window.AldeckotSuppliesBackup?.open(); return; }
    if (action === 'below-minimum') { state.alertQuery = ''; belowMinimumDialog(); return; }
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
    const variant = isInventory(item) ? item.inventory_group.variants.find(row => row.id === button.dataset.id)
      : (state.detail?.variants || []).find(row => row.id === button.dataset.id);
    const unit = (state.detail?.units || []).find(row => row.id === button.dataset.id);
    try {
      if (action === 'add') itemDialog(null);
      else if (action === 'edit') itemDialog(item);
      else if (action === 'compat-add') compatibilityDialog(null);
      else if (action === 'compat-edit') {
        const relation = state.detail?.compatibility?.find(row => row.id === button.dataset.id);
        if (!relation) throw new Error('Relação alterada. Reabra os detalhes antes de editar.');
        compatibilityDialog(relation);
      }
      else if (action === 'compat-remove') deactivateCompatibilityDialog(state.detail?.compatibility?.find(row => row.id === button.dataset.id));
      else if (action === 'variant-focus') { state.variantFormOpen = true; render(); app.querySelector('#spInlineVariantForm [name=brand]')?.focus(); }
      else if (action === 'variant-cancel') { state.variantFormOpen = false; render(); }
      else if (action === 'variant') variantDialog(null);
      else if (action === 'variant-edit') variantDialog(variant);
      else if (action === 'variant-active') variantActiveDialog(variant);
      else if (action === 'adjust') quantityDialog(variant || (button.dataset.id?.startsWith('base:') ? { id: 'base' } : null));
      else if (action === 'unit') unitDialog();
      else if (action === 'unit-exit') unitExitDialog();
      else if (action === 'unit-edit') unitEditDialog(unit);
      else if (action === 'unit-transition') transitionDialog(unit, button.dataset.status);
      else if (action === 'unit-status') transitionDialog(unit, null);
      else if (action === 'replace') await replaceDialog(unit);
      else if (action === 'unit-history') historyDialog(unit);
      else if (action === 'active') activeDialog(item);
      else if (action === 'delete' && !isInventory(item)) deleteDialog(item);
    } catch (error) { notify(error.message || 'Não foi possível abrir esta ação.', true); }
  });
  app.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key) || !event.target.matches('.sp-variant-card[data-sp-variant]')) return;
    event.preventDefault();
    state.selectedVariantId = event.target.dataset.spVariant;
    state.activeTab = 'variants';
    render();
  });
  app.addEventListener('input', event => {
    if (event.target.matches('[data-sp-search]')) {
      state.query = event.target.value; state.page = 1;
      const cursor = event.target.selectionStart;
      render(); const input = app.querySelector('[data-sp-search]'); input.focus(); input.setSelectionRange(cursor,cursor);
    }
  });
  app.addEventListener('change', event => {
    if (event.target.matches('[data-sp-page-size]')) {
      const size = Number(event.target.value);
      if (!pageSizes.includes(size)) return;
      state.pageSize = size; state.page = 1;
      try { window.localStorage.setItem(pageSizeKey, String(size)); } catch { /* A preferência não impede a navegação. */ }
      render();
      app.querySelector('.sp-main').scrollTop = 0;
      return;
    }
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
      const id = await api.saveLocalVariant({ p_id: null, p_supply_id: active().id,
        p_brand: data.get('brand'), p_model: data.get('model'), p_description: data.get('description'),
        p_minimum_stock: Number(data.get('minimum_stock')), p_location: active().default_location });
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
    if (event.target.closest('[data-sp-unit-prepare]')) {
      try { prepareUnitRows(event.target.closest('form')); }
      catch (error) { event.target.closest('form').querySelector('.sp-error').textContent = error.message; }
      return;
    }
    if (event.target.closest('[data-sp-quantity-new-variant]')) {
      const form = event.target.closest('form');
      if (form.querySelector('[name=direction]')?.value === 'exit') return;
      variantDialog(null, captureMovementDraft(form));
      return;
    }
    if (event.target.closest('[data-sp-variant-back]')) {
      const draft = state.movementResume;
      closeDialog(); reopenMovement(draft);
      return;
    }
    const row = event.target.closest('[data-sp-dialog-select]');
    if (row) { const id = row.dataset.spDialogSelect; const variantId = row.dataset.spDialogVariant; closeDialog();
      select(id).then(() => { state.activeTab = 'variants'; state.selectedVariantId = variantId || null; render(); }); return; }
    if (event.target === dialogLayer || event.target.closest('[data-sp-dialog-close]')) closeDialog();
  });
  dialogLayer.addEventListener('change', event => {
    if (event.target.matches('[data-sp-exit-variant], [name=exit_unit_id]')) {
      updateExitPicker(event.target.form); return;
    }
    if (event.target.matches('[data-sp-quantity-variant]')) {
      updateQuantityBalance(event.target.form); clearQuantityError(event.target.form);
    }
    if (event.target.matches('[data-sp-quantity-direction]')) {
      const create = dialogLayer.querySelector('[data-sp-quantity-new-variant]');
      if (create) create.hidden = event.target.value !== 'entry';
      const reasons = event.target.form.querySelector('[data-sp-reason-choice]');
      if (reasons) { reasons.innerHTML = reasonOptions(event.target.value); updateOtherReason(event.target.form); }
      clearQuantityError(event.target.form);
    }
    if (event.target.matches('[data-sp-reason-choice]')) {
      updateOtherReason(event.target.form); clearQuantityError(event.target.form);
    }
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
    if (event.target.matches('[data-sp-exit-search]')) {
      updateExitPicker(event.target.form); return;
    }
    if (event.target.matches('#spActionForm [name=quantity], #spActionForm [name=reason_other], #spActionForm [name=observation]'))
      clearQuantityError(event.target.form);
    if (event.target.matches('[data-sp-variation-search]')) {
      const select = dialogLayer.querySelector('[data-sp-quantity-variant]');
      if (select) {
        select.innerHTML = quantityOptions(active(), event.target.value, select.value);
        updateQuantityBalance(select.form); clearQuantityError(select.form);
      }
      return;
    }
    if (event.target.matches('[data-sp-alert-search]')) {
      state.alertQuery = event.target.value;
      dialogLayer.querySelector('[data-sp-alert-list]').innerHTML = alertRows();
      return;
    }
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
      const continuation = await state.onSubmit(event.target);
      closeDialog();
      await refresh();
      if (typeof continuation === 'function') {
        try { continuation(); }
        catch (error) { closeDialog(); notify(error.message || 'Abra a entrada novamente.', true); }
      }
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
      window.AldeckotModuleStage?.reveal?.();
      try { state.equipment = await api.equipment(); }
      catch (error) { notify(`Equipamentos temporariamente indisponíveis: ${error.message}`, true); }
      let realtimeTimer;
      api.subscribe(() => {
        clearTimeout(realtimeTimer);
        realtimeTimer = setTimeout(async () => {
          const loadingToken = window.AldeckotLoading?.show?.('Sincronizando Suprimentos…', 160);
          try { await load(); }
          finally {
            if (loadingToken) window.AldeckotLoading?.hide?.(loadingToken);
            window.dispatchEvent(new CustomEvent('aldeckot:realtime-change', { detail: { table: 'supply_units' } }));
          }
        }, 250);
      }).catch(() => {});
    } catch (error) {
      state.error = error.message || 'Não foi possível conectar ao Supabase.';
      state.items = []; render();
      window.AldeckotModuleStage?.reveal?.();
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
