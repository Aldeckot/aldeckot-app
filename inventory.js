(() => {
  const moduleKey = document.body.dataset.module || 'inventory';
  const controlMode = moduleKey === 'control';
  const fluxMode = moduleKey === 'flux';
  const controlBoard = window.AldeckotControlBoard;
  const tableControls = window.AldeckotModuleTableControls;
  const moduleConfig = controlMode ? {
    key: 'control', backupKey: 'controlBackups', title: 'CONTROLE TI', name: 'Controle TI',
    subtitle: 'Aldeckot — Controle de Manutenção', page: 'control.html', backupName: 'Controle TI', backupFile: 'controle-ti', backupModule: 'controle-ti',
    statuses: ['Em manutenção', 'Manutenção concluída', 'Aguardando avaliação', 'Em uso', 'Em sala', 'Descartado', 'Cancelado', 'Verificação concluída'],
    situations: ['Completa', 'Preventiva', 'Regular', 'Não realizada'],
    statusDefault: 'Em manutenção', situationDefault: 'Não realizada', situationLabel: 'Tipo de Limpeza', situationChart: 'Distribuição por Limpeza',
    tablePlaceholder: 'Ex.: Equipamentos da sala de TI', emptyText: 'Selecione uma tabela na lateral', emptyCreateText: 'Crie uma tabela para começar a organizar as manutenções.'
  } : fluxMode ? {
    key: 'flux', backupKey: 'fluxBackups', title: 'FLUX', name: 'Flux',
    subtitle: 'Aldeckot — Envio e Recebimento de Equipamentos', page: 'flux.html', backupName: 'Flux', backupFile: 'flux', backupModule: 'flux',
    statuses: ['Pendente', 'Recebido', 'Entregue', 'Em Trânsito'],
    situations: ['Manutenção', 'Troca', 'Aquisição', 'Transferência', 'Substituição'],
    movements: ['Envio', 'Recebimento'], shippingTypes: ['Motoboy', 'Caminhão', 'Transporte Interno', 'Outro'],
    statusDefault: 'Pendente', situationDefault: 'Manutenção', movementDefault: 'Envio', shippingDefault: 'Motoboy', situationLabel: 'Motivo', situationChart: 'Distribuição por Motivo',
    tablePlaceholder: 'Ex.: Transferências entre unidades', emptyText: 'Selecione uma tabela na lateral', emptyCreateText: 'Crie uma tabela para organizar os envios e recebimentos.'
  } : {
    key: 'inventory', backupKey: 'backups', title: 'INVENTÁRIO', name: 'Inventário',
    subtitle: 'Aldeckot — Controle de Equipamentos', page: 'inventory.html', backupName: 'Inventário', backupFile: 'inventario', backupModule: 'inventario',
    statuses: ['Ativo', 'Reserva', 'Manutenção', 'Troca', 'Defeito', 'Atenção'], situations: ['Normal', 'Atenção', 'Substituído', 'Verificando'], cleanings: ['Completa', 'Preventiva', 'Regular', 'Não realizada'],
    statusDefault: 'Ativo', situationDefault: 'Normal', situationLabel: 'Situação', situationChart: 'Distribuição por Situação',
    tablePlaceholder: 'Ex.: Equipamentos TI, Estoque…', emptyText: 'Selecione uma tabela na lateral', emptyCreateText: 'Crie uma tabela para começar a organizar os equipamentos.'
  };
  const moduleHeader = controlMode ? {
    title: 'Controle TI', description: 'Central de manutenção e gestão de equipamentos',
    tags: ['Manutenção', 'Chamados', 'Equipe'], art: 'control'
  } : fluxMode ? {
    title: 'Flux', description: 'Envio e recebimento de equipamentos.',
    tags: ['Transferência', 'Recebimento', 'Histórico'], art: 'flux'
  } : {
    title: 'Inventário', description: 'Controle de equipamentos, patrimônio e localização.',
    tags: ['Patrimônio', 'Localização', 'Status'], art: 'inventory'
  };
  const statuses = moduleConfig.statuses;
  let inventoryIntegrationReady = false;
  const situations = moduleConfig.situations;
  const cleanings = moduleConfig.cleanings || [];
  const priorities = ['Alta', 'Média', 'Estável'];
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const clone = value => JSON.parse(JSON.stringify(value));
  const stamp = () => new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const dateValue = value => value ? new Date(`${value}T12:00`).toLocaleDateString('pt-BR') : '—';
  const dateTimeValue = value => value && Number.isFinite(typeof value === 'number' ? value : Date.parse(value))
    ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short',
      timeZone: 'America/Sao_Paulo' }) : '—';
  const fluxLocalDay = instant => window.AldeckotFluxCycles.localDay(instant);
  let data = { tables: [] };
  let backupMeta = { availability: 'loading', last: null, lastAt: null, lastSource: null, automatic: false, frequencyDays: 7, history: [] };
  let pendingRestore = null;
  let backupBusy = false;
  let initialized = false;
  let backupMetaLoadedAt = 0;
  let backupMetaRequest = null;
  let reloadSequence = 0;
  let emptyPresentationCache;
  const branchModel = window.AldeckotInventoryBranches;
  const moduleRoute = new URLSearchParams(window.location.search);
  let state = { active: moduleRoute.get('table'), overview: ['overview', 'operations'].includes(moduleRoute.get('view')), branchId: null, addMenu: false, pendingItemId: moduleRoute.get('item'), query: '', status: '', situation: '', operation: moduleRoute.get('operation') || '', sidebarOpen: false, tableMenu: null, tableMenuPosition: null, tableActionMenu: false, itemActionMenu: false };
  const globalState = { view: 'recent', query: '', category: '', status: '', situation: '', order: 'recent', page: 1, pageSize: 25, overview: null, result: null, busy: false };
  const controlOperational = { tab: 'overview', query: '', status: '', priority: '',
    page: 1, pageSize: 25, dashboard: null, listing: null,
    report: null, reportFilters: { maintenanceMode: 'all' },
    busy: false, error: '', legacy: false };
  let controlCaseDetailUnavailable = false;
  let controlOperationalSequence = 0;
  let controlOperationalSearchTimer;
  let globalRequestSequence = 0;
  let globalSearchTimer;
  let categoryRequestSequence = 0;
  let categorySearchTimer;

  const readBackupMeta = () => ({ ...backupMeta });
  const writeBackupMeta = value => { backupMeta = { ...backupMeta, ...value }; };
  const backend = () => window.AldeckotSupabase;
  const canManage = () => Boolean(window.AldeckotAuth?.isAdmin);
  const moduleApi = () => backend()?.[moduleConfig.key];
  const backupApi = () => backend()?.[moduleConfig.backupKey];
  const pageSizes = controlMode ? [6, 10, 25, 50, 100] : [10, 25, 50, 100];
  const pageSizeKey = `aldeckot:${moduleConfig.key}:page-size`;
  const savedPageSize = (() => {
    try { return Number(window.localStorage.getItem(pageSizeKey)); } catch { return 0; }
  })();
  state.page = 1;
  state.pageSize = pageSizes.includes(savedPageSize) ? savedPageSize : controlMode ? 6 : 25;
  const moduleHeaderSummaryMarkup = () => `<div class="inventory-heading module-header-summary module-header-summary-${moduleHeader.art}"><div class="module-header-summary-copy"><h1 class="module-header-summary-title">${moduleHeader.title}</h1><p class="module-header-summary-description">${moduleHeader.description}</p><div class="module-header-summary-tags">${moduleHeader.tags.map(tag => `<span>${tag}</span>`).join('')}</div></div><span class="module-header-summary-art ${moduleHeader.art}" aria-hidden="true"></span></div>`;
  async function showModuleHome() {
    const previous = { ...state };
    Object.assign(state, { active: null, overview: true, sidebarOpen: false, branchId: null,
      page: 1, query: '', status: '', situation: '', tableActionMenu: false });
    if (controlMode) controlOperational.tab = 'overview';
    if (!controlMode && !fluxMode) {
      try {
        if (!await reloadGlobal()) { state = previous; return; }
      } catch (error) {
        state = previous;
        window.AldeckotMessage.show(backendMessage(error));
        return;
      }
    }
    renderInventory();
    if (controlMode) void refreshControlOperational();
  }
  const backendMessage = error => {
    const message = error?.message || 'Não foi possível comunicar com o Supabase.';
    if (controlMode && /control_(items|item_logs|backups|backup_settings)/i.test(message)) return 'O banco ainda não possui a estrutura do Controle TI. Execute o arquivo supabase/003_control_ti.sql no SQL Editor do Supabase.';
    if (fluxMode && /flux_(items|item_logs|backups|backup_settings)/i.test(message)) return 'O banco ainda não possui a estrutura do Flux. Execute o arquivo supabase/008_flux.sql no SQL Editor do Supabase.';
    if (!controlMode && /cleaning_type/i.test(message)) return 'O banco ainda não possui o campo de Limpeza do Inventário. Execute o arquivo supabase/006_inventory_cleaning.sql no SQL Editor do Supabase.';
    if (!controlMode && !fluxMode && /inventory_global_|inventory_branch_memberships|inventory_branch_share_/i.test(message)) return 'A visão global e o compartilhamento exigem a migração 080. Aplique-a após backup e validação em homologação.';
    if (!controlMode && !fluxMode && /inventory_branches|inventory_branch_|inventory_swap_locations|branch_id/i.test(message)) return 'As ramificações ainda não estão disponíveis nesta base. Aplique a migração 079 após backup e validação em homologação.';
    return message;
  };
  const clean = value => String(value ?? '').trim();
  const comparable = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const normalizeStatus = value => {
    const source = comparable(value);
    if (controlMode) {
      if (source.includes('verifica') && source.includes('conclu')) return 'Verificação concluída';
      if (source.includes('conclu')) return 'Manutenção concluída';
      if (source.includes('aguard') || source.includes('avali')) return 'Aguardando avaliação';
      if (source.includes('em uso') || source === 'uso') return 'Em uso';
      if (source.includes('sala')) return 'Em sala';
      if (source.includes('descart')) return 'Descartado';
      return 'Em manutenção';
    }
    if (fluxMode) {
      if (source.includes('recebid')) return 'Recebido';
      if (source.includes('entreg')) return 'Entregue';
      if (source.includes('transit')) return 'Em Trânsito';
      return 'Pendente';
    }
    if (source.includes('manut')) return 'Manutenção';
    if (source.includes('reserva')) return 'Reserva';
    if (source.includes('troca') || source.includes('inativ') || source.includes('substitu')) return inventoryIntegrationReady ? 'Inativo' : 'Troca';
    if (source.includes('defeito') || source.includes('queb')) return 'Defeito';
    if (source.includes('atenc')) return 'Atenção';
    return 'Ativo';
  };
  const normalizeSituation = value => {
    const source = comparable(value);
    if (controlMode) {
      if (source.includes('complet')) return 'Completa';
      if (source.includes('prevent')) return 'Preventiva';
      if (source.includes('regular')) return 'Regular';
      return 'Não realizada';
    }
    if (fluxMode) {
      if (source.includes('troca')) return 'Troca';
      if (source.includes('aquis')) return 'Aquisição';
      if (source.includes('transfer')) return 'Transferência';
      if (source.includes('substit')) return 'Substituição';
      return 'Manutenção';
    }
    if (source.includes('atenc')) return 'Atenção';
    if (source.includes('substitu')) return 'Substituído';
    if (source.includes('verific')) return 'Verificando';
    return 'Normal';
  };
  const normalizeCleaning = value => {
    const source = comparable(value);
    if (source.includes('complet')) return 'Completa';
    if (source.includes('prevent')) return 'Preventiva';
    if (source.includes('regular')) return 'Regular';
    return 'Não realizada';
  };
  const matchesOperation = item => {
    const status = comparable(item.status);
    if (state.operation === 'inventory-active') return status === 'ativo';
    if (state.operation === 'maintenance-open') return status === 'em manutencao' || status === 'manutencao' || status === 'defeito';
    if (state.operation === 'transfers-open') return status === 'pendente' || status === 'em transito';
    return true;
  };
  const searchIndex = new WeakMap();
  const searchable = item => {
    if (!searchIndex.has(item)) searchIndex.set(item, [item.equipment, item.tag, item.model, item.brand, item.serial, item.sector, item.location, item.status, item.situation, item.cleaning, item.priority, item.notes].map(comparable).join(' '));
    return searchIndex.get(item);
  };
  const matchesActiveFilters = item => (controlMode || fluxMode
    ? JSON.stringify(item).toLowerCase().includes(state.query.toLowerCase())
    : searchable(item).includes(comparable(state.query)))
    && (!state.status || item.status === state.status)
    && (!state.situation || item.situation === state.situation)
    && matchesOperation(item);
  const normalizeLogs = logs => (Array.isArray(logs) ? logs : []).map(logEntry => {
    if (typeof logEntry === 'string') return { at: 'Backup antigo', text: logEntry };
    return {
      at: clean(logEntry?.timestamp || logEntry?.at || logEntry?.date || 'Backup antigo'),
      text: clean(logEntry?.action || logEntry?.text || logEntry?.message || 'Registro restaurado do backup antigo.')
    };
  });
  const normalizeFluxMovement = value => comparable(value).includes('receb') ? 'Recebimento' : 'Envio';
  const normalizeFluxShipping = value => {
    const source = comparable(value);
    if (source.includes('caminh')) return 'Caminhão';
    if (source.includes('moto')) return 'Motoboy';
    if (source.includes('intern')) return 'Transporte Interno';
    return 'Outro';
  };
  const normalizeFluxDate = (...values) => {
    const date = values.map(clean).find(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (date) return date;
    const timestamp = values.map(value => Number(value)).find(value => Number.isFinite(value) && value > 946684800000);
    return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  };
  function normalizeImportedBackup(payload) {
    const root = payload?.data || payload;
    const declaredModule = payload?.module || payload?.moduleName;
    const validModule = value => controlMode
      ? ['controle-ti', 'controleti', 'control'].includes(comparable(value))
      : fluxMode
        ? ['flux', 'movimentacao', 'movimentacoes'].includes(comparable(value))
        : ['inventario', 'inventory'].includes(comparable(value));
    if (declaredModule && !validModule(declaredModule)) throw new Error('Backup pertence a outro módulo');
    if (Array.isArray(root?.tables)) return { data: { tables: root.tables }, legacy: false };
    if (fluxMode) {
      if (!Array.isArray(root?.fluxTables)) throw new Error('Formato inválido');
      return {
        legacy: true,
        data: {
          tables: root.fluxTables.map((legacyTable, index) => ({
            id: `legacy-flux-table-${legacyTable.id || index}`,
            name: clean(legacyTable.nome || legacyTable.name || `Tabela ${index + 1}`),
            icon: '📁',
            items: (Array.isArray(legacyTable.items) ? legacyTable.items : []).map((legacyItem, itemIndex) => ({
              id: `legacy-flux-item-${legacyItem.id || `${index}-${itemIndex}`}`,
              movement: normalizeFluxMovement(legacyItem.tipo || legacyItem.movement),
              equipment: clean(legacyItem.equipamento || legacyItem.equipment || 'Equipamento sem nome'),
              model: clean(legacyItem.modelo || legacyItem.model || 'Não informado'),
              brand: clean(legacyItem.marca || legacyItem.brand || 'Não informado'),
              serial: clean(legacyItem.numeroSerie || legacyItem.numero_série || legacyItem.serial || 'Não informado'),
              tag: clean(legacyItem.tag || 'Não informado'),
              senderCompany: clean(legacyItem.empresaOrigem || legacyItem.senderCompany || 'Não informado'),
              destinationCompany: clean(legacyItem.empresaDestino || legacyItem.destinationCompany || 'Não informado'),
              senderResponsible: clean(legacyItem.responsavelEnvio || legacyItem.senderResponsible || 'Não informado'),
              receiverResponsible: clean(legacyItem.responsavelRecebimento || legacyItem.receiverResponsible || 'Não informado'),
              sendDate: normalizeFluxDate(legacyItem.dataEnvio || legacyItem.sendDate, legacyItem.dataRecebimento || legacyItem.receivedDate, legacyItem.timestamp, payload?.timestamp),
              receivedDate: normalizeFluxDate(legacyItem.dataRecebimento || legacyItem.receivedDate, legacyItem.dataEnvio || legacyItem.sendDate, legacyItem.timestamp, payload?.timestamp),
              shippingType: normalizeFluxShipping(legacyItem.tipoEnvio || legacyItem.shippingType),
              situation: normalizeSituation(legacyItem.motivo || legacyItem.reason || legacyItem.situation),
              status: normalizeStatus(legacyItem.status),
              notes: clean(legacyItem.observacao || legacyItem.observacoes || legacyItem.notes),
              logs: normalizeLogs(legacyItem.logs)
            }))
          }))
        }
      };
    }
    if (controlMode) {
      if (!Array.isArray(root?.controleTITables)) throw new Error('Formato inválido');
      return {
        legacy: true,
        data: {
          tables: root.controleTITables.map((legacyTable, index) => ({
            id: `legacy-control-table-${legacyTable.id || index}`,
            name: clean(legacyTable.nome || legacyTable.name || `Tabela ${index + 1}`),
            icon: '📁',
            items: (Array.isArray(legacyTable.items) ? legacyTable.items : []).map((legacyItem, itemIndex) => ({
              id: `legacy-control-item-${legacyItem.id || `${index}-${itemIndex}`}`,
              equipment: clean(legacyItem.equipamento || legacyItem.equipment || 'Equipamento sem nome'),
              model: clean(legacyItem.modelo || legacyItem.model || 'Não informado'),
              brand: clean(legacyItem.marca || legacyItem.brand),
              serial: clean(legacyItem.numeroSerie || legacyItem.numero_série || legacyItem.serial),
              tag: clean(legacyItem.tag),
              sector: clean(legacyItem.setor || legacyItem.sector),
              entryDate: clean(legacyItem.dataEntrada || legacyItem.entryDate),
              exitDate: clean(legacyItem.dataSaida || legacyItem.exitDate),
              status: normalizeStatus(legacyItem.status),
              situation: normalizeSituation(legacyItem.tipoLimpeza || legacyItem.cleaningType || legacyItem.situation),
              notes: clean(legacyItem.observacao || legacyItem.observacoes || legacyItem.notes),
              logs: normalizeLogs(legacyItem.logs)
            }))
          }))
        }
      };
    }
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
            cleaning: normalizeCleaning(legacyItem.tipoLimpeza || legacyItem.cleaningType || legacyItem.cleaning),
            notes: clean(legacyItem.observacoes || legacyItem.notes),
            logs: normalizeLogs(legacyItem.logs)
          }))
        }))
      }
    };
  }

  const globalFilters = () => ({
    query: globalState.query, category: globalState.category, status: globalState.status,
    situation: globalState.situation, order: globalState.order, page: globalState.page,
    pageSize: globalState.pageSize
  });
  const categoryFilters = () => ({
    category: state.active, branchId: state.branchId, query: state.query,
    status: state.status, situation: state.situation,
    page: state.page, pageSize: state.pageSize, order: 'recent'
  });
  const globalListingActive = () => globalState.view === 'all' || Boolean(globalState.query.trim());
  function refreshModuleBackupMeta() {
    if (backupMetaRequest) return backupMetaRequest;
    if (Date.now() - backupMetaLoadedAt < 30000) return;
    const api = backupApi();
    backupMetaRequest = (async () => {
      const [setting, history] = await Promise.all([api.settings(), api.list()]);
      let latest = history[0] || null;
      const frequencyDays = Math.max(1, Number(setting.frequency_days || 7));
      if (canManage() && setting.automatic &&
        (!latest || Date.now() - new Date(latest.created_at).getTime() >= frequencyDays * 86400000)) {
        const snapshot = controlMode || fluxMode ? data : await moduleApi().load();
        latest = await api.create(clone(snapshot), `Backup automático do ${moduleConfig.backupName}`, 'automatic');
      }
      writeBackupMeta({
        availability: 'ready',
        last: latest?.created_at ? new Date(latest.created_at).toLocaleString('pt-BR') : null,
        lastAt: latest?.created_at || null,
        lastSource: latest?.source || null,
        automatic: setting.automatic, frequencyDays,
        history: latest ? [latest, ...history.filter(entry => entry.id !== latest.id)].slice(0, 3) : []
      });
    })().catch(error => {
      console.warn('Não foi possível consultar ou atualizar o backup em rede.', error);
      writeBackupMeta({ availability: 'unavailable' });
    }).finally(() => {
      backupMetaLoadedAt = Date.now();
      backupMetaRequest = null;
      if (!backupBusy && document.querySelector('[data-inv-backup-availability]')) backupModal();
    });
    return backupMetaRequest;
  }

  async function reloadGlobal() {
    const request = ++reloadSequence;
    ++globalRequestSequence;
    await (window.AldeckotAuthReady || Promise.resolve());
    if (!window.AldeckotAuth?.session) return false;
    await backend().init();
    const [categories, overview, page] = await Promise.all([
      moduleApi().globalCategories(), moduleApi().globalOverview(),
      globalListingActive() ? moduleApi().globalPage(globalFilters()) : Promise.resolve(null)
    ]);
    if (request !== reloadSequence) return false;
    data = { tables: categories.map(table => ({
      id: table.id, name: table.name, icon: table.icon, items: [], branches: [], itemsLoaded: false
    })) };
    globalState.overview = overview;
    globalState.result = page || { items: overview.recent || [], total: overview.total || 0, page: 1 };
    void refreshModuleBackupMeta();
    initialized = true;
    return true;
  }

  async function reloadInventory(categorySelection) {
    const categoryId = categorySelection || state.active;
    if (!controlMode && !fluxMode && !categoryId) return reloadGlobal();
    const request = ++reloadSequence;
    await (window.AldeckotAuthReady || Promise.resolve());
    if (!window.AldeckotAuth?.session) return;
    const api = backend();
    if (!api) throw new Error('Cliente Supabase não foi carregado.');
    await api.init();
    let nextData;
    if (!controlMode && !fluxMode) {
      const filters = categorySelection
        ? { ...categoryFilters(), category: categoryId, branchId: null, page: 1 } : categoryFilters();
      const [categories, branches, page] = await Promise.all([
        moduleApi().globalCategories(), moduleApi().categoryBranches(categoryId),
        moduleApi().categoryPage(filters)
      ]);
      if (request !== reloadSequence) return false;
      if (!categories.some(table => table.id === categoryId)) {
        if (categorySelection) throw new Error('Esta categoria não está mais disponível.');
        state.active = null;
        state.sidebarOpen = true;
        return reloadGlobal();
      }
      nextData = { tables: categories.map(category => category.id === categoryId
        ? { ...category, items: page.items, pageItems: page.items, total: Number(page.total || 0), branches, itemsLoaded: true }
        : { ...category, items: [], branches: [], itemsLoaded: false }) };
    } else nextData = await moduleApi().load();
    if (request !== reloadSequence) return false;
    if (categorySelection) {
      ++categoryRequestSequence;
      Object.assign(state, { active: categoryId, branchId: null, page: 1, addMenu: false,
        tableActionMenu: false, tableMenu: null, tableMenuPosition: null });
    }
    data = nextData;
    if ((controlMode || fluxMode) && !initialized && !state.active && state.pendingItemId) {
      const requestedItem = data.tables.find(table => table.items.some(item => item.id === state.pendingItemId));
      if (requestedItem) {
        state.active = requestedItem.id;
        state.sidebarOpen = false;
      }
    }
    void refreshModuleBackupMeta();
    // A área de trabalho só deve carregar depois que a pessoa escolher uma tabela.
    // Mantemos a seleção atual em atualizações, mas nunca escolhemos a primeira tabela automaticamente.
    if (state.active && !data.tables.some(table => table.id === state.active)) {
      state.active = null;
      state.sidebarOpen = true;
    }
    if (state.branchId && !activeTable()?.branches?.some(branch => branch.id === state.branchId)) state.branchId = null;
    initialized = true;
    return true;
  }

  function renderConnectionState(title, message, reveal = false) {
    document.body.classList.remove('home-page');
    document.body.classList.add('inventory-open');
    $('#app').innerHTML = `<div class="inventory-shell"><section class="inventory-panel inventory-empty-state"><div><div class="empty-cubes">◇ ◇</div><h2>${escape(title)}</h2><p>${escape(message)}</p><button data-inv-action="retry">Tentar novamente</button></div></section></div>`;
    if (reveal) window.AldeckotModuleStage?.reveal?.();
  }

  const activeTable = () => data.tables.find(table => table.id === state.active) || null;
  const imageCatalog = window.AldeckotInventoryImages;
  const imageKey = imageCatalog?.modelKey || (() => '');
  let sharedImageCatalog = imageCatalog?.build?.() || new Map();
  const signedImageUrls = new Map();
  let sharedImagesLoadedAt = 0;
  let sharedImagesRequest = null;
  let currentSimulationReport = null;
  async function imageMetadataPages(query) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await query(offset, offset + 499);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 500) return rows;
    }
  }
  async function applySharedImages() {
    if (controlMode || fluxMode || !imageCatalog || !document.querySelector('[data-inv-image-key]')) return;
    if (sharedImagesRequest) return sharedImagesRequest.then(() => applySharedImages());
    sharedImagesRequest = (async () => {
      if (Date.now() - sharedImagesLoadedAt > 60000) {
        const db = (await backend().init()).client;
        const [supplies, variants] = await Promise.all([
          imageMetadataPages((from, to) => db.from('supplies')
            .select('id,name,category,brand,model,inventory_group_key,image_path').order('id').range(from, to)),
          imageMetadataPages((from, to) => db.from('supply_variants')
            .select('id,supply_id,inventory_brand,inventory_model,inventory_variant_key,image_path')
            .not('image_path', 'is', null).order('id').range(from, to))
        ]);
        sharedImageCatalog = imageCatalog.build(supplies, variants);
        sharedImagesLoadedAt = Date.now();
      }
      await Promise.all([...document.querySelectorAll('[data-inv-image-key]')].map(async node => {
        const path = imageCatalog.pathForKey(sharedImageCatalog, node.dataset.invImageKey);
        if (!path) {
          node.removeAttribute('src');
          node.hidden = true;
          if (node.previousElementSibling) node.previousElementSibling.hidden = false;
          return;
        }
        let promise = signedImageUrls.get(path);
        if (!promise) {
          promise = Promise.resolve(window.AldeckotSupplies?.imageUrl(path) || backend().init().then(({ client }) =>
            client.storage.from('supply-images').createSignedUrl(path, 3600).then(result => {
              if (result.error) throw result.error;
              return result.data?.signedUrl || '';
            })));
          signedImageUrls.set(path, promise);
          window.setTimeout(() => {
            if (signedImageUrls.get(path) === promise) signedImageUrls.delete(path);
          }, 55 * 60 * 1000);
        }
        let url;
        try { url = await promise; }
        catch (error) {
          if (signedImageUrls.get(path) === promise) signedImageUrls.delete(path);
          console.warn('Imagem do modelo indisponível:', error);
          return;
        }
        if (node.isConnected && url) {
          if (node.getAttribute('src') === url && !node.hidden) return;
          node.onload = () => { node.hidden = false; if (node.previousElementSibling) node.previousElementSibling.hidden = true; };
          node.onerror = () => { node.hidden = true; if (node.previousElementSibling) node.previousElementSibling.hidden = false; };
          node.src = url;
          if (node.complete && node.naturalWidth) node.onload();
        }
      }));
    })().catch(error => console.warn('Imagens compartilhadas indisponíveis:', error))
      .finally(() => { sharedImagesRequest = null; });
    return sharedImagesRequest;
  }
  const scopedItems = table => {
    const items = !controlMode && !fluxMode && table?.pageItems ? table.pageItems : (table?.items || []);
    return !controlMode && !fluxMode && state.branchId
      ? items.filter(item => branchModel.inBranch(table, item, state.branchId)) : items;
  };
  const filteredControlItems = table => scopedItems(table)
    .filter(item => controlBoard.matches(item, state) && matchesOperation(item));
  const selectedBranch = table => table?.branches?.find(branch => branch.id === state.branchId) || null;
  const className = value => String(value || '').toLowerCase().replaceAll(' ', '-');
  const choiceTone = (kind, value) => {
    if (kind === 'priority') return ({ Alta: 'red', 'Média': 'yellow', 'Estável': 'turquoise' })[value] || 'turquoise';
    if (kind === 'cleaning') return ({ Completa: 'green', Preventiva: 'blue', Regular: 'yellow', 'Não realizada': 'red' })[value] || 'blue';
    if (controlMode) return ({
      status: { 'Em manutenção': 'red', 'Manutenção concluída': 'green', 'Aguardando avaliação': 'yellow', 'Em uso': 'blue', 'Em sala': 'turquoise', Descartado: 'gray', Cancelado: 'gray' },
      situation: { Completa: 'green', Preventiva: 'blue', Regular: 'yellow', 'Não realizada': 'red' }
    }[kind]?.[value] || 'blue');
    if (fluxMode) return ({
      status: { Pendente: 'yellow', Recebido: 'turquoise', Entregue: 'green', 'Em Trânsito': 'blue' },
      situation: { Manutenção: 'red', Troca: 'purple', Aquisição: 'green', Transferência: 'blue', Substituição: 'orange' },
      movement: { Envio: 'orange', Recebimento: 'turquoise' },
      shipping: { Motoboy: 'purple', Caminhão: 'orange', 'Transporte Interno': 'turquoise', Outro: 'gray' }
    }[kind]?.[value] || 'blue');
    return ({
      status: { Ativo: 'green', 'Manutenção': 'red', Reserva: 'yellow', Troca: 'purple', Inativo: 'gray', Defeito: 'orange', 'Atenção': 'purple' },
      situation: { Normal: 'turquoise', 'Atenção': 'yellow', 'Substituído': 'blue', Verificando: 'purple' }
    }[kind]?.[value] || 'blue');
  };
  const chartToneColors = { green: '#36dc76', yellow: '#ffd34e', red: '#ff6874', blue: '#57a6ff', turquoise: '#35d8c8', purple: '#b56fff', orange: '#ff963d', gray: '#aeb7c6' };
  const chartColor = (field, value) => chartToneColors[choiceTone(field === 'status' ? 'status' : 'situation', value)] || chartToneColors.blue;
  const countBy = (items, values, field) => Object.fromEntries(values.map(value => [value, items.filter(item => item[field] === value).length]));
  const cleaningPill = value => value
    ? `<span class="cleaning-pill" data-cleaning="${escape(value)}">${escape(value)}</span>`
    : '—';
  const log = (item, text) => { item.logs = item.logs || []; item.logs.unshift({ at: stamp(), text }); };

  function chart(title, items, field, values, prefix = '') {
    const counts = countBy(items, values, field);
    return chartWithCounts(title, counts, field, values, prefix);
  }
  function chartWithCounts(title, counts, field, values, prefix = '', colorFor = value => chartColor(field, value), barHeight = 116) {
    if (field === 'situation' && !controlMode && !fluxMode) return inventorySituationPie(title, counts, values, prefix, colorFor);
    const max = Math.max(1, ...Object.values(counts));
    return `<section class="inventory-panel inventory-chart"><h3>${title}</h3><div class="inventory-chart-stage">${values.map(value => `<div class="inventory-chart-bar ${prefix}${className(value)}" style="--chart-color:${colorFor(value)};height:${Math.max(4, Math.round(((counts[value] || 0) / max) * barHeight))}px" title="${escape(value)}: ${counts[value] || 0}"></div>`).join('')}</div><div class="inventory-legend">${values.map(value => `<span class="${prefix}${className(value)}" style="--chart-color:${colorFor(value)}"><i></i><em>${escape(value)}</em><b>${counts[value] || 0}</b></span>`).join('')}</div></section>`;
  }
  function inventorySituationPie(title, counts, values, prefix, colorFor) {
    const total = values.reduce((sum, value) => sum + (Number(counts[value]) || 0), 0);
    let current = 0;
    const slices = values.filter(value => Number(counts[value]) > 0).map(value => {
      const start = current;
      current += (Number(counts[value]) / total) * 100;
      return `${colorFor(value)} ${start}% ${current}%`;
    });
    const background = slices.length ? `conic-gradient(${slices.join(',')})` : 'conic-gradient(#526b84 0% 100%)';
    const description = values.map(value => `${value}: ${Number(counts[value]) || 0}`).join(', ');
    return `<section class="inventory-panel inventory-chart inventory-pie-chart"><h3>${title}</h3><div class="inventory-pie-layout"><div class="inventory-pie-visual" role="img" aria-label="${escape(`${title}. ${description}`)}" style="background:${background}"><span class="inventory-pie-sheen" aria-hidden="true"></span></div><div class="inventory-legend inventory-pie-legend">${values.map(value => `<span class="${prefix}${className(value)}" style="--chart-color:${colorFor(value)}"><i></i><em>${escape(value)}</em><b>${Number(counts[value]) || 0}</b></span>`).join('')}</div></div></section>`;
  }
  function inventorySituationSummary(title, counts, values, colorFor) {
    const max = Math.max(1, ...values.map(value => Number(counts[value]) || 0));
    const description = values.map(value => `${value}: ${Number(counts[value]) || 0}`).join(', ');
    return `<section class="inventory-panel inventory-chart inventory-situation-summary"><h3>${title}</h3>
      <div class="inventory-situation-summary-bars" role="img" aria-label="${escape(`${title}. ${description}`)}">
        ${values.map(value => `<div class="inventory-situation-summary-row" style="--chart-color:${colorFor(value)}">
          <span>${escape(value)}</span><div class="inventory-situation-summary-track"><i style="width:${(Number(counts[value]) || 0) ? Math.max(3, Math.round((Number(counts[value]) || 0) / max * 100)) : 0}%"></i></div><b>${Number(counts[value]) || 0}</b>
        </div>`).join('')}
      </div></section>`;
  }
  const globalChart = (title, rows, field, preferred, prefix = '') => {
    const counts = Object.fromEntries((rows || []).map(row => [row.value, Number(row.count) || 0]));
    const values = [...new Set([...preferred, ...Object.keys(counts)])];
    if (field === 'situation' && !controlMode && !fluxMode)
      return inventorySituationSummary(title, counts, values, value => chartColor(field, value));
    return chartWithCounts(title, counts, field, values, prefix);
  };
  const homePanelRows = (rows, preferred, field) => {
    const counts = Object.fromEntries((rows || []).map(row => [row.value, Number(row.count) || 0]));
    return [...new Set([...preferred, ...Object.keys(counts)])].map(label => ({ label, count: counts[label] || 0, color: chartColor(field, label) }));
  };
  function inventoryHomeSidebar() {
    const panels = window.AldeckotModulePanels;
    return panels.bars('Distribuição por Status', homePanelRows(globalState.overview?.statuses, statuses, 'status'))
      + panels.donut('Distribuição por Situação', homePanelRows(globalState.overview?.situations, situations, 'situation'))
      + panels.actions([
        { id: 'search', icon: 'search', label: 'Buscar equipamento' },
        { id: 'category', icon: 'folder', label: 'Abrir categoria' },
        { id: 'add-table', icon: 'plus', label: 'Nova tabela', disabled: !canManage() },
        { id: 'export-pdf', icon: 'report', label: 'Exportar PDF' }
      ], 'data-inv-home-action');
  }
  function controlHomeSidebar() {
    const panels = window.AldeckotModulePanels;
    const items = data.tables.flatMap(entry => entry.items || []);
    const rows = (values, field) => values.map(label => ({ label, count: items.filter(item => item[field] === label).length, color: chartColor(field, label) }));
    return panels.bars('Distribuição por Status', rows(statuses, 'status'))
      + panels.donut(moduleConfig.situationChart, rows(situations, 'situation'))
      + panels.actions([
        { id: 'all', icon: 'folder', label: 'Todos os chamados' },
        { id: 'active', icon: 'alert', label: 'Em andamento' },
        { id: 'reports', icon: 'report', label: 'Relatórios' },
        { id: 'refresh', icon: 'history', label: 'Atualizar indicadores' }
      ], 'data-control-home-action');
  }

  function applyInventoryCleaningColumn(table) {
    if (controlMode || fluxMode || !table) return;
    const grid = document.querySelector('.inventory-data');
    if (grid?.dataset.invStandardColumns) return;
    const situationHeader = [...(grid?.querySelectorAll('thead th') || [])].find(header => header.textContent.trim() === 'SITUAÇÃO');
    if (!grid || !situationHeader || grid.querySelector('[data-inv-cleaning-column]')) return;
    const header = document.createElement('th');
    header.dataset.invCleaningColumn = 'true';
    header.textContent = 'LIMPEZA';
    situationHeader.insertAdjacentElement('afterend', header);
    grid.querySelectorAll('tbody tr[data-inv-item]').forEach(row => {
      const item = table.items.find(entry => entry.id === row.dataset.invItem);
      const situationCell = row.querySelector('.inventory-situation')?.closest('td');
      if (!situationCell || !item) return;
      const cell = document.createElement('td');
      cell.dataset.invCleaningColumn = 'true';
      cell.innerHTML = cleaningPill(item.cleaning || 'Não realizada');
      situationCell.insertAdjacentElement('afterend', cell);
    });
    const empty = grid.querySelector('.inventory-empty-row');
    if (empty) empty.colSpan = Number(empty.colSpan || 7) + 1;
  }

  function applyInventoryFilters() {
    const table = activeTable();
    if (!table) return;
    if (controlMode) {
      const matched = filteredControlItems(table);
      state.page = Math.min(Math.max(1, state.page), Math.max(1, Math.ceil(matched.length / state.pageSize)));
      const page = matched.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
      const body = document.querySelector('.control-board-table tbody');
      if (body) body.innerHTML = page.map(item => controlBoard.row(item, dateValue)).join('')
        || '<tr><td colspan="10" class="inventory-empty-row">Nenhum equipamento corresponde à consulta.</td></tr>';
      const pagination = document.querySelector('.control-board-pagination');
      if (pagination) pagination.innerHTML = controlBoard.pagination(matched.length, state.page, state.pageSize, pageSizes);
      const charts = document.querySelector('.control-board-layout .inventory-charts');
      if (charts) {
        const counts = controlBoard.statusCounts(matched);
        charts.innerHTML = chartWithCounts('Distribuição por Status', counts, 'status',
          Object.keys(counts), '', value => controlBoard.statuses[value]?.[1] || '#678198', 86)
          + controlBoard.sidebar(matched, canManage());
      }
      return;
    }
    if (fluxMode) {
      const results = fluxGroups(table, state);
      const lastPage = Math.max(1, Math.ceil(results.length / state.pageSize));
      state.page = Math.max(1, Math.min(state.page, lastPage));
      const shown = results.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
      const list = document.querySelector('.flux-card-list');
      if (list) list.innerHTML = shown.length ? shown.map(fluxCardMarkup).join('')
        : '<p class="flux-card-empty">Nenhum equipamento corresponde aos filtros deste mês.</p>';
      let footer = document.querySelector('.inventory-pagination');
      if (!footer) {
        footer = document.createElement('footer');
        footer.className = 'inventory-panel inventory-pagination';
        document.querySelector('.inventory-workspace')?.appendChild(footer);
      }
      footer.innerHTML = `<span>Mostrando ${shown.length ? (state.page - 1) * state.pageSize + 1 : 0} a ${Math.min(state.page * state.pageSize, results.length)} de ${results.length} equipamentos</span><label>Itens por página <select data-inv-page-size aria-label="Itens por página">${pageSizes.map(size => `<option value="${size}"${state.pageSize === size ? ' selected' : ''}>${size}</option>`).join('')}</select></label><nav aria-label="Páginas"><button type="button" data-inv-page="${state.page - 1}" aria-label="Página anterior" ${state.page === 1 ? 'disabled' : ''}>‹</button><span>Página ${state.page} de ${lastPage}</span><button type="button" data-inv-page="${state.page + 1}" aria-label="Próxima página" ${state.page === lastPage ? 'disabled' : ''}>›</button></nav>`;
      return;
    }
    if (!controlMode && !fluxMode && table.pageItems) {
      const shown = table.pageItems;
      const total = Number(table.total || 0);
      const lastPage = Math.max(1, Math.ceil(total / state.pageSize));
      const body = document.querySelector('.inventory-data tbody');
      if (body) body.innerHTML = shown.length ? shown.map(item => inventoryRowMarkup(table, item)).join('')
        : '<tr><td colspan="10" class="inventory-empty-row">Nenhum equipamento corresponde aos filtros.</td></tr>';
      let footer = document.querySelector('.inventory-pagination');
      if (!footer) {
        footer = document.createElement('footer');
        footer.className = 'inventory-panel inventory-pagination';
        document.querySelector('.inventory-workspace')?.appendChild(footer);
      }
      footer.innerHTML = `<span>Mostrando ${shown.length ? (state.page - 1) * state.pageSize + 1 : 0} a ${Math.min(state.page * state.pageSize, total)} de ${total} itens</span><label>Itens por página <select data-inv-page-size aria-label="Itens por página">${pageSizes.map(size => `<option value="${size}"${state.pageSize === size ? ' selected' : ''}>${size}</option>`).join('')}</select></label><nav aria-label="Páginas"><button type="button" data-inv-page="${state.page - 1}" aria-label="Página anterior" ${state.page === 1 ? 'disabled' : ''}>‹</button><span>Página ${state.page} de ${lastPage}</span><button type="button" data-inv-page="${state.page + 1}" aria-label="Próxima página" ${state.page === lastPage ? 'disabled' : ''}>›</button></nav>`;
      return;
    }
    const scope = scopedItems(table);
    const matched = scope.filter(matchesActiveFilters);
    const results = matched;
    const lastPage = Math.max(1, Math.ceil(results.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, lastPage));
    const shown = results.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    if (!controlMode && !fluxMode) {
      const body = document.querySelector('.inventory-data tbody');
      if (body) body.innerHTML = shown.length ? shown.map(item => inventoryRowMarkup(table, item)).join('') : '<tr><td colspan="10" class="inventory-empty-row">Nenhum equipamento corresponde aos filtros.</td></tr>';
    } else {
      const matchedIds = new Set(shown.map(item => item.id));
      document.querySelectorAll('.inventory-data tbody tr[data-inv-item]').forEach(row => {
        row.hidden = !matchedIds.has(row.dataset.invItem);
      });
    }
    const emptyRow = document.querySelector('.inventory-filter-empty-row');
    if (emptyRow) emptyRow.hidden = !(scope.length && !matched.length);
    let footer = document.querySelector('.inventory-pagination');
    if (!footer) {
      footer = document.createElement('footer');
      footer.className = 'inventory-panel inventory-pagination';
      document.querySelector('.inventory-workspace')?.appendChild(footer);
    }
    footer.innerHTML = `<span>Mostrando ${shown.length ? (state.page - 1) * state.pageSize + 1 : 0} a ${Math.min(state.page * state.pageSize, results.length)} de ${results.length} itens</span><label>Itens por página <select data-inv-page-size aria-label="Itens por página">${pageSizes.map(size => `<option value="${size}"${state.pageSize === size ? ' selected' : ''}>${size}</option>`).join('')}</select></label><nav aria-label="Páginas"><button type="button" data-inv-page="${state.page - 1}" aria-label="Página anterior" ${state.page === 1 ? 'disabled' : ''}>‹</button><span>Página ${state.page} de ${lastPage}</span><button type="button" data-inv-page="${state.page + 1}" aria-label="Próxima página" ${state.page === lastPage ? 'disabled' : ''}>›</button></nav>`;
  }

  async function refreshCategoryPage() {
    if (controlMode || fluxMode || !state.active) return;
    const request = ++categoryRequestSequence;
    const category = state.active;
    const branch = state.branchId;
    try {
      const result = await moduleApi().categoryPage(categoryFilters());
      if (request !== categoryRequestSequence || state.active !== category || state.branchId !== branch) return;
      const lastPage = Math.max(1, Math.ceil(Number(result.total || 0) / state.pageSize));
      if (state.page > lastPage) { state.page = lastPage; return refreshCategoryPage(); }
      const table = activeTable();
      if (!table) return;
      table.items = result.items;
      table.pageItems = result.items;
      table.total = Number(result.total || 0);
      table.fullItemsLoaded = false;
      const search = document.activeElement?.matches?.('[data-inv-search]') ? document.activeElement : null;
      const caret = search?.selectionStart ?? null;
      renderBranchView();
      if (search) {
        const replacement = document.querySelector('[data-inv-search]');
        replacement?.focus({ preventScroll: true });
        if (caret !== null) replacement?.setSelectionRange(caret, caret);
      }
    } catch (error) {
      if (request === categoryRequestSequence) window.AldeckotMessage.show(backendMessage(error));
    }
  }
  async function ensureFullActiveTable() {
    const table = activeTable();
    if (!table || controlMode || fluxMode || table.fullItemsLoaded) return table;
    const snapshot = await moduleApi().load(table.id);
    const complete = snapshot.tables.find(entry => entry.id === table.id);
    if (!complete) throw new Error('A categoria não está mais disponível.');
    table.items = complete.items;
    table.fullItemsLoaded = true;
    return table;
  }

  function ensureFilterEmptyRow(table) {
    const grid = document.querySelector('.inventory-data');
    if (grid?.dataset.invStandardColumns) return;
    const body = grid?.tBodies?.[0];
    if (!grid || !body || !table?.items?.length || body.querySelector('.inventory-filter-empty-row')) return;
    const row = document.createElement('tr');
    row.className = 'inventory-empty-row inventory-filter-empty-row';
    row.hidden = true;
    const cell = document.createElement('td');
    cell.colSpan = grid.tHead?.rows?.[0]?.cells?.length || 1;
    cell.textContent = 'Nenhum item corresponde aos filtros aplicados.';
    row.appendChild(cell);
    body.appendChild(row);
  }

  function tableListMarkup() {
    if (!data.tables.length) return '<p class="inventory-no-tables">Nenhuma tabela criada.</p>';
    return data.tables.map(entry => {
      const icon = entry.icon && entry.icon !== '📁' ? ` ${escape(entry.icon)}` : '';
      return `<div class="inventory-table-choice ${entry.id === state.active ? 'active' : ''}"><button class="inventory-table-select" data-inv-table="${entry.id}" aria-label="Abrir tabela ${escape(entry.name)}${entry.itemsLoaded === false ? '' : `, ${entry.items.length} ${entry.items.length === 1 ? 'item' : 'itens'}`}"><b>${escape(entry.name)}${icon}</b></button></div>`;
    }).join('');
  }

  const globalItemFromRow = row => ({
    id: row.id, tableId: row.table_id, equipment: row.equipment, tag: row.tag,
    serial: row.serial, brand: row.brand, model: row.model, sector: row.sector,
    location: row.location, status: row.status, situation: row.situation,
    cleaning: row.cleaning_type, createdAt: row.created_at,
    updatedAt: row.changed_at || row.updated_at, logs: []
  });
  const globalRowsMarkup = () => (globalState.result?.items || []).map(row => {
    const table = data.tables.find(entry => entry.id === row.table_id)
      || { name: row.category, branches: [] };
    return inventoryRowMarkup(table, globalItemFromRow(row));
  }).join('') || '<tr><td colspan="10" class="inventory-empty-row">Nenhum equipamento encontrado.</td></tr>';
  function globalPaginationMarkup() {
    const total = Number(globalState.result?.total || 0);
    if (!globalListingActive()) return `<span>${(globalState.result?.items || []).length} equipamentos recentes · ${total} no Inventário</span>`;
    const pages = Math.max(1, Math.ceil(total / globalState.pageSize));
    return `<span>${total} ${total === 1 ? 'equipamento encontrado' : 'equipamentos encontrados'}</span><nav aria-label="Páginas da consulta global"><button type="button" data-inv-global-page="${globalState.page - 1}" ${globalState.page <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button><span>Página ${globalState.page} de ${pages}</span><button type="button" data-inv-global-page="${globalState.page + 1}" ${globalState.page >= pages ? 'disabled' : ''} aria-label="Próxima página">›</button></nav>`;
  }
  function globalMarkup() {
    const all = globalState.view === 'all';
    const options = (values, chosen) => values.map(value => `<option value="${escape(value)}" ${chosen === value ? 'selected' : ''}>${escape(value)}</option>`).join('');
    const availableStatuses = [...new Set([...statuses, ...(globalState.overview?.statuses || []).map(row => row.value)])];
    const availableSituations = [...new Set([...situations, ...(globalState.overview?.situations || []).map(row => row.value)])];
    return `<section class="inventory-panel inventory-global-search"><div class="inventory-search-wrap"><span>⌕</span><input class="inventory-search" data-inv-global-search value="${escape(globalState.query)}" placeholder="Buscar TAG, série, equipamento, categoria ou ramificação…" aria-label="Buscar em todo o Inventário" autocomplete="off"></div></section>
      ${all ? `<section class="inventory-panel inventory-global-filters"><select data-inv-global-category aria-label="Filtrar por categoria"><option value="">Todas as categorias</option>${data.tables.map(table => `<option value="${escape(table.id)}" ${globalState.category === table.id ? 'selected' : ''}>${escape(table.name)}</option>`).join('')}</select><select data-inv-global-status aria-label="Filtrar por status"><option value="">Todos os status</option>${options(availableStatuses, globalState.status)}</select><select data-inv-global-situation aria-label="Filtrar por situação"><option value="">Todas as situações</option>${options(availableSituations, globalState.situation)}</select><select data-inv-global-order aria-label="Ordenar equipamentos"><option value="recent" ${globalState.order === 'recent' ? 'selected' : ''}>Mais recentes</option><option value="oldest" ${globalState.order === 'oldest' ? 'selected' : ''}>Mais antigos</option><option value="name" ${globalState.order === 'name' ? 'selected' : ''}>Equipamento A–Z</option><option value="tag" ${globalState.order === 'tag' ? 'selected' : ''}>TAG A–Z</option></select></section>` : ''}
      <section class="inventory-panel inventory-data-wrap inventory-global-data"><table class="inventory-data" data-inv-standard-columns="true"><thead><tr><th>EQUIPAMENTO</th><th>TAG</th><th>MODELO</th><th>MARCA</th><th>SETOR</th><th>LOCAL</th><th>STATUS</th><th>SITUAÇÃO</th><th>LIMPEZA</th><th>ÚLTIMA ALTERAÇÃO</th></tr></thead><tbody>${globalRowsMarkup()}</tbody></table></section>
      <footer class="inventory-panel inventory-pagination inventory-global-pagination">${globalPaginationMarkup()}</footer><span class="inventory-global-loading" role="status" ${globalState.busy ? '' : 'hidden'}>Atualizando consulta…</span>`;
  }
  function renderGlobalTable() {
    if (state.active) return;
    const body = document.querySelector('.inventory-global-data tbody');
    if (body) body.innerHTML = globalRowsMarkup();
    const footer = document.querySelector('.inventory-global-pagination');
    if (footer) footer.innerHTML = globalPaginationMarkup();
    const loading = document.querySelector('.inventory-global-loading');
    if (loading) loading.hidden = !globalState.busy;
  }
  function renderModuleHomeRows() {
    if (!(controlMode || fluxMode) || state.active) return;
    if (controlMode) { renderControlOperational(); return; }
    const list = document.querySelector('.flux-home-list');
    if (list) list.innerHTML = fluxHomeCardsMarkup();
    const footer = document.querySelector('.inventory-module-pagination');
    if (footer) footer.innerHTML = fluxHomePaginationMarkup();
  }
  function renderControlOperational() {
    if (!controlMode || state.active) return;
    const workspace = document.querySelector('.inventory-global-workspace');
    if (!workspace) return;
    workspace.innerHTML = controlOperational.legacy
      ? '<p class="control-op-error" role="alert">A Central Operacional requer a migração 097. A consulta antiga permanece disponível.</p>'
        + window.AldeckotModuleHome.markup(data.tables, globalState, 'control', moduleConfig.name)
      : window.AldeckotControlOperational.markup(controlOperational);
  }
  async function refreshControlOperational() {
    if (!controlMode || state.active || controlOperational.legacy) return;
    if (typeof moduleApi()?.operationalOverview !== 'function' ||
      typeof moduleApi()?.operationalCases !== 'function' ||
      typeof moduleApi()?.controlCaseReport !== 'function') {
      controlOperational.legacy = true;
      renderControlOperational();
      return;
    }
    const request = ++controlOperationalSequence;
    controlOperational.busy = true;
    controlOperational.error = '';
    renderControlOperational();
    try {
      if (controlOperational.tab === 'overview') {
        controlOperational.dashboard = await moduleApi().operationalOverview();
      } else if (controlOperational.tab === 'reports') {
        const report = await moduleApi().controlCaseReport(controlOperational.reportFilters);
        if (request !== controlOperationalSequence) return;
        controlOperational.report = report;
        controlOperational.reportFilters.periodStart ||= controlOperational.report?.periodStart || '';
        controlOperational.reportFilters.periodEnd ||= controlOperational.report?.periodEnd || '';
      } else {
        controlOperational.listing = await moduleApi().operationalCases({
          tab: controlOperational.tab, query: controlOperational.query,
          status: controlOperational.status, priority: controlOperational.priority,
          page: controlOperational.page, pageSize: controlOperational.pageSize
        });
      }
    } catch (error) {
      if (request !== controlOperationalSequence) return;
      if (/PGRST202|42883/.test(String(error?.code || '')) ||
        /(?:control_operational_overview|list_control_cases).*(?:does not exist|schema cache)/i.test(error?.message || '')) {
        controlOperational.legacy = true;
      } else {
        controlOperational.error = backendMessage(error);
      }
    } finally {
      if (request === controlOperationalSequence) {
        controlOperational.busy = false;
        renderControlOperational();
      }
    }
  }
  function downloadControlReportCsv() {
    const report = controlOperational.report;
    if (!report || report.truncated) { controlOperational.error='Reduza o período para exportar todos os chamados do relatório.'; renderControlOperational(); return; }
    const columns = [['Equipamento','equipment'],['TAG','tag'],['Setor','sector'],['Estado','state'],['Prioridade','priority'],['Origem','origin'],['Categoria','category'],['Abertura','openedAt'],['Resolução','resolvedAt'],['Minutos de manutenção','maintenanceMinutes'],['Intervenções','interventions'],['Recorrência','recurrence'],['Diagnóstico','diagnosis'],['Solução','solution']];
    const quote = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
    const content = '\ufeff' + [columns.map(([label])=>quote(label)).join(','), ...(report.casesList||[]).map(row=>columns.map(([,key])=>quote(row[key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href=url; anchor.download=`relatorio-controle-ti-${report.periodStart}-${report.periodEnd}.csv`; anchor.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function printControlReport(caseId = null) {
    const report = controlOperational.report;
    if (!report) return;
    if (report.truncated && !caseId) { controlOperational.error='Reduza o período para imprimir o relatório completo.'; renderControlOperational(); return; }
    const allRows = report.casesList || [];
    const rows = caseId ? allRows.filter(row=>row.id===caseId) : allRows;
    if (!rows.length) return;
    const popup = window.open('', '_blank');
    if (!popup) { controlOperational.error='Permita a janela de impressão para gerar o PDF.'; renderControlOperational(); return; }
    const esc = value => escape(value ?? '—');
    popup.document.write(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório Controle TI</title><style>body{font:12px Arial;color:#15283a;margin:24px}h1{font-size:20px}p{color:#526477}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border:1px solid #9aabba;padding:7px;text-align:left}th{background:#e8f1f7}@media print{button{display:none}}</style><h1>${caseId?'Ficha de chamado':'Relatório Controle TI'}</h1><p>Período ${esc(report.periodStart)} a ${esc(report.periodEnd)} · ${rows.length} chamado(s)</p><table><thead><tr><th>Equipamento / TAG</th><th>Setor</th><th>Estado</th><th>Categoria</th><th>Abertura</th><th>Manutenção</th><th>Diagnóstico e solução</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.equipment)}<br>${esc(row.tag)}</td><td>${esc(row.sector)}</td><td>${esc(row.state)}</td><td>${esc(row.category)}</td><td>${esc(row.openedAt)}</td><td>${esc(row.maintenanceMinutes)} min</td><td>${esc(row.diagnosis)}<br>${esc(row.solution)}</td></tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()</script></html>`);
    popup.document.close();
  }
  async function refreshGlobalPage() {
    if (state.active) return;
    const request = ++globalRequestSequence;
    if (!globalListingActive()) {
      globalState.result = { items: globalState.overview?.recent || [], total: globalState.overview?.total || 0 };
      globalState.busy = false;
      renderGlobalTable();
      return;
    }
    globalState.busy = true;
    renderGlobalTable();
    try {
      const result = await moduleApi().globalPage(globalFilters());
      if (request !== globalRequestSequence || state.active) return;
      globalState.result = result;
    } catch (error) {
      if (request === globalRequestSequence) window.AldeckotMessage.show(backendMessage(error));
    } finally {
      if (request === globalRequestSequence) {
        globalState.busy = false;
        renderGlobalTable();
      }
    }
  }

  function tableActionsPopover() {
    const entry = data.tables.find(table => table.id === state.tableMenu);
    const position = state.tableMenuPosition;
    if (!entry || !position) return '';
    return `<div class="inventory-table-actions-popover" role="menu" style="top:${position.top}px;left:${position.left}px"><button class="inventory-table-tool edit" data-inv-edit-table="${entry.id}" title="Editar tabela" aria-label="Editar tabela"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inventory-table-tool delete" data-inv-delete-table="${entry.id}" title="Excluir tabela" aria-label="Excluir tabela"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div>`;
  }

  function tableToolbarActions() {
    return `<div class="inventory-toolbar-table-actions"><div class="inventory-table-action-menu-wrap"><button class="inventory-table-action-trigger" type="button" data-inv-action="toggle-active-table-actions" aria-haspopup="menu" aria-expanded="${state.tableActionMenu}" title="Ações da tabela">Ação <svg viewBox="0 0 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>${state.tableActionMenu ? `<div class="inventory-table-action-menu" role="menu"><button type="button" data-inv-action="edit-active-table" role="menuitem"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg>Editar</button><button class="danger" type="button" data-inv-action="delete-active-table" role="menuitem"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg>Excluir</button></div>` : ''}</div></div>`;
  }

  function applyHeaderPresentation() {
    const actions = {
      'export-pdf': { label: 'Exportar PDF', className: 'inventory-pdf-action' },
      backup: { label: 'Backup', className: 'inventory-backup-action', icon: '<ellipse cx="10.5" cy="5" rx="5.5" ry="2.5"/><path d="M5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.1 0 2.1-.1 3-.4M16 5v5M5 10c0 1.4 2.5 2.5 5.5 2.5S16 11.4 16 10M16.2 17.5l1.8 1.8 3.4-4"/>' },
      'add-table': { label: 'Nova tabela', className: 'inventory-new-table-action', icon: '<ellipse cx="10" cy="5" rx="5.5" ry="2.5"/><path d="M4.5 5v10c0 1.4 2.5 2.5 5.5 2.5 1.2 0 2.3-.2 3.2-.5M15.5 5v7M4.5 10c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5M18.5 16v6m-3-3h6"/>' },
      home: { label: 'Home', className: 'inventory-home-action', icon: '<path d="m4 10 8-6 8 6v9H4v-9Zm5 9v-5h6v5"/>' }
    };
    Object.entries(actions).forEach(([action, config]) => {
      const button = document.querySelector(`[data-inv-action="${action}"]`);
      if (!button) return;
      button.title = config.label;
      button.setAttribute('aria-label', config.label);
      button.classList.add(config.className);
      if (config.icon) button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${config.icon}</svg>`;
      if (controlMode && action === 'export-pdf') {
        button.classList.add('control-pdf-action');
        button.setAttribute('aria-haspopup', 'dialog');
        button.insertAdjacentHTML('beforeend', '<span>PDF</span>');
      }
    });
    const toolbar = document.querySelector('.inventory-header-actions');
    toolbar?.setAttribute('role', 'toolbar');
    toolbar?.setAttribute('aria-label', `Ações do ${moduleConfig.name}`);
  }

  function ensureHeaderBrand() {
    const actions = document.querySelector('.inventory-header-actions');
    if (!actions) return;
    actions.querySelector('[data-inv-action="home"]')?.remove();
    if (actions.querySelector('[data-system-header-brand]')) return;
    const brand = document.createElement('a');
    brand.className = 'system-header-brand';
    brand.dataset.systemHeaderBrand = 'true';
    brand.href = 'index.html';
    brand.setAttribute('aria-label', 'Voltar para a Home do Aldeckot');
    brand.innerHTML = '<span class="system-header-brand-mark" aria-hidden="true"><img class="official-logo-image" src="assets/aldeckot-symbol.png?v=2.0.73" alt=""></span><span class="system-header-brand-copy"><b>Aldeckot</b></span>';
    actions.append(brand);
  }

  function moduleHomeNavigationMarkup() {
    const byCategory = !controlMode && !fluxMode;
    const tables = byCategory ? data.tables : tableControls.periods(data.tables);
    const options = byCategory
      ? tables.map(table => `<option value="${escape(table.id)}">${escape(table.name)}</option>`).join('')
      : tableControls.periodOptions(tables, '');
    return `<nav class="module-home-navigation" aria-label="Início do ${moduleConfig.name}">
      <button type="button" class="module-home-heading" ${byCategory ? 'data-inv-global-home' : 'data-inv-module-home'} aria-label="Atualizar visão geral do ${escape(moduleConfig.name)}" title="Atualizar visão geral"><span class="module-home-heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v11h14V9m-9 11v-6h4v6"/></svg></span><span class="module-home-heading-copy"><small>INÍCIO DO MÓDULO</small><b>Visão geral</b><em>${escape(moduleConfig.name)} · ${byCategory ? 'categorias' : 'períodos'}</em></span></button>
      <label class="module-home-select">Abrir ${byCategory ? 'categoria' : 'mês'}<select data-module-home-table-select aria-label="Abrir ${byCategory ? 'categoria' : 'mês'}" ${tables.length ? '' : 'disabled'}><option value="">Selecione ${byCategory ? 'uma categoria' : 'um mês'}</option>${options}</select></label>
    </nav>`;
  }

  function renderInventory() {
    document.body.classList.remove('home-page');
    document.body.classList.add('inventory-open');
    const table = activeTable();
    const items = scopedItems(table);
    const globalHome = !controlMode && !fluxMode && !table;
    const moduleHome = (controlMode || fluxMode) && !table;
    const emptyPresentation = emptyPresentationCache ||= emptyPresentationMarkup();
    $('#app').innerHTML = `<div class="inventory-shell">
      <header class="inventory-header"><div class="inventory-heading"><div class="inventory-heading-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 8 4.5v9L12 20l-8-4.5v-9L12 2Z"/><path d="m4 6.5 8 4.5 8-4.5M12 11v9"/></svg></div><div><h1>INVENTÁRIO</h1><p>Aldeckot — Controle de Equipamentos</p></div></div><div class="inventory-header-actions"><button title="Exportar tabela aberta em PDF" aria-label="Exportar tabela aberta em PDF" class="inventory-header-action" data-inv-action="export-pdf"><img class="pdf-export-icon" src="assets/pdf-export.svg" width="24" height="24" alt=""></button><button title="Sistema de backup" aria-label="Sistema de backup" class="inventory-header-action inventory-backup-action" data-inv-action="backup"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l2 8H2l2-8Zm2-4h12l2 4H4l2-4Zm2 8h8"/></svg></button><button title="Criar nova tabela" aria-label="Criar nova tabela" class="inventory-header-action inventory-new-table-action" data-inv-action="add-table"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6l2 2h8v10H4V6Z"/><path d="M15 11v4m-2-2h4"/></svg></button><button title="Voltar para início" aria-label="Voltar para início" class="inventory-header-action inventory-home-action" data-inv-action="home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 10 8-6 8 6v9H4v-9Zm5 9v-5h6v5"/></svg></button></div></header>
      <div class="inventory-layout ${state.sidebarOpen ? 'tables-open' : ''} ${table ? 'table-selected' : globalHome || moduleHome ? 'global-selected' : 'no-table-selected'}"><aside class="inventory-panel inventory-tables inventory-table-sidebar"><div class="inventory-sidebar-head"><button class="inventory-sidebar-toggle" data-inv-action="toggle-tables" title="${state.sidebarOpen ? 'Ocultar tabelas' : 'Mostrar tabelas'}" aria-label="${state.sidebarOpen ? 'Ocultar tabelas' : 'Mostrar tabelas'}" aria-expanded="${state.sidebarOpen}"><svg class="inventory-table-toggle-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="M2.5 9h19M2.5 14.5h19M9 3.5v17"/><path d="M5.3 6.3h1.2M5.3 11.7h1.2M5.3 17.2h1.2" stroke-width="2.2"/></svg><span>Tabelas</span></button><button class="inventory-table-add" data-inv-action="add-table" title="Criar tabela">+</button></div><div class="inventory-sidebar-content"><div class="inventory-table-list">${tableListMarkup()}</div></div></aside>
        ${table ? `<main class="inventory-workspace">${tableMarkup(table, items)}</main><aside class="inventory-charts">${chart('Distribuição por Status', items, 'status', statuses)}${chart('Distribuição por Situação', items, 'situation', situations, 'situation-')}</aside>` : globalHome ? `<main class="inventory-workspace inventory-global-workspace">${globalMarkup()}</main><aside class="inventory-charts inventory-global-charts module-home-sidebar">${inventoryHomeSidebar()}</aside>` : moduleHome ? `<main class="inventory-workspace inventory-global-workspace">${fluxMode ? fluxHomeMarkup() : window.AldeckotModuleHome.markup(data.tables, globalState, moduleConfig.key, moduleConfig.name)}</main><aside class="inventory-charts ${controlMode ? 'module-home-sidebar' : ''}">${controlMode ? controlHomeSidebar() : chart('Distribuição por Status', data.tables.flatMap(entry => entry.items || []), 'status', statuses) + chart('Distribuição por Situação', data.tables.flatMap(entry => entry.items || []), 'situation', situations, 'situation-')}</aside>` : `<main class="inventory-workspace inventory-empty-workspace">${emptyPresentation.emptyState}</main>`}</div></div>`;
    if (!controlMode && table) {
      const layout = document.querySelector('.inventory-layout');
      layout?.classList.add('inventory-no-sidebar');
      layout?.querySelector('.inventory-table-sidebar')?.remove();
    }
    if (!table) {
      const layout = document.querySelector('.inventory-layout');
      layout?.classList.add('module-home-layout');
      layout?.querySelector('.inventory-table-sidebar')?.remove();
    }
    const inventoryHeader = document.querySelector('.inventory-header');
    const previousHeading = inventoryHeader?.querySelector('.inventory-heading');
    if (previousHeading && !previousHeading.classList.contains('module-header-summary')) previousHeading.outerHTML = moduleHeaderSummaryMarkup();
    const mascotDock = document.querySelector('.inventory-header [data-module-mascot-dock]');
    if (!mascotDock) {
      const header = inventoryHeader;
      const heading = header?.querySelector('.inventory-heading');
      if (header) {
        const dock = document.createElement('span');
        dock.className = 'module-mascot-dock module-mascot-dock-inventory';
        dock.dataset.moduleMascotDock = 'true';
        dock.setAttribute('aria-label', 'Mascote ALDECKOT');
        dock.innerHTML = '<img class="module-mascot-image" src="assets/mascot-dark.png" alt="" aria-hidden="true"><button class="module-notification-toggle module-mascot-notification" type="button" data-module-notifications title="Central de notificações" aria-label="Abrir Central de notificações" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="module-notification-badge" hidden></span></button>';
        if (heading) heading.insertAdjacentElement('afterend', dock);
        else header.prepend(dock);
      }
    }
    if (emptyPresentation.illustration) {
      const animationDock = document.createElement('div');
      animationDock.className = `module-header-animation ${fluxMode ? 'flux-empty-state' : controlMode ? 'control-header-scene' : 'inventory-header-tracking-scene'}`;
      animationDock.setAttribute('aria-hidden', 'true');
      animationDock.innerHTML = controlMode ? controlBoard.headerScene() : fluxMode ? emptyPresentation.illustration : inventoryScanScene();
      if (fluxMode) {
        // Enquadra apenas a cópia no cabeçalho; a ilustração do estado vazio permanece completa.
        animationDock.querySelector('.flux-empty-illustration')?.setAttribute('viewBox', '0 42 520 160');
      }
      inventoryHeader?.querySelector('.module-header-summary')?.insertAdjacentElement('afterend', animationDock);
    }
    applyHeaderPresentation();
    if (controlMode) document.querySelector('.inventory-layout')?.classList.add('control-board-layout');
    if (fluxMode) {
      document.querySelector('.inventory-layout')?.classList.add('flux-board-layout');
      const sidebar = document.querySelector('.inventory-charts');
      if (sidebar) sidebar.innerHTML = fluxSidebarMarkup(table ? items : data.tables.flatMap(entry => entry.items || []));
    }
    ensureHeaderBrand();
    if (!table) inventoryHeader?.insertAdjacentHTML('afterend', moduleHomeNavigationMarkup());
    applyInventoryCleaningColumn(table);
    ensureFilterEmptyRow(table);
    setupInventoryAddMenu(table);
    window.AldeckotActionMenus?.enhance(document.querySelector('.inventory-shell'));
    if (moduleHome && controlMode) {
      document.querySelector('.inventory-layout')?.classList.add('control-operational-layout');
      renderControlOperational();
    }
    if (table) applyInventoryFilters();
    else if (globalHome) void applySharedImages();
    if (table && !controlMode && !fluxMode) {
      const titles = document.querySelectorAll('.inventory-charts .inventory-chart h3');
      if (titles[0]) titles[0].textContent = 'Status nesta página';
      if (titles[1]) titles[1].textContent = 'Situação nesta página';
    }
    if (controlMode || fluxMode) {
      const chartTitles = document.querySelectorAll('.inventory-charts .inventory-chart h3');
      if (chartTitles[1]) chartTitles[1].textContent = moduleConfig.situationChart;
      const emptyText = document.querySelector('.inventory-empty-content p');
      if (emptyText) emptyText.textContent = moduleConfig.emptyText;
    }
    const pendingItem = state.pendingItemId && table?.items.find(item => item.id === state.pendingItemId);
    if (pendingItem) {
      state.pendingItemId = null;
      if (window.history?.replaceState) window.history.replaceState({}, '', moduleConfig.page);
      details(pendingItem);
    } else if (state.pendingItemId && table && !controlMode && !fluxMode) {
      const wanted = state.pendingItemId;
      state.pendingItemId = null;
      void ensureFullActiveTable().then(complete => {
        const found = complete?.items.find(item => item.id === wanted);
        if (found) { window.history?.replaceState?.({}, '', moduleConfig.page); details(found); }
      }).catch(error => window.AldeckotMessage.show(backendMessage(error)));
    }
    window.AldeckotModuleStage?.reveal?.();
  }

  function branchNavigationMarkup(table) {
    if (controlMode || fluxMode || !table) return '';
    const home = tableControls.homeButton('Início do Inventário', true);
    if (!table.branches?.length) return `<div class="module-table-nav">${home}</div>`;
    const current = selectedBranch(table);
    return `<nav class="inventory-branch-nav module-table-nav" aria-label="Navegação da categoria">${home}<div class="inventory-branch-tabs"><button type="button" class="inventory-branch-tab ${current ? '' : 'active'}" data-inv-branch-home aria-current="${current ? 'false' : 'page'}">${escape(table.name)}</button>${table.branches.map(branch => `<button type="button" class="inventory-branch-tab ${current?.id === branch.id ? 'active' : ''}" data-inv-branch="${escape(branch.id)}" aria-current="${current?.id === branch.id ? 'page' : 'false'}">${escape(branch.name)}</button>`).join('')}</div>${current && canManage() ? `<div class="inventory-branch-admin"><button type="button" data-inv-branch-edit="${escape(current.id)}">Renomear</button><button type="button" data-inv-branch-delete="${escape(current.id)}">Excluir</button></div>` : ''}</nav>`;
  }

  function setupInventoryAddMenu(table) {
    if (controlMode || fluxMode || !table) return;
    const button = document.querySelector('.inventory-workspace [data-inv-action="add-item"]');
    if (!button) return;
    button.dataset.invAction = 'toggle-add-menu';
    button.setAttribute('aria-expanded', String(state.addMenu));
    button.setAttribute('aria-haspopup', 'menu');
    if (state.addMenu) button.insertAdjacentHTML('afterend', '<div class="inventory-add-menu" role="menu"><button type="button" data-inv-action="new-equipment" role="menuitem">Novo equipamento</button><button type="button" data-inv-action="new-branch" role="menuitem">Nova ramificação</button></div>');
  }

  function renderBranchView() {
    const table = activeTable();
    const workspace = document.querySelector('.inventory-workspace');
    const charts = document.querySelector('.inventory-charts');
    if (!table || !workspace || !charts) return renderInventory();
    const items = scopedItems(table);
    workspace.innerHTML = tableMarkup(table, items);
    charts.innerHTML = chart('Status nesta página', items, 'status', statuses) + chart('Situação nesta página', items, 'situation', situations, 'situation-');
    applyInventoryCleaningColumn(table);
    ensureFilterEmptyRow(table);
    setupInventoryAddMenu(table);
    applyInventoryFilters();
  }

  function branchForm(branch = null) {
    const node = modal(`<form data-inv-branch-form class="table-form"><h2>${branch ? 'Renomear ramificação' : 'Nova ramificação'}</h2><label class="table-form-label">Nome da ramificação <b>*</b><input class="table-form-input" name="name" required maxlength="80" value="${escape(branch?.name || '')}" autofocus></label><div class="table-form-actions"><button class="table-form-submit" type="submit">Salvar</button><button class="table-form-cancel" type="button" data-inv-close>Cancelar</button></div></form>`, 'table-form-dialog');
    node.dataset.branchId = branch?.id || '';
  }

  async function showClassificationSimulation() {
    const snapshot = await moduleApi().load();
    currentSimulationReport = branchModel.simulation(snapshot.tables);
    const entries = Object.entries(currentSimulationReport.counts).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
    modal(`<div class="inv-dialog-head"><h2>Simulação de ramificações</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">Prévia somente leitura. Nenhum equipamento foi alterado.</p><div class="inventory-simulation-summary"><strong>${currentSimulationReport.total} equipamentos</strong><span>${currentSimulationReport.pending.length} pendentes de revisão</span></div><div class="inventory-simulation-list">${entries.map(([label, count]) => `<div><span>${escape(label)}</span><b>${count}</b></div>`).join('') || '<p>Nenhum equipamento carregado.</p>'}</div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Fechar</button><button type="button" class="inv-primary" data-inv-action="download-branch-report">Exportar relatório JSON</button></div>`, 'equipment-dialog');
  }

  function emptyPresentationMarkup() {
    const template = document.createElement('template');
    template.innerHTML = emptyMarkup();
    const illustration = template.content.querySelector('.inventory-empty-illustration');
    const illustrationMarkup = illustration?.outerHTML || '';
    illustration?.remove();
    return { illustration: illustrationMarkup, emptyState: template.innerHTML };
  }

  function inventoryScanScene() {
    return `<svg class="inventory-scan-art" viewBox="0 0 620 112" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><linearGradient id="inventory-scan-beam"><stop stop-color="#35dfff" stop-opacity="0"/><stop offset=".5" stop-color="#35dfff" stop-opacity=".38"/><stop offset="1" stop-color="#35dfff" stop-opacity="0"/></linearGradient></defs>
      <g class="inventory-scan-floor"><path d="M29 94h562M58 107h504M112 79h397M116 80l-46 27m112-27-30 27m112-27-14 27m100-27 14 27m70-27 30 27m70-27 46 27"/></g>
      <g class="inventory-scan-input"><rect x="38" y="30" width="63" height="52" rx="9"/><path d="M48 45h41M48 57h30M48 68h23"/><circle cx="87" cy="68" r="4"/></g>
      <g class="inventory-scan-route"><path d="M102 56h88m240 0h87"/><circle cx="160" cy="56" r="3"/><circle cx="472" cy="56" r="3"/></g>
      <g class="inventory-scan-rack"><rect x="190" y="10" width="240" height="91" rx="12"/><path d="M190 55h240M270 10v91m80-91v91"/></g>
      <g class="inventory-scan-assets">
        <g class="inventory-scan-asset a"><rect x="208" y="23" width="42" height="22" rx="4"/><path d="M216 29h26m-26 7h15"/></g>
        <g class="inventory-scan-asset b"><rect x="289" y="20" width="42" height="28" rx="4"/><path d="m297 27 13-5 13 5-13 5-13-5Zm0 0v13l13 6 13-6V27m-13 5v14"/></g>
        <g class="inventory-scan-asset c"><rect x="367" y="23" width="42" height="22" rx="4"/><path d="M375 29h26m-26 7h19"/></g>
        <g class="inventory-scan-asset d"><rect x="208" y="68" width="42" height="21" rx="4"/><path d="M216 75h26m-26 7h16"/></g>
        <g class="inventory-scan-asset e"><rect x="289" y="67" width="42" height="23" rx="4"/><path d="M297 75h26m-26 7h18"/></g>
        <g class="inventory-scan-asset f"><rect x="367" y="67" width="42" height="23" rx="4"/><path d="M375 75h26m-26 7h18"/></g>
      </g>
      <g class="inventory-scan-sweep"><rect x="189" y="12" width="52" height="87" fill="url(#inventory-scan-beam)"/><path d="M215 13v85"/></g>
      <g class="inventory-scan-location"><path d="M545 18c-16 0-28 12-28 28 0 20 28 47 28 47s28-27 28-47c0-16-12-28-28-28Z"/><circle cx="545" cy="46" r="10"/></g>
      <g class="inventory-scan-signal"><circle cx="117" cy="56" r="3"/><circle cx="495" cy="56" r="3"/><circle cx="545" cy="46" r="3"/></g>
    </svg>`;
  }

  function emptyMarkup() {
    if (controlMode) return controlEmptyMarkup();
    if (fluxMode) return fluxDetailedEmptyMarkupV2();
    return `<section class="inventory-selection-empty-state" aria-labelledby="inventory-empty-title"><div class="inventory-empty-content"><svg class="inventory-empty-illustration" viewBox="0 0 420 260" role="img" aria-label="Cubos coloridos flutuando"><defs><g id="inventory-empty-cube" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 1 43 13.5 22 26 1 13.5 22 1Z"/><path d="M1 13.5 22 26v25L1 38.5v-25Z"/><path d="M22 26 43 13.5v25L22 51V26Z"/><path d="M1 13.5 22 26l21-12.5M22 26v25"/></g></defs><g class="inventory-empty-object inventory-empty-object-main"><use href="#inventory-empty-cube" transform="translate(145 73) scale(2.95)"/></g><g class="inventory-empty-object inventory-empty-object-purple"><use href="#inventory-empty-cube" transform="translate(76 42) scale(.94)"/></g><g class="inventory-empty-object inventory-empty-object-cyan"><use href="#inventory-empty-cube" transform="translate(308 20) scale(1.14)"/></g><g class="inventory-empty-object inventory-empty-object-lilac"><use href="#inventory-empty-cube" transform="translate(38 112) scale(.91)"/></g><g class="inventory-empty-object inventory-empty-object-green"><use href="#inventory-empty-cube" transform="translate(106 184) scale(.86)"/></g><g class="inventory-empty-object inventory-empty-object-yellow"><use href="#inventory-empty-cube" transform="translate(302 184) scale(.83)"/></g><circle class="inventory-empty-object inventory-empty-dot-one" cx="127" cy="142" r="5"/><circle class="inventory-empty-object inventory-empty-dot-two" cx="147" cy="184" r="4.5"/><circle class="inventory-empty-object inventory-empty-dot-three" cx="294" cy="166" r="4"/></svg><h2 id="inventory-empty-title">Nenhuma tabela selecionada</h2><p>Selecione uma tabela na lateral</p></div></section>`;
  }

  function controlEmptyMarkup() {
    return `<section class="inventory-selection-empty-state control-empty-state" aria-labelledby="inventory-empty-title"><div class="inventory-empty-content"><svg class="inventory-empty-illustration control-empty-illustration" viewBox="0 0 420 230" role="img" aria-label="Ferramentas de manutenção flutuando"><defs><g id="control-empty-wrench-symbol" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4.6a6.4 6.4 0 0 0-8.1 7.9L3.8 21.6a2.4 2.4 0 1 0 3.4 3.4l9.1-9.1A6.4 6.4 0 0 0 24 7.8l-4.8 4.8-3.8-1.1-1.1-3.8L21 4.6Z"/></g><g id="control-empty-lightning-symbol" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 2-10 13h7l-1 8 10-13h-7l1-8Z"/><path d="m2 8-1.5-1M23 9l1.5-1M18 23v1.5" stroke-width="1.4"/></g><g id="control-empty-hammer-symbol" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 4.5 5 5-3 3-2.1-2.1L6 18.8a2.2 2.2 0 1 1-3.1-3.1l8.4-8.4L9.2 5.2l3-3 2.3 2.3Z"/><path d="m4.5 20.5 1.2-1.2" stroke-width="1.4"/></g><g id="control-empty-gear-symbol" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="6.4"/><circle cx="12" cy="12" r="2.7"/><path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M19.2 4.8l-2.1 2.1M6.9 17.1l-2.1 2.1"/></g></defs><g class="inventory-empty-object inventory-empty-object-main control-empty-wrench"><use href="#control-empty-wrench-symbol" transform="translate(179 20) scale(2.05)"/></g><g class="inventory-empty-object inventory-empty-object-yellow control-empty-lightning"><use href="#control-empty-lightning-symbol" transform="translate(302 41) scale(1.8)"/></g><g class="inventory-empty-object inventory-empty-object-purple control-empty-hammer"><use href="#control-empty-hammer-symbol" transform="translate(92 129) scale(2.1)"/></g><g class="inventory-empty-object inventory-empty-object-lilac control-empty-gear"><use href="#control-empty-gear-symbol" transform="translate(258 140) scale(2.05)"/></g></svg><h2 id="inventory-empty-title">Nenhuma tabela selecionada</h2><p>Selecione uma tabela na lateral</p></div></section>`;
  }

  function fluxEmptyMarkup() {
    return `<section class="inventory-selection-empty-state flux-empty-state" aria-labelledby="inventory-empty-title"><div class="inventory-empty-content"><svg class="inventory-empty-illustration flux-empty-illustration" viewBox="0 0 520 245" role="img" aria-label="Caminhões em movimento, representando envio e recebimento"><defs><filter id="flux-empty-glow" x="-45%" y="-80%" width="190%" height="260%"><feGaussianBlur stdDeviation="3.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="flux-empty-road" x1="0" x2="1"><stop stop-color="#278ef3" stop-opacity="0"/><stop offset=".18" stop-color="#35caf6" stop-opacity=".92"/><stop offset=".5" stop-color="#8e6cff" stop-opacity=".72"/><stop offset=".82" stop-color="#f6a13b" stop-opacity=".88"/><stop offset="1" stop-color="#f2b34b" stop-opacity="0"/></linearGradient><g id="flux-empty-truck-right" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M8 30h56V11H20c-6 0-12 5-12 12v7Z" fill="currentColor" fill-opacity=".13" stroke-width="2.1"/><path d="M64 20h16l11 11v10H64V20Z" fill="currentColor" fill-opacity=".13" stroke-width="2.1"/><path d="M72 24h7l6 7H72v-7Z" stroke-width="1.7"/><path d="M8 41h83" stroke-width="2.1"/><circle cx="25" cy="44" r="6" fill="#09162c" stroke-width="2.1"/><circle cx="73" cy="44" r="6" fill="#09162c" stroke-width="2.1"/><path d="M1 28h7M-5 23h10M-11 18H3" stroke-width="1.6" opacity=".7"/></g><g id="flux-empty-truck-left" transform="translate(91 0) scale(-1 1)"><use href="#flux-empty-truck-right"/></g></defs><g class="flux-empty-road flux-empty-road-top"><path d="M25 72h470"/><path d="M25 82h470"/></g><g class="flux-empty-road flux-empty-road-bottom"><path d="M25 160h470"/><path d="M25 170h470"/></g><g transform="translate(0 35)"><g class="flux-empty-truck flux-empty-truck-right flux-empty-truck-right-one"><use href="#flux-empty-truck-right"/></g></g><g transform="translate(0 35)"><g class="flux-empty-truck flux-empty-truck-right flux-empty-truck-right-two"><use href="#flux-empty-truck-right"/></g></g><g transform="translate(0 122)"><g class="flux-empty-truck flux-empty-truck-left flux-empty-truck-left-one"><use href="#flux-empty-truck-left"/></g></g><g transform="translate(0 122)"><g class="flux-empty-truck flux-empty-truck-left flux-empty-truck-left-two"><use href="#flux-empty-truck-left"/></g></g><g class="flux-empty-arrows flux-empty-arrows-right" transform="translate(420 48)"><path d="m0 0 11 11L0 22M16 0l11 11-11 11"/></g><g class="flux-empty-arrows flux-empty-arrows-left" transform="translate(73 137)"><path d="m27 0-11 11 11 11M11 0 0 11l11 11"/></g></svg><h2 id="inventory-empty-title">Nenhuma tabela selecionada</h2><p>Selecione uma tabela na lateral</p></div></section>`;
  }

  function fluxDetailedEmptyMarkup() {
    return `<section class="inventory-selection-empty-state flux-empty-state" aria-labelledby="inventory-empty-title"><div class="inventory-empty-content"><svg class="inventory-empty-illustration flux-empty-illustration" viewBox="0 0 520 245" role="img" aria-label="Caminhões, rotas e centros de distribuição"><defs><filter id="flux-empty-glow-detail" x="-45%" y="-80%" width="190%" height="260%"><feGaussianBlur stdDeviation="3.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter><linearGradient id="flux-empty-road-detail" x1="0" x2="1"><stop stop-color="#278ef3" stop-opacity="0"/><stop offset=".18" stop-color="#35caf6" stop-opacity=".92"/><stop offset=".5" stop-color="#8e6cff" stop-opacity=".72"/><stop offset=".82" stop-color="#f6a13b" stop-opacity=".88"/><stop offset="1" stop-color="#f2b34b" stop-opacity="0"/></linearGradient><g id="flux-detail-truck-right" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M8 30h56V11H20c-6 0-12 5-12 12v7Z" fill="currentColor" fill-opacity=".14" stroke-width="2.1"/><path d="M13 26h46M17 16h42M17 20h42M17 24h25" stroke-width=".85" opacity=".56"/><rect x="34" y="16" width="12" height="8" rx="1.5" fill="currentColor" fill-opacity=".14" stroke-width="1"/><path d="m37 20 2 2 4-5" stroke-width="1.15"/><path d="M64 20h16l11 11v10H64V20Z" fill="currentColor" fill-opacity=".14" stroke-width="2.1"/><path d="M72 24h7l6 7H72v-7Z" fill="currentColor" fill-opacity=".16" stroke-width="1.7"/><path d="M64 34h27M68 38h10" stroke-width=".9" opacity=".6"/><path d="M8 41h83" stroke-width="2.1"/><circle cx="25" cy="44" r="6" fill="#09162c" stroke-width="2.1"/><circle cx="25" cy="44" r="2.1" fill="currentColor" stroke="none"/><circle cx="73" cy="44" r="6" fill="#09162c" stroke-width="2.1"/><circle cx="73" cy="44" r="2.1" fill="currentColor" stroke="none"/><path d="M88 34h5" stroke="#f8edc7" stroke-width="2.2"/><path d="M1 28h7M-5 23h10M-11 18H3" stroke-width="1.6" opacity=".7"/></g><g id="flux-detail-truck-left" transform="translate(91 0) scale(-1 1)"><use href="#flux-detail-truck-right"/></g><g id="flux-detail-depot" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2 34V13l18-10 18 10v21" fill="currentColor" fill-opacity=".08" stroke-width="1.7"/><path d="M8 34V19h24v15M12 24h3m5 0h3m5 0h2M4 13h32" stroke-width="1.25"/><path d="M17 34V22h6v12" stroke-width="1.2"/></g><g id="flux-detail-package" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m0 5 9-5 9 5v11l-9 5-9-5V5Z"/><path d="m0 5 9 5 9-5M9 10v11"/></g></defs><rect class="flux-empty-road-surface" x="24" y="58" width="472" height="31" rx="15"/><rect class="flux-empty-road-surface" x="24" y="146" width="472" height="31" rx="15"/><g class="flux-empty-road flux-empty-road-top"><path d="M25 72h470"/><path d="M25 82h470"/></g><g class="flux-empty-road flux-empty-road-bottom"><path d="M25 160h470"/><path d="M25 170h470"/></g><g class="flux-empty-depot flux-empty-depot-origin" transform="translate(20 10)"><use href="#flux-detail-depot"/></g><g class="flux-empty-depot flux-empty-depot-destination" transform="translate(460 187)"><use href="#flux-detail-depot"/></g><g class="flux-empty-route-node flux-empty-route-node-top" transform="translate(150 72)"><circle r="5"/><circle r="1.8"/></g><g class="flux-empty-route-node flux-empty-route-node-top flux-empty-route-node-second" transform="translate(357 72)"><circle r="5"/><circle r="1.8"/></g><g class="flux-empty-route-node flux-empty-route-node-bottom" transform="translate(160 160)"><circle r="5"/><circle r="1.8"/></g><g class="flux-empty-route-node flux-empty-route-node-bottom flux-empty-route-node-second" transform="translate(363 160)"><circle r="5"/><circle r="1.8"/></g><g class="flux-empty-package flux-empty-package-one" transform="translate(252 23)"><use href="#flux-detail-package"/></g><g class="flux-empty-package flux-empty-package-two" transform="translate(290 199)"><use href="#flux-detail-package"/></g><g transform="translate(0 35)"><g class="flux-empty-truck flux-empty-truck-right flux-empty-truck-right-one"><use href="#flux-detail-truck-right"/></g></g><g transform="translate(0 35)"><g class="flux-empty-truck flux-empty-truck-right flux-empty-truck-right-two"><use href="#flux-detail-truck-right"/></g></g><g transform="translate(0 122)"><g class="flux-empty-truck flux-empty-truck-left flux-empty-truck-left-one"><use href="#flux-detail-truck-left"/></g></g><g transform="translate(0 122)"><g class="flux-empty-truck flux-empty-truck-left flux-empty-truck-left-two"><use href="#flux-detail-truck-left"/></g></g><g class="flux-empty-arrows flux-empty-arrows-right" transform="translate(420 48)"><path d="m0 0 11 11L0 22M16 0l11 11-11 11"/></g><g class="flux-empty-arrows flux-empty-arrows-left" transform="translate(73 137)"><path d="m27 0-11 11 11 11M11 0 0 11l11 11"/></g></svg><h2 id="inventory-empty-title">Nenhuma tabela selecionada</h2><p>Selecione uma tabela na lateral</p></div></section>`;
  }

  function fluxDetailedEmptyMarkupV2() {
    return `<section class="inventory-selection-empty-state flux-empty-state" aria-labelledby="inventory-empty-title"><div class="inventory-empty-content"><svg class="inventory-empty-illustration flux-empty-illustration" viewBox="0 0 520 245" role="img" aria-label="Caminhões, rotas e centros de distribuição"><defs>
      <filter id="flux-empty-glow-detail" x="-45%" y="-80%" width="190%" height="260%"><feGaussianBlur stdDeviation="3.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <linearGradient id="flux-empty-road-detail" x1="0" x2="1"><stop stop-color="#278ef3" stop-opacity="0"/><stop offset=".18" stop-color="#35caf6" stop-opacity=".92"/><stop offset=".5" stop-color="#8e6cff" stop-opacity=".72"/><stop offset=".82" stop-color="#f6a13b" stop-opacity=".88"/><stop offset="1" stop-color="#f2b34b" stop-opacity="0"/></linearGradient>
      <g id="flux-detail-truck-right" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M8 30h56V11H20c-6 0-12 5-12 12v7Z" fill="currentColor" fill-opacity=".14" stroke-width="2.1"/><path d="M13 26h46M17 16h42M17 20h42M17 24h25" stroke-width=".85" opacity=".56"/><rect x="34" y="16" width="12" height="8" rx="1.5" fill="currentColor" fill-opacity=".14" stroke-width="1"/><path d="m37 20 2 2 4-5" stroke-width="1.15"/><path d="M64 20h16l11 11v10H64V20Z" fill="currentColor" fill-opacity=".14" stroke-width="2.1"/><path d="M72 24h7l6 7H72v-7Z" fill="currentColor" fill-opacity=".16" stroke-width="1.7"/><path d="M64 34h27M68 38h10" stroke-width=".9" opacity=".6"/><path d="M8 41h83" stroke-width="2.1"/><circle cx="25" cy="44" r="6" fill="#09162c" stroke-width="2.1"/><circle cx="25" cy="44" r="2.1" fill="currentColor" stroke="none"/><circle cx="73" cy="44" r="6" fill="#09162c" stroke-width="2.1"/><circle cx="73" cy="44" r="2.1" fill="currentColor" stroke="none"/><path d="M88 34h5" stroke="#f8edc7" stroke-width="2.2"/><path d="M1 28h7M-5 23h10M-11 18H3" stroke-width="1.6" opacity=".7"/></g>
      <g id="flux-detail-truck-left" transform="translate(91 0) scale(-1 1)"><use href="#flux-detail-truck-right"/></g>
      <g id="flux-detail-depot" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M2 34V13l18-10 18 10v21" fill="currentColor" fill-opacity=".08" stroke-width="1.7"/><path d="M8 34V19h24v15M12 24h3m5 0h3m5 0h2M4 13h32" stroke-width="1.25"/><path d="M17 34V22h6v12" stroke-width="1.2"/></g>
      <g id="flux-detail-package" fill="currentColor" fill-opacity=".13" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="m0 5 9-5 9 5v11l-9 5-9-5V5Z"/><path d="m0 5 9 5 9-5M9 10v11"/></g>
    </defs>
    <rect class="flux-empty-road-surface" x="24" y="58" width="472" height="31" rx="15"/><rect class="flux-empty-road-surface" x="24" y="146" width="472" height="31" rx="15"/>
    <g class="flux-empty-road flux-empty-road-top"><path d="M25 72h470"/><path d="M25 82h470"/></g><g class="flux-empty-road flux-empty-road-bottom"><path d="M25 160h470"/><path d="M25 170h470"/></g>
    <g transform="translate(20 10)"><g class="flux-empty-depot flux-empty-depot-origin"><use href="#flux-detail-depot"/></g></g><g transform="translate(460 187)"><g class="flux-empty-depot flux-empty-depot-destination"><use href="#flux-detail-depot"/></g></g>
    <g transform="translate(150 72)"><g class="flux-empty-route-node flux-empty-route-node-top"><circle r="5"/><circle r="1.8"/></g></g><g transform="translate(357 72)"><g class="flux-empty-route-node flux-empty-route-node-top flux-empty-route-node-second"><circle r="5"/><circle r="1.8"/></g></g><g transform="translate(160 160)"><g class="flux-empty-route-node flux-empty-route-node-bottom"><circle r="5"/><circle r="1.8"/></g></g><g transform="translate(363 160)"><g class="flux-empty-route-node flux-empty-route-node-bottom flux-empty-route-node-second"><circle r="5"/><circle r="1.8"/></g></g>
    <g transform="translate(252 23)"><g class="flux-empty-package flux-empty-package-one"><use href="#flux-detail-package"/></g></g><g transform="translate(290 199)"><g class="flux-empty-package flux-empty-package-two"><use href="#flux-detail-package"/></g></g>
    <g transform="translate(0 35)"><g class="flux-empty-truck flux-empty-truck-right flux-empty-truck-right-one"><use href="#flux-detail-truck-right"/></g></g><g transform="translate(0 35)"><g class="flux-empty-truck flux-empty-truck-right flux-empty-truck-right-two"><use href="#flux-detail-truck-right"/></g></g><g transform="translate(0 122)"><g class="flux-empty-truck flux-empty-truck-left flux-empty-truck-left-one"><use href="#flux-detail-truck-left"/></g></g><g transform="translate(0 122)"><g class="flux-empty-truck flux-empty-truck-left flux-empty-truck-left-two"><use href="#flux-detail-truck-left"/></g></g>
    <g transform="translate(420 48)"><g class="flux-empty-arrows flux-empty-arrows-right"><path d="m0 0 11 11L0 22M16 0l11 11-11 11"/></g></g><g transform="translate(73 137)"><g class="flux-empty-arrows flux-empty-arrows-left"><path d="m27 0-11 11 11 11M11 0 0 11l11 11"/></g></g>
    </svg><h2 id="inventory-empty-title">Nenhuma tabela selecionada</h2><p>Selecione uma tabela na lateral</p></div></section>`;
  }

  function fluxMovementIndicator(movement) {
    const label = String(movement || '');
    if (label !== 'Envio' && label !== 'Recebimento') {
      return `<span class="inventory-movement ${className(label)}">${escape(label)}</span>`;
    }
    return `<span class="inventory-movement-icon ${className(label)}" role="img" aria-label="${label}" title="${label}"><svg viewBox="0 0 18 24" aria-hidden="true" focusable="false"><path d="M9 0 18 10h-5v14H5V10H0Z"/></svg></span>`;
  }

  const fluxIcon = name => {
    const paths = {
      direction: '<path fill="currentColor" stroke="none" d="M12 1 22 12h-5v11H7V12H2z"/>',
      send: '<circle cx="12" cy="12" r="9"/><path d="M8 16l7-7m-5 0h5v5"/>',
      entry: '<rect x="3" y="3" width="18" height="18" rx="6"/><path d="m8 12 3 3 5-6"/>',
      connector: '<path d="M1 12h5m4 0h5m4 0h9m-5-5 5 5-5 5"/>',
      tag: '<path d="M3 4h8l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 10h18m-13 5h4"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
      plane: '<path d="M21 3 3 10l8 4 4 7 6-18Zm0 0L11 14"/>',
      return: '<path d="M9 5 4 10l5 5m-5-5h10a6 6 0 0 1 0 12H7"/>',
      swap: '<path d="M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5"/>',
      history: '<path d="M4 12a8 8 0 1 1 2 5m-3-6 1 3 3-1m5-6v6l3 2"/>'
    };
    return `<svg viewBox="${name === 'connector' ? '0 5 30 14' : '0 0 24 24'}" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
  };

  function fluxTableMarkup(table) {
    return `<div class="module-table-nav flux-module-table-nav">${tableControls.homeButton('Início do Flux')}</div>
      ${tableControls.filters({
        name: 'Flux', table, tables: data.tables, state, statuses, situations, situationLabel: 'Motivo',
        placeholder: 'Buscar equipamento, TAG, nº de série, empresa...', actions: tableToolbarActions()
      })}
      <section class="flux-card-list" aria-label="Equipamentos movimentados"></section>`;
  }

  const fluxGroups = (table, filters) => window.AldeckotFluxCycles?.groups(data.tables, table.id, filters) || [];
  function fluxCardMarkup(group) {
    const item = group.latest;
    const cycle = group.cycle;
    const outbound = cycle?.send || (item.movement === 'Envio' ? item : null);
    const inbound = cycle?.entry || (item.movement === 'Recebimento' ? item : null);
    const direction = item.movement === 'Recebimento' ? 'entry' : 'send';
    const sent = outbound?.sendDate ? dateValue(outbound.sendDate) : '—';
    const sender = escape(outbound?.senderCompany || 'Origem não informada');
    const destination = escape(inbound?.destinationCompany || outbound?.destinationCompany || 'Destino não informado');
    const arrivalDate = inbound?.receivedDate || outbound?.deliveredAt ||
      (['Entregue', 'Recebido'].includes(outbound?.status) ? outbound?.receivedDate : null);
    const arrivalLabel = inbound ? (inbound.returnOf ? 'Retorno' : 'Entrada')
      : outbound?.deliveredAt ? 'Entrega' : arrivalDate ? 'Data registrada' : 'Entrada';
    const arrivalDisplay = outbound?.deliveredAt && !inbound
      ? dateTimeValue(outbound.deliveredAt) : arrivalDate ? dateValue(arrivalDate) : 'Sem confirmação';
    return `<article class="flux-card" data-inv-item="${escape(item.id)}" data-inv-table-id="${escape(item.tableId || '')}" tabindex="0" role="button" aria-label="Abrir histórico de ${escape(item.equipment)}">
      <span class="flux-card-direction ${direction}" aria-hidden="true">${fluxIcon('direction')}</span>
      <div class="flux-card-identity"><b>${escape(item.equipment)}</b><small>${escape([item.brand, item.model].filter(Boolean).join(' · ') || 'Marca não informada')}</small><span>TAG: ${escape(item.tag || 'não informada')}</span></div>
      <div class="flux-card-route">
        <div class="flux-card-step send"><div class="flux-card-pill">${fluxIcon('send')}<div><b>Saída</b><time>${sent}</time></div></div><small title="${sender}">${sender}</small></div>
        <span class="flux-card-connector" aria-hidden="true">${fluxIcon('connector')}</span>
        <div class="flux-card-step entry"><div class="flux-card-pill">${fluxIcon('entry')}<div><b>${arrivalLabel}</b><time>${arrivalDisplay}</time></div></div><small title="${destination}">${destination}</small></div>
        ${group.cycles.length > 1 ? `<span class="flux-card-cycle-count">${group.cycles.length} ciclos</span>` : ''}
      </div>
      <div class="flux-card-meta">
        <span>${fluxIcon('tag')}<span>Motivo: ${escape(item.situation || '—')}</span></span>
        <span>${fluxIcon('calendar')}<span>Enviado: ${sent}</span></span>
        ${inbound?.receivedDate ? `<span>${fluxIcon('clock')}<span>Recebido: ${dateValue(inbound.receivedDate)}</span></span>` : ''}
      </div>
      <span class="flux-card-status ${className(item.status)}">${escape(item.status || '—')}</span>
    </article>`;
  }

  function fluxHomeListing() {
    const query = comparable(globalState.query);
    const groups = data.tables.flatMap(table => fluxGroups(table, {}).map(group => ({ ...group, tableName: table.name })))
      .filter(group => !query || [group.tableName, ...group.items.flatMap(item => [item.equipment, item.tag, item.serial,
        item.brand, item.model, item.senderCompany, item.destinationCompany])].some(value => comparable(value).includes(query)))
      .sort((a, b) => String(b.latest.receivedDate || b.latest.sendDate || b.latest.updatedAt || '')
        .localeCompare(String(a.latest.receivedDate || a.latest.sendDate || a.latest.updatedAt || '')));
    const all = globalState.view === 'all' || Boolean(query);
    const pageSize = Math.max(1, Number(globalState.pageSize) || 25);
    const pages = Math.max(1, Math.ceil(groups.length / pageSize));
    const page = Math.max(1, Math.min(Number(globalState.page) || 1, pages));
    return { total: groups.length, pages, page, all,
      rows: all ? groups.slice((page - 1) * pageSize, page * pageSize) : groups.slice(0, 5) };
  }
  function fluxHomeCardsMarkup() {
    const rows = fluxHomeListing().rows;
    return rows.length ? rows.map(group => `<div class="flux-home-entry"><span class="flux-home-period">${escape(tableControls.periodLabel({ name: group.tableName }))}</span>${fluxCardMarkup(group)}</div>`).join('')
      : '<p class="inventory-panel flux-home-empty">Nenhuma movimentação encontrada.</p>';
  }
  function fluxHomePaginationMarkup() {
    const { total, pages, page, rows, all } = fluxHomeListing();
    return `<span>${all ? `${total} ${total === 1 ? 'equipamento encontrado' : 'equipamentos encontrados'}` : `${rows.length} equipamentos recentes · ${total} no Flux`}</span>
      ${all ? `<nav aria-label="Páginas da consulta"><button type="button" data-inv-module-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button><span>Página ${page} de ${pages}</span><button type="button" data-inv-module-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Próxima página">›</button></nav>` : `<button type="button" class="flux-home-show-all" data-inv-module-all>Ver todos</button>`}`;
  }
  function fluxHomeMarkup() {
    return `<section class="module-table-filters flux-home-filters" aria-label="Buscar movimentações do Flux">
      <label class="module-table-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 5 5"/></svg><input type="search" data-inv-module-search aria-label="Buscar em todo o Flux" placeholder="Buscar equipamento, TAG, série ou mês..." value="${escape(globalState.query)}"></label>
    </section><section class="flux-card-list flux-home-list" aria-label="Movimentações recentes">${fluxHomeCardsMarkup()}</section>
    <footer class="inventory-panel inventory-pagination inventory-module-pagination flux-home-pagination">${fluxHomePaginationMarkup()}</footer>`;
  }

  function fluxSidebarMarkup(items) {
    const statusCounts = countBy(items, statuses, 'status');
    const reasonCounts = countBy(items, situations, 'situation');
    const statusColors = { Pendente: '#ffc31c', Recebido: '#26cfab', Entregue: '#15be71', 'Em Trânsito': '#9147da' };
    const reasonColors = { Manutenção: '#9147d9', Troca: '#268fe9', Aquisição: '#13ce7d', Transferência: '#fa880e', Substituição: '#ffc21e' };
    const max = Math.max(1, ...Object.values(statusCounts));
    const total = items.length;
    let angle = 0;
    const segments = situations.map(reason => {
      const start = angle;
      angle += total ? (reasonCounts[reason] || 0) / total * 360 : 0;
      return `${reasonColors[reason]} ${start}deg ${angle}deg`;
    }).join(', ');
    const legend = (labels, counts, colors) => `<div class="flux-side-legend">${labels.map(label => `<span><i style="--legend-color:${colors[label]}"></i>${escape(label)}<b>${counts[label] || 0}</b></span>`).join('')}</div>`;
    const actions = [
      ['flux-new-send', 'plane', 'Novo Envio'], ['flux-return', 'return', 'Registrar Retorno'],
      ['flux-delivery', 'entry', 'Confirmar Entrega'], ['flux-replace', 'swap', 'Substituição'],
      ['flux-history', 'history', 'Histórico Geral']
    ];
    return `<section class="inventory-panel flux-side-panel"><h3>Distribuição por Status</h3>
      <div class="flux-status-bars" role="img" aria-label="Distribuição de ${total} movimentações por status">${statuses.map(status => `<span style="--bar-height:${Math.max(4, Math.round((statusCounts[status] || 0) / max * 64))}px;--bar-color:${statusColors[status]}" title="${escape(status)}: ${statusCounts[status] || 0}"></span>`).join('')}</div>
      ${legend(statuses, statusCounts, statusColors)}</section>
      <section class="inventory-panel flux-side-panel"><h3>Distribuição por Motivo</h3>
        <div class="flux-reasons"><div class="flux-reason-donut" style="--donut:${total ? `conic-gradient(${segments})` : 'conic-gradient(#36516e 0deg 360deg)'}" role="img" aria-label="${total} movimentações por motivo"><b>${total}<small>Total</small></b></div>${legend(situations, reasonCounts, reasonColors)}</div>
      </section>
      <section class="inventory-panel flux-side-panel flux-quick-actions"><h3>Ações Rápidas</h3>
        ${actions.map(([id, icon, label]) => `<button type="button" data-inv-action="${id}">${fluxIcon(icon)}<span>${label}</span></button>`).join('')}
      </section>`;
  }

  function inventoryRowMarkup(table, item) {
    const changedAt = branchModel.lastChangedAt(item);
    return `<tr data-inv-item="${escape(item.id)}"><td><b>${escape(item.equipment)}</b></td><td>${escape(item.tag)}</td><td>${escape(item.model)}</td><td>${escape(item.brand)}</td><td>${escape(item.sector || '—')}</td><td>${escape(item.location || '—')}</td><td><span class="inventory-status ${className(item.status)}">${escape(item.status)}</span></td><td><span class="inventory-situation ${className(item.situation)}">${escape(item.situation)}</span></td><td>${cleaningPill(item.cleaning || 'Não realizada')}</td><td>${dateTimeValue(changedAt)}</td></tr>`;
  }

  function inventoryTableMarkup(table, visible) {
    const initial = visible.slice(0, state.pageSize);
    const filters = tableControls.filters({
      name: 'Inventário', table, tables: data.tables, state, statuses, situations, byCategory: true,
      placeholder: 'Buscar equipamento, TAG, modelo, marca...',
      actions: '<div class="inventory-toolbar-create"><button class="inventory-add" type="button" data-inv-action="add-item">＋ Adicionar</button></div>' + tableToolbarActions()
    });
    return `${filters}
      <section class="inventory-panel inventory-data-wrap"><table class="inventory-data" data-inv-standard-columns="true"><thead><tr><th>EQUIPAMENTO</th><th>TAG</th><th>MODELO</th><th>MARCA</th><th>SETOR</th><th>LOCAL</th><th>STATUS</th><th>SITUAÇÃO</th><th>LIMPEZA</th><th>ÚLTIMA ALTERAÇÃO</th></tr></thead><tbody>${initial.length ? initial.map(item => inventoryRowMarkup(table, item)).join('') : '<tr><td colspan="10" class="inventory-empty-row">Nenhum equipamento nesta categoria.</td></tr>'}</tbody></table></section>`;
  }

  function tableMarkup(table, visible) {
    if (controlMode) return controlBoard.tableMarkup(table, data.tables, state);
    if (fluxMode) return fluxTableMarkup(table);
    return branchNavigationMarkup(table) + inventoryTableMarkup(table, visible);
  }

  function removeOpenModals() {
    document.querySelectorAll('.inv-modal').forEach(openModal => openModal.remove());
  }

  function modal(content, dialogClass = '', statusColor = '') {
    // Alguns fluxos atualizam o conteúdo do mesmo equipamento (por exemplo,
    // ao abrir o menu Ação). O modal anterior precisa sair antes de montar o
    // próximo, ou os controles ficam empilhados e parecem exigir dois cliques.
    removeOpenModals();
    const glowClass = statusColor ? ' inv-status-glow' : '';
    const glowStyle = statusColor ? ` style="--inv-modal-status-color:${statusColor}"` : '';
    const node = document.createElement('div');
    node.className = 'inv-modal';
    node.innerHTML = `<div class="inv-dialog ${dialogClass}${glowClass}"${glowStyle}>${content}</div>`;
    for (const input of node.querySelectorAll('[data-inv-item-form] input[name="sector"]')) {
      const select = document.createElement('select');
      select.name = 'sector';
      select.dataset.invSectorChoice = '';
      const current = input.value || '';
      const options = window.AldeckotSectors?.optionsFor(current) || ['', current, 'Frente de Loja', 'Doca', 'Escritório', 'Informática', 'Monitoramento', 'Tesouraria', 'Padaria', 'Açougue', 'Refeitório'].filter((value, index, all) => value || !index).filter((value, index, all) => all.indexOf(value) === index);
      select.innerHTML = options.map(value => `<option value="${escape(value)}" ${value === current ? 'selected' : ''}>${escape(value || 'Selecione um setor')}</option>`).join('');
      input.replaceWith(select);
    }
    window.AldeckotActionMenus?.enhance(node);
    node.addEventListener('click', event => {
      if (event.target !== node) return;
      event.preventDefault();
      event.stopPropagation();
    });
    document.body.appendChild(node);
    return node;
  }
  function applyStatusModalGlow(node, status) {
    const dialog = node?.querySelector('.inv-dialog');
    if (!dialog) return;
    dialog.classList.add('inv-status-glow');
    dialog.style.setProperty('--inv-modal-status-color', chartColor('status', status));
  }
  function closeModal() { state.itemActionMenu = false; removeOpenModals(); }

  function tableForm(entry) {
    const value = entry || {};
    const node = modal(`<form class="table-form" data-inv-table-form><h2>${entry ? 'Editar Tabela' : 'Nova Tabela'}</h2><label class="table-form-label" for="inventory-table-name">Nome da Tabela <b>*</b><input id="inventory-table-name" class="table-form-input" name="name" required maxlength="40" value="${escape(value.name)}" placeholder="${escape(moduleConfig.tablePlaceholder)}" autofocus></label><div class="table-form-actions"><button class="table-form-submit" type="submit">${entry ? 'Salvar' : 'Criar'}</button><button class="table-form-cancel" type="button" data-inv-close>Cancelar</button></div></form>`, 'table-form-dialog');
    node.dataset.tableId = entry?.id || '';
  }

  function itemForm(entry) {
    if (controlMode) { controlItemForm(entry); return; }
    if (fluxMode) { fluxItemForm(entry); return; }
    if (!activeTable()) { tableForm(); return; }
    const value = entry || {};
    const status = statuses.includes(value.status) ? value.status : 'Ativo';
    const situation = situations.includes(value.situation) ? value.situation : 'Normal';
    const priority = priorities.includes(value.priority) ? value.priority : 'Estável';
    const node = modal(`<div class="inv-dialog-head"><h2>${entry ? 'Editar Equipamento' : 'Adicionar Equipamento'}</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><form data-inv-item-form><div class="inv-fields equipment-fields"><label><span>Equipamento *</span><input name="equipment" required value="${escape(value.equipment)}"></label><label><span>Modelo</span><input name="model" value="${escape(value.model)}"></label><label><span>Marca</span><input name="brand" value="${escape(value.brand)}"></label><label><span>Nº Série</span><input name="serial" value="${escape(value.serial)}"></label><label><span>TAG</span><input name="tag" value="${escape(value.tag)}"></label><label><span>Setor</span><input name="sector" value="${escape(value.sector)}"></label><label><span>Local</span><input name="location" value="${escape(value.location)}"></label><label class="inv-choice-field" data-inv-choice-field data-kind="status" data-tone="${choiceTone('status', status)}"><span>Status</span><div class="inv-choice-select"><i></i><select name="status" data-inv-status-choice>${statuses.map(option => `<option ${status === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-choice-field" data-inv-choice-field data-kind="priority" data-tone="${choiceTone('priority', priority)}"><span>Prioridade</span><div class="inv-choice-select"><i></i><select name="priority" data-inv-priority-choice>${priorities.map(option => `<option ${priority === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-choice-field" data-inv-choice-field data-kind="situation" data-tone="${choiceTone('situation', situation)}"><span>Situação</span><div class="inv-choice-select"><i></i><select name="situation" data-inv-situation-choice>${situations.map(option => `<option ${situation === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-full"><span>Observações</span><textarea name="notes">${escape(value.notes)}</textarea></label></div><div class="inv-footer equipment-footer">${entry ? `<button type="button" class="inv-ghost inv-danger" data-inv-delete-item="${entry.id}">Excluir</button>` : ''}<button class="inv-primary">Salvar</button><button type="button" class="inv-ghost" data-inv-close>Cancelar</button></div></form>`, 'equipment-dialog');
    const cleaning = cleanings.includes(value.cleaning) ? value.cleaning : 'Não realizada';
    const notesField = node.querySelector('textarea[name="notes"]')?.closest('label');
    if (entry) {
      const locationInput = node.querySelector('input[name="location"]');
      const reasonField = document.createElement('label');
      reasonField.className = 'inv-full';
      reasonField.innerHTML = '<span>Motivo da mudança de Local *</span><textarea name="movementReason" minlength="5" maxlength="300" placeholder="Explique a movimentação física do equipamento."></textarea>';
      notesField?.before(reasonField);
      const reasonInput = reasonField.querySelector('textarea');
      const usesPdv = location => /^PDV\s+[0-9]+$/i.test(String(location || '').trim());
      const updateReason = () => {
        const moving = String(locationInput?.value || '').trim() !== String(value.location || '').trim()
          && (usesPdv(locationInput?.value) || usesPdv(value.location));
        reasonField.hidden = !moving;
        reasonField.style.display = moving ? '' : 'none';
        reasonInput.required = moving;
        if (!moving) reasonInput.value = '';
      };
      locationInput?.addEventListener('input', updateReason);
      updateReason();
      node.dataset.movementOperationId = crypto.randomUUID();
      const verificationField = document.createElement('label');
      verificationField.className = 'inv-full';
      verificationField.innerHTML = '<span>Motivo da verificação *</span><textarea name="verificationReason" minlength="3" maxlength="2000" placeholder="Descreva o sintoma ou a ocorrência técnica."></textarea>';
      notesField?.before(verificationField);
      const verificationInput = verificationField.querySelector('textarea');
      const situationSelect = node.querySelector('[name="situation"]');
      const updateVerificationReason = () => {
        const starting = situationSelect?.value === 'Verificando' && entry.situation !== 'Verificando';
        verificationField.hidden = !starting;
        verificationField.style.display = starting ? '' : 'none';
        verificationInput.required = starting;
        if (!starting) verificationInput.value = '';
      };
      situationSelect?.addEventListener('change', updateVerificationReason);
      updateVerificationReason();
    }
    if (notesField) {
      const field = document.createElement(entry ? 'div' : 'label');
      field.className = 'inv-choice-field';
      field.dataset.invChoiceField = '';
      field.dataset.kind = 'cleaning';
      field.dataset.tone = choiceTone('cleaning', cleaning);
      field.innerHTML = '<span>Tipo de Limpeza</span><div class="inv-choice-select"><i></i><select name="cleaning" data-inv-cleaning-choice>' + cleanings.map(option => '<option' + (cleaning === option ? ' selected' : '') + '>' + escape(option) + '</option>').join('') + '</select></div>';
      if (entry && window.AldeckotEquipmentCleaning) {
        field.classList.add('equipment-cleaning-edit');
        field.innerHTML = '<span>Limpeza atual</span>' + cleaningPill(cleaning) +
          '<input type="hidden" name="cleaning" value="' + escape(cleaning) + '">' +
          '<button type="button" class="inv-ghost" data-register-inventory-cleaning>Registrar limpeza</button>';
        field.querySelector('button').onclick = () => window.AldeckotEquipmentCleaning.open({
          module: 'inventory',
          item: activeTable()?.items.find(item => item.id === entry.id) || entry,
          onSaved: async () => {
            if (!await reloadInventory()) throw new Error('Inventário indisponível.');
            const current = activeTable()?.items.find(item => item.id === entry.id);
            const label = field.querySelector('.cleaning-pill');
            if (current?.cleaning && label) {
              label.dataset.cleaning = current.cleaning;
              label.textContent = current.cleaning;
              field.querySelector('[name="cleaning"]').value = current.cleaning;
            }
            renderInventory();
            window.AldeckotMessage.show('Limpeza registrada.');
          }
        });
      }
      notesField.before(field);
    }
    if (activeTable()?.branches?.length) {
      const branchField = document.createElement('label');
      const selectedId = value.branchId || branchModel.branchFor(activeTable(), value)?.id || state.branchId || '';
      branchField.className = 'inv-choice-field';
      branchField.innerHTML = `<span>Categoria / Ramificação *</span><div class="inv-choice-select"><select name="branchId" required><option value="" disabled ${selectedId ? '' : 'selected'}>Selecione a ramificação</option>${activeTable().branches.map(branch => `<option value="${branch.id}" ${branch.id === selectedId ? 'selected' : ''}>${escape(branch.name)}</option>`).join('')}</select></div>`;
      notesField?.before(branchField);
    }
    node.dataset.itemId = entry?.id || '';
  }

  function transferForm(item) {
    const table = activeTable();
    if (!table || table.items.length < 2) { window.AldeckotMessage.show('É necessário outro equipamento na categoria para realizar a permuta.'); return; }
    const node = modal(`<div class="inv-dialog-head"><h2>Transferência · Permuta</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">Somente Setor e Local serão trocados. TAG, ramificação, status e histórico permanecem vinculados a cada equipamento.</p><form data-inv-transfer-form><div class="inv-fields equipment-fields">${table.branches?.length ? `<label><span>Ramificação do segundo equipamento</span><select name="branch"><option value="">Todas as ramificações</option>${table.branches.map(branch => `<option value="${branch.id}">${escape(branch.name)}</option>`).join('')}</select></label>` : ''}<label><span>Segundo equipamento *</span><select name="other" required><option value="">Selecione o equipamento</option></select></label><label class="inv-full"><span>Motivo da permuta *</span><textarea name="reason" required minlength="5" maxlength="500" placeholder="Explique a troca de posições físicas."></textarea></label></div><div class="inventory-transfer-preview" aria-live="polite"></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button type="submit" class="inv-primary">Confirmar permuta</button></div></form>`, 'equipment-dialog');
    node.dataset.itemId = item.id;
    node.dataset.operationId = crypto.randomUUID();
    node.dataset.firstSector = item.sector || '';
    node.dataset.firstLocation = item.location || '';
    const form = node.querySelector('[data-inv-transfer-form]');
    const branchSelect = form.querySelector('[name="branch"]');
    if (branchSelect) {
      branchSelect.options[0].text = 'Selecione uma ramificação';
      branchSelect.options[0].disabled = true;
      branchSelect.required = true;
      if (table.items.some(row => !branchModel.branchFor(table, row))) branchSelect.add(new Option('Sem ramificação', '__unassigned'));
    }
    const otherSelect = form.querySelector('[name="other"]');
    const preview = form.querySelector('.inventory-transfer-preview');
    const updateCandidates = () => {
      const chosenBranch = branchSelect?.value || '';
      otherSelect.innerHTML = '<option value="">Selecione o equipamento</option>' + table.items.filter(row => row.id !== item.id && (!table.branches?.length || (chosenBranch && (chosenBranch === '__unassigned' ? !branchModel.branchFor(table, row) : branchModel.inBranch(table, row, chosenBranch))))).map(row => `<option value="${row.id}">${escape(row.tag || row.equipment)} · ${escape(row.equipment)}</option>`).join('');
      preview.textContent = '';
    };
    branchSelect?.addEventListener('change', updateCandidates);
    otherSelect.addEventListener('change', () => {
      const other = table.items.find(row => row.id === otherSelect.value);
      node.dataset.secondSector = other?.sector || '';
      node.dataset.secondLocation = other?.location || '';
      preview.innerHTML = other ? `<div><b>${escape(item.tag || item.equipment)}</b><span>${escape(item.sector || '—')} / ${escape(item.location || '—')} → ${escape(other.sector || '—')} / ${escape(other.location || '—')}</span></div><div><b>${escape(other.tag || other.equipment)}</b><span>${escape(other.sector || '—')} / ${escape(other.location || '—')} → ${escape(item.sector || '—')} / ${escape(item.location || '—')}</span></div>` : '';
    });
    updateCandidates();
  }

  function replaceEquipmentForm(item) {
    if (controlMode || fluxMode || !inventoryIntegrationReady || item?.status !== 'Ativo') return;
    const candidates = activeTable()?.items.filter(row => row.id !== item.id && row.status === 'Reserva') || [];
    if (!candidates.length) { window.AldeckotMessage.show('Não há equipamento em Reserva nesta tabela.'); return; }
    const label = row => `${row.equipment || 'Equipamento'} · TAG ${row.tag || '—'} · Série ${row.serial || '—'} · Modelo ${row.model || '—'} · Setor ${row.sector || '—'} · Local ${row.location || '—'} · ${row.status || '—'}`;
    const preview = `<section class="inv-replacement-preview" data-inv-replacement-preview aria-live="polite"><div class="inv-replacement-preview-empty">Selecione o substituto para comparar os dois equipamentos.</div></section>`;
    const node = modal(`<div class="inv-dialog-head"><h2>Substituir ${escape(item.equipment)} · ${escape(item.tag || item.serial || 'Sem identificação')}</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">O equipamento retirado e o substituto permanecerão no Inventário, com históricos vinculados. A substituição aceita reservas de qualquer setor ou ramificação desta mesma tabela.</p><form data-inv-replace-form><div class="inv-fields equipment-fields"><label class="inv-full"><span>Substituto em Reserva *</span><select name="installed" data-inv-replacement-select required><option value="" selected disabled>Selecione o substituto</option>${candidates.map(row => `<option value="${escape(row.id)}">${escape(label(row))}</option>`).join('')}</select></label></div>${preview}<div class="inv-fields equipment-fields"><label><span>Condição final do retirado *</span><select name="removed_status" required><option value="" selected disabled>Selecione a condição</option>${['Manutenção','Defeito','Inativo'].map(status => `<option>${status}</option>`).join('')}</select></label><label><span>Destino do equipamento retirado *</span><input name="removed_location" required maxlength="160" placeholder="Ex.: Oficina, descarte autorizado"></label><label class="inv-full"><span>Motivo da substituição *</span><textarea name="reason" required maxlength="500"></textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button class="inv-primary" type="submit">Confirmar substituição</button></div></form>`, 'equipment-dialog');
    node.dataset.itemId = item.id;
    node.dataset.removedItem = JSON.stringify({equipment:item.equipment,tag:item.tag,serial:item.serial,model:item.model,sector:item.sector,location:item.location,status:item.status});
  }
  function updateReplacementPreview(node, replacementId) {
    const preview=node?.querySelector('[data-inv-replacement-preview]');
    const outgoing=JSON.parse(node?.dataset.removedItem||'null');
    const incoming=activeTable()?.items.find(row=>row.id===replacementId);
    if (!preview || !outgoing) return;
    if (!incoming) { preview.innerHTML='<div class="inv-replacement-preview-empty">Selecione o substituto para comparar os dois equipamentos.</div>'; return; }
    const fields=(row)=>[['TAG',row.tag],['Série',row.serial],['Modelo',row.model],['Setor',row.sector],['Local',row.location],['Status',row.status]];
    const card=(title,row,tone)=>`<article class="inv-replacement-side ${tone}"><h3>${escape(title)}</h3><b>${escape(row.equipment||'Equipamento')}</b><dl>${fields(row).map(([name,value])=>`<div><dt>${name}</dt><dd>${escape(value||'—')}</dd></div>`).join('')}</dl></article>`;
    preview.innerHTML=card('Equipamento retirado',outgoing,'removed')+`<span class="inv-replacement-arrow" aria-hidden="true">→</span>`+card('Substituto',incoming,'installed');
  }

  function setupFluxEquipmentSearch(node, entry) {
    const fields = node.querySelector('.flux-fields');
    if (!fields || !window.AldeckotFluxSearch) return;
    const wrapper = document.createElement('section');
    wrapper.className = 'flux-equipment-search inv-full';
    wrapper.innerHTML = `<label for="fluxEquipmentSearch">Buscar equipamento por TAG ou número de série</label><input id="fluxEquipmentSearch" type="search" autocomplete="off" spellcheck="false" placeholder="Digite a TAG ou o nº de série" aria-controls="fluxEquipmentResults"><p class="flux-equipment-search-status" role="status" aria-live="polite">A busca preenche apenas os dados técnicos; os demais campos permanecem como estão.</p><div id="fluxEquipmentResults" class="flux-equipment-search-results" role="listbox" hidden></div><p class="flux-equipment-selection" data-flux-selection hidden></p><button class="flux-equipment-clear" type="button" data-flux-clear hidden>Remover vínculo</button>`;
    fields.prepend(wrapper);
    const input = wrapper.querySelector('input');
    const status = wrapper.querySelector('[role="status"]');
    const list = wrapper.querySelector('[role="listbox"]');
    const selection = wrapper.querySelector('[data-flux-selection]');
    const clearButton = wrapper.querySelector('[data-flux-clear]');
    let sequence = 0;
    let timer;
    let results = [];
    let truncated = false;
    let selected = null;
    const setStatus = message => { status.textContent = message; };
    const clearSelection = () => {
      selected = null;
      delete node.dataset.sourceModule;
      delete node.dataset.sourceRecordId;
      delete node.dataset.inventoryItemId;
      selection.hidden = true;
      selection.textContent = '';
      clearButton.hidden = true;
    };
    const choose = row => {
      selected = row;
      node.dataset.sourceModule = row.module;
      node.dataset.sourceRecordId = row.id;
      if (row.inventoryItemId) node.dataset.inventoryItemId = row.inventoryItemId;
      else delete node.dataset.inventoryItemId;
      for (const name of ['equipment', 'brand', 'model', 'tag', 'serial']) {
        const field = fields.querySelector(`[name="${name}"]`);
        if (field) field.value = row[name] || '';
      }
      for (const name of ['sector', 'location']) {
        const field = fields.querySelector(`[name="${name}"]`);
        if (!field) continue;
        if (name === 'sector' && field.tagName === 'SELECT' && row[name] && ![...field.options].some(option => option.value === row[name]))
          field.add(new Option(row[name], row[name], true, true));
        field.value = row[name] || '';
        if (name === 'sector') {
          field.disabled = true;
          let official = fields.querySelector('input[type="hidden"][name="sector"]');
          if (!official) { official = document.createElement('input'); official.type = 'hidden'; official.name = 'sector'; fields.append(official); }
          official.value = row.sector || '';
        } else field.readOnly = true;
      }
      selection.textContent = `Selecionado: ${row.sourceLabel} · TAG ${row.tag || 'não informada'} · Série ${row.serial || 'não informada'} · Setor ${row.sector || 'não informado'} · Local ${row.location || 'não informado'}${row.inventoryItemId ? ' · vínculo patrimonial confirmado' : row.module === 'flux' ? ' · referência histórica, sem vínculo patrimonial presumido' : ''}`;
      selection.hidden = false;
      clearButton.hidden = false;
      list.hidden = true;
      setStatus(row.duplicateTag ? 'Há outra unidade com a mesma TAG. Confirme fisicamente o número de série antes de salvar.' : 'Dados técnicos preenchidos. Revise e complete os campos da movimentação.');
    };
    if (entry?.sourceModule && entry?.sourceRecordId) {
      node.dataset.sourceModule = entry.sourceModule;
      node.dataset.sourceRecordId = entry.sourceRecordId;
      if (entry.inventoryItemId) node.dataset.inventoryItemId = entry.inventoryItemId;
      selected = { module: entry.sourceModule, id: entry.sourceRecordId, tag: entry.tag, serial: entry.serial };
      for (const name of ['sector', 'location']) {
        const field = fields.querySelector(`[name="${name}"]`);
        if (!field) continue;
        field.disabled = name === 'sector';
        field.readOnly = name === 'location';
        if (name === 'sector') {
          let official = fields.querySelector('input[type="hidden"][name="sector"]');
          if (!official) { official = document.createElement('input'); official.type = 'hidden'; official.name = 'sector'; fields.append(official); }
          official.value = entry.sector || '';
        }
      }
      selection.textContent = `Vínculo salvo: ${entry.sourceModule} · TAG ${entry.tag || 'não informada'} · Série ${entry.serial || 'não informada'} · Setor ${entry.sector || 'não informado'} · Local ${entry.location || 'não informado'}`;
      selection.hidden = false;
      clearButton.hidden = false;
    }
    async function search(term, request) {
      setStatus('Consultando equipamentos…');
      list.hidden = true;
      try {
        const rows = await backend().central.search(term);
        if (request !== sequence || !node.isConnected) return;
        results = window.AldeckotFluxSearch.prepare(rows, term);
        truncated = rows.length >= 12;
        list.innerHTML = results.map((row, index) => `<button type="button" class="flux-equipment-result" role="option" data-flux-result="${index}" ${truncated ? 'disabled' : ''}><b>${escape(row.equipment || 'Equipamento')}</b><span>${escape([row.brand, row.model].filter(Boolean).join(' '))}</span><small>TAG: ${escape(row.tag || 'não informada')} · Série: ${escape(row.serial || 'não informada')}</small><em>${escape(row.sourceLabel)} · Setor ${escape(row.sector || 'não informado')} · Local ${escape(row.location || 'não informado')}</em>${row.duplicateTag ? '<strong>TAG repetida — confira a série</strong>' : ''}</button>`).join('');
        list.hidden = !results.length;
        setStatus(truncated ? 'A busca atingiu o limite de resultados. Refine pelo número de série para escolher com segurança.' : results.length ? `${results.length} resultado(s). Selecione explicitamente o equipamento correto.` : 'Nenhum resultado encontrado. Você pode preencher a movimentação manualmente.');
      } catch (error) {
        if (request !== sequence || !node.isConnected) return;
        results = [];
        setStatus(`Busca indisponível: ${backendMessage(error)}. O preenchimento manual continua disponível.`);
      }
    }
    input.addEventListener('input', () => {
      const request = ++sequence;
      clearTimeout(timer);
      results = [];
      list.hidden = true;
      if (selected) {
        clearSelection();
        setStatus('Busca alterada: escolha novamente o equipamento para manter o vínculo correto.');
      }
      const term = input.value.trim();
      if (term.length < 2) { setStatus('Digite ao menos dois caracteres da TAG ou série.'); return; }
      timer = setTimeout(() => search(term, request), 240);
    });
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (results.length === 1 && !truncated) choose(results[0]);
      else if (results.length > 1) setStatus('Há mais de um equipamento. Escolha pelo número de série.');
      else { clearTimeout(timer); search(input.value.trim(), ++sequence); }
    });
    list.addEventListener('click', event => {
      const button = event.target.closest('[data-flux-result]');
      if (!button || button.disabled) return;
      const row = results[Number(button.dataset.fluxResult)];
      if (row) choose(row);
    });
    clearButton.addEventListener('click', () => {
      clearSelection();
      const sector = fields.querySelector('[name="sector"]');
      const location = fields.querySelector('[name="location"]');
      if (sector) sector.disabled = false;
      if (location) location.readOnly = false;
      fields.querySelector('input[type="hidden"][name="sector"]')?.remove();
      setStatus('Vínculo removido. Os dados preenchidos permanecem no formulário para revisão manual.');
    });
    fields.addEventListener('input', event => {
      if (!selected || !['tag', 'serial'].includes(event.target.name)) return;
      const previous = selected[event.target.name];
      if (window.AldeckotFluxSearch.normalize(previous) !== window.AldeckotFluxSearch.normalize(event.target.value)) {
        clearSelection();
        setStatus('TAG ou série alterada: vínculo anterior removido. Pesquise novamente ou salve sem associação.');
      }
    });
  }

  function fluxItemForm(entry) {
    if (!activeTable()) { tableForm(); return; }
    const value = entry || {};
    const movement = moduleConfig.movements.includes(value.movement) ? value.movement : moduleConfig.movementDefault;
    const shippingType = moduleConfig.shippingTypes.includes(value.shippingType) ? value.shippingType : moduleConfig.shippingDefault;
    const status = statuses.includes(value.status) ? value.status : moduleConfig.statusDefault;
    const situation = situations.includes(value.situation) ? value.situation : moduleConfig.situationDefault;
    const priority = priorities.includes(value.priority) ? value.priority : 'Estável';
    const choice = (name, label, values, selected, kind) => `<label class="inv-choice-field" data-inv-choice-field data-kind="${kind}" data-tone="${choiceTone(kind, selected)}"><span>${label} *</span><div class="inv-choice-select"><i></i><select name="${name}" data-inv-${kind}-choice required>${values.map(option => `<option ${selected === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label>`;
    const node = modal(`<div class="inv-dialog-head"><h2>${entry ? 'Editar Movimentação' : 'Adicionar Movimentação'}</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><form data-inv-item-form><div class="inv-fields equipment-fields flux-fields">${choice('movement', 'Movimentação', moduleConfig.movements, movement, 'movement')}<label><span>Equipamento *</span><input name="equipment" required value="${escape(value.equipment)}"></label><label><span>Modelo *</span><input name="model" required value="${escape(value.model)}"></label><label><span>Marca *</span><input name="brand" required value="${escape(value.brand)}"></label><label><span>TAG *</span><input name="tag" required value="${escape(value.tag)}"></label><label><span>Nº Série *</span><input name="serial" required value="${escape(value.serial)}"></label><label><span>Setor</span><input name="sector" value="${escape(value.sector)}"></label><label><span>Local</span><input name="location" value="${escape(value.location)}"></label><label><span>Empresa Remetente *</span><input name="senderCompany" required value="${escape(value.senderCompany)}"></label><label><span>Empresa Destino *</span><input name="destinationCompany" required value="${escape(value.destinationCompany)}"></label><label><span>Responsável Envio *</span><input name="senderResponsible" required value="${escape(value.senderResponsible)}"></label><label><span>Responsável Recebimento *</span><input name="receiverResponsible" required value="${escape(value.receiverResponsible)}"></label><label><span>Data de Envio *</span><input name="sendDate" type="date" required value="${escape(value.sendDate)}"></label><label><span>Data de Recebimento *</span><input name="receivedDate" type="date" required value="${escape(value.receivedDate)}"></label>${choice('shippingType', 'Tipo de Envio', moduleConfig.shippingTypes, shippingType, 'shipping')}${choice('situation', 'Motivo', situations, situation, 'situation')}${choice('status', 'Status', statuses, status, 'status')}${choice('priority', 'Prioridade', priorities, priority, 'priority')}<label class="inv-full"><span>Observações</span><textarea name="notes">${escape(value.notes)}</textarea></label></div><div class="inv-footer equipment-footer">${entry ? `<button type="button" class="inv-ghost inv-danger" data-inv-delete-item="${entry.id}">Excluir</button>` : ''}<button class="inv-primary">Salvar</button><button type="button" class="inv-ghost" data-inv-close>Cancelar</button></div></form>`, 'equipment-dialog flux-dialog');
    node.dataset.itemId = entry?.id || '';
    setupFluxEquipmentSearch(node, entry);
    if (!entry) {
      node.querySelector('.inv-dialog-head h2').textContent = 'Novo Envio';
      const form = node.querySelector('[data-inv-item-form]');
      const movementSelect = form.querySelector('[name="movement"]');
      const statusSelect = form.querySelector('[name="status"]');
      movementSelect.value = 'Envio';
      movementSelect.disabled = true;
      statusSelect.value = 'Pendente';
      statusSelect.disabled = true;
      for (const [name, value] of [['movement', 'Envio'], ['status', 'Pendente']]) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden'; hidden.name = name; hidden.value = value;
        form.appendChild(hidden);
      }
      const tag = form.querySelector('[name="tag"]');
      tag.required = false;
      tag.closest('label').querySelector('span').textContent = 'TAG (opcional para equipamento novo)';
      const recipient = form.querySelector('[name="receiverResponsible"]');
      recipient.required = false;
      recipient.closest('label').querySelector('span').textContent = 'Responsável recebimento (quando conhecido)';
      const received = form.querySelector('[name="receivedDate"]');
      received.required = false;
      received.closest('label').querySelector('span').textContent = 'Data de recebimento (deixar vazia até ocorrer)';
      form.querySelector('[name="sendDate"]').value ||= new Date().toLocaleDateString('en-CA');
    }
  }

  function controlItemForm(entry) {
    if (!activeTable()) { tableForm(); return; }
    const value = entry || {};
    const status = statuses.includes(value.status) ? value.status : moduleConfig.statusDefault;
    const controlStatuses = value.followUpKind === 'verification'
      ? (value.status === 'Verificação concluída' ? ['Verificação concluída'] : ['Aguardando avaliação', 'Verificação concluída'])
      : statuses.filter(option => option !== 'Verificação concluída' && (option !== 'Cancelado' || status === 'Cancelado'));
    const situation = situations.includes(value.situation) ? value.situation : moduleConfig.situationDefault;
    const priority = priorities.includes(value.priority) ? value.priority : 'Estável';
    const node = modal(`<div class="inv-dialog-head"><h2>${entry ? 'Editar Equipamento' : 'Adicionar Equipamento'}</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><form data-inv-item-form><div class="inv-fields equipment-fields"><label><span>Equipamento *</span><input name="equipment" required value="${escape(value.equipment)}"></label><label><span>Modelo *</span><input name="model" required value="${escape(value.model)}"></label><label><span>Marca</span><input name="brand" value="${escape(value.brand)}"></label><label><span>Nº Série</span><input name="serial" value="${escape(value.serial)}"></label><label><span>TAG</span><input name="tag" value="${escape(value.tag)}"></label><label><span>Setor</span><input name="sector" value="${escape(value.sector)}"></label><label><span>Data de Entrada</span><input name="entryDate" type="date" value="${escape(value.entryDate)}"></label><label><span>Data de Saída</span><input name="exitDate" type="date" value="${escape(value.exitDate)}"></label><label class="inv-choice-field" data-inv-choice-field data-kind="status" data-tone="${choiceTone('status', status)}"><span>Status</span><div class="inv-choice-select"><i></i><select name="status" data-inv-status-choice>${controlStatuses.map(option => `<option ${status === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-choice-field" data-inv-choice-field data-kind="priority" data-tone="${choiceTone('priority', priority)}"><span>Prioridade</span><div class="inv-choice-select"><i></i><select name="priority" data-inv-priority-choice>${priorities.map(option => `<option ${priority === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-choice-field" data-inv-choice-field data-kind="cleaning" data-tone="${choiceTone('cleaning', situation)}"><span>Tipo de Limpeza</span><div class="inv-choice-select"><i></i><select name="situation" data-inv-cleaning-choice>${situations.map(option => `<option ${situation === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div></label><label class="inv-full"><span>Observações</span><textarea name="notes">${escape(value.notes)}</textarea></label></div><div class="inv-footer equipment-footer">${entry ? `<button type="button" class="inv-ghost inv-danger" data-inv-delete-item="${entry.id}">Excluir</button>` : ''}<button class="inv-primary">Salvar</button><button type="button" class="inv-ghost" data-inv-close>Cancelar</button></div></form>`, 'equipment-dialog');
    node.dataset.itemId = entry?.id || '';
    const fields = node.querySelector('.equipment-fields');
    const technicalStatus = fields?.querySelector('[name="status"]')?.closest('label');
    if (technicalStatus) technicalStatus.querySelector('span').textContent = 'Estado técnico do acompanhamento';
    if (!entry) {
      fields?.insertAdjacentHTML('afterbegin', controlBoardFields({ operationalStatus: 'Em manutenção' }, !data.controlBoardReady));
      if (!data.controlBoardReady) fields?.insertAdjacentHTML('afterbegin',
        '<p class="inv-full control-board-feedback">A classificação operacional depende da ativação da nova estrutura.</p>');
    }
    setupControlEquipmentSearch(node, value);
  }

  function controlBoardFields(item, disabled = false) {
    return `<label><span>Status operacional</span><select name="operationalStatus"${disabled ? ' disabled' : ''}>
      <option value="">Usar classificação legada quando inequívoca</option>${controlBoard.options(controlBoard.statuses, item.operationalStatus)}</select></label>
      <label><span>Situação</span><select name="operationalSituation"${disabled ? ' disabled' : ''}><option value="">Sem situação definida</option>
      ${controlBoard.options(controlBoard.situations, item.operationalSituation)}</select></label>`;
  }

  function controlClassificationForm(item) {
    const node = modal(`<div class="inv-dialog-head"><h2>Classificação operacional · ${escape(item.equipment)}</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div>
      <form class="control-board-dialog-form"><div class="inv-fields">${controlBoardFields(item)}</div>
      <p class="control-board-feedback" role="status"></p><div class="inv-footer"><button type="submit" class="inv-primary">Salvar classificação</button>
      <button type="button" class="inv-ghost" data-inv-close>Cancelar</button></div></form>`, 'equipment-dialog');
    const form = node.querySelector('form');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true;
      let saved = false;
      try {
        await moduleApi().saveBoardClassification(item, Object.fromEntries(new FormData(form)));
        saved = true;
        await reloadInventory();
        renderInventory();
        if (node.isConnected) details(activeTable()?.items.find(candidate => candidate.id === item.id) || item);
      } catch (error) {
        form.querySelector('.control-board-feedback').textContent = saved
          ? 'Classificação salva. Reabra a tabela para ver os dados atualizados.' : backendMessage(error);
      } finally { submit.disabled = saved; }
    });
  }

  function controlEquipmentOptions(items) {
    return '<option value="">Selecione um equipamento</option>' + items.map(item =>
      `<option value="${escape(item.id)}">${escape([item.equipment, item.tag || item.serial, item.sector].filter(Boolean).join(' · '))}</option>`).join('');
  }

  function controlActivityForm(kind) {
    const isPart = kind === 'part';
    const title = isPart ? 'Solicitar peça' : 'Planejar manutenção preventiva';
    const items = activeTable()?.items || [];
    const fields = isPart
      ? `<label>Peça<input name="part" required maxlength="160"></label><label>Quantidade<input name="quantity" type="number" min="1" max="2147483647" step="1" required></label>
         <label>Prioridade<select name="priority" required>${priorities.map(value => `<option>${value}</option>`).join('')}</select></label>
         <label class="inv-full">Justificativa<textarea name="reason" required maxlength="500"></textarea></label>`
      : `<label>Atividade<input name="activity" required maxlength="160"></label><label>Data prevista<input name="dueDate" type="date" required></label>
         <label>Responsável<input name="responsible" required maxlength="120"></label>`;
    const node = modal(`<div class="inv-dialog-head"><h2>${title}</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div>
      <form class="control-board-dialog-form"><div class="inv-fields">
        <label class="inv-full">Equipamento<select name="itemId" required>${controlEquipmentOptions(items)}</select></label>${fields}
        <label class="inv-full">Observações<textarea name="notes" maxlength="500"></textarea></label></div>
        <p class="control-board-feedback" role="status">${data.controlBoardReady ? '' : 'A gravação deste formulário depende da ativação da nova estrutura do Controle TI.'}</p>
        <div class="inv-footer"><button type="submit" class="inv-primary"${!data.controlBoardReady || !items.length ? ' disabled' : ''}>Registrar</button>
        <button type="button" class="inv-ghost" data-inv-close>Cancelar</button></div></form>`, 'equipment-dialog');
    const form = node.querySelector('form');
    let lastRequest;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      const { itemId, ...fields } = Object.fromEntries(new FormData(form));
      const draft = JSON.stringify({ itemId, fields });
      if (lastRequest?.draft !== draft) lastRequest = { draft, id: crypto.randomUUID() };
      submit.disabled = true;
      try {
        await moduleApi().recordBoardActivity(itemId, kind, fields, lastRequest.id);
        if (node.isConnected) closeModal();
        window.AldeckotMessage.show(isPart ? 'Solicitação de peça registrada.' : 'Manutenção preventiva planejada.');
      } catch (error) {
        form.querySelector('.control-board-feedback').textContent = backendMessage(error);
        submit.disabled = false;
      }
    });
  }

  async function controlTimeline(item) {
    if (data.controlBoardReady) return moduleApi().boardTimeline(item.id);
    const logs = (item.logs || []).map(log => ({
      occurred_at: log.createdAt, action: 'Registro do Controle TI', message: log.text, event_id: log.eventId
    }));
    const cases = await moduleApi().listCases(item.id);
    const caseDates = cases.flatMap(entry => {
      const title = entry.followup_kind === 'verification' ? 'Verificação' : 'Manutenção';
      return [
        { occurred_at: entry.opened_at, action: title, message: 'Abertura do chamado' },
        { occurred_at: entry.closed_at, action: title, message: 'Encerramento do chamado' }
      ].filter(row => row.occurred_at);
    });
    return [...logs, ...caseDates].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  }

  function controlTimelineMarkup(events) {
    return events.map(row => `<article class="inv-log control-board-timeline-entry">
      <b>${escape(row.action)} · ${escape(dateTimeValue(row.occurred_at))}</b><span>${escape(row.message || '—')}</span>
      ${row.event_id ? `<small>Evento ${escape(row.event_id)}</small>` : ''}</article>`).join('')
      || '<p>Nenhum evento foi localizado para este registro.</p>';
  }

  function controlReportForm() {
    const items = activeTable()?.items || [];
    const node = modal(`<div class="inv-dialog-head"><h2>Relatório por equipamento</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div>
      <div class="inv-fields"><label class="inv-full">Equipamento<select data-control-report-item>${controlEquipmentOptions(items)}</select></label></div>
      <div class="inv-log-list" role="status"></div>`, 'equipment-dialog');
    const select = node.querySelector('select');
    const timeline = node.querySelector('.inv-log-list');
    let sequence = 0;
    select.addEventListener('change', async () => {
      const request = ++sequence;
      const item = items.find(candidate => candidate.id === select.value);
      timeline.textContent = item ? 'Carregando histórico…' : '';
      if (!item) return;
      try {
        const events = await controlTimeline(item);
        if (sequence === request && node.isConnected) timeline.innerHTML = controlTimelineMarkup(events);
      } catch (error) {
        if (sequence === request && node.isConnected) timeline.textContent = backendMessage(error);
      }
    });
  }

  function setupControlEquipmentSearch(node, item) {
    const fields = node.querySelector('[data-inv-item-form] .equipment-fields');
    if (!fields) return;
    const wrapper = document.createElement('section');
    wrapper.className = 'flux-equipment-search inv-full control-source-search';
    wrapper.innerHTML = '<label>Identificar equipamento por TAG ou número de série</label><input type="search" autocomplete="off" spellcheck="false" placeholder="Digite a TAG ou o nº de série" aria-label="Buscar equipamento oficial"><p role="status" aria-live="polite">A identificação preenche os dados oficiais. Registros sem correspondência podem ser informados manualmente.</p><div role="listbox" hidden></div><p data-control-source-selection hidden></p><button type="button" data-control-source-clear hidden>Remover vínculo</button>';
    fields.prepend(wrapper);
    const query = wrapper.querySelector('input[type="search"]');
    const status = wrapper.querySelector('[role="status"]');
    const list = wrapper.querySelector('[role="listbox"]');
    const selection = wrapper.querySelector('[data-control-source-selection]');
    const clear = wrapper.querySelector('[data-control-source-clear]');
    const linkFields = ['inventoryItemId','managementRecordId','supplyUnitId'];
    const identityFields = ['equipment','model','brand','serial','tag','sector'];
    let sequence = 0;
    let timer;
    let results = [];
    let selected = null;
    const hidden = (name, value) => {
      let input = node.querySelector(`input[type="hidden"][name="${name}"]`);
      if (!input) { input=document.createElement('input'); input.type='hidden'; input.name=name; fields.append(input); }
      input.value=value || '';
    };
    const setOfficial = row => {
      for (const name of identityFields) {
        const control=node.querySelector(`[name="${name}"]`);
        if (!control) continue;
        const value=row[name] || '';
        if (control.tagName==='SELECT' && value && ![...control.options].some(option=>option.value===value))
          control.add(new Option(value,value,true,true));
        control.value=value;
        control.disabled=true;
        hidden(name,value);
      }
    };
    const releaseIdentity = () => {
      for (const name of identityFields) {
        const control=node.querySelector(`[name="${name}"]`);
        if (control) control.disabled=false;
      }
      for (const name of [...identityFields,...linkFields]) node.querySelector(`input[type="hidden"][name="${name}"]`)?.remove();
    };
    const describe = row => `${row.sourceLabel || row.module || 'Cadastro oficial'} · TAG ${row.tag || 'não informada'} · Série ${row.serial || 'não informada'} · Setor ${row.sector || 'não informado'} · Local ${row.location || 'não informado'}`;
    const bind = row => {
      selected=row;
      releaseIdentity();
      setOfficial(row);
      hidden('inventoryItemId',row.module==='inventory'?row.id:'');
      hidden('managementRecordId',row.module==='management'?row.id:'');
      hidden('supplyUnitId',row.module==='supplies'?row.id:'');
      for (const name of identityFields) {
        const control=node.querySelector(`[name="${name}"]`);
        if(control) control.disabled=true;
      }
      selection.textContent=`Vínculo oficial selecionado: ${describe(row)}. Para corrigir Setor, Local ou identificação, altere a fonte oficial.`;
      selection.hidden=false;
      clear.hidden=false;
      list.hidden=true;
      status.textContent=row.duplicateTag?'TAG repetida: confira série e setor antes de selecionar.':'Dados oficiais vinculados; identificação bloqueada neste módulo consumidor.';
    };
    const existing=item.inventoryItemId||item.managementRecordId||item.supplyUnitId;
    if (existing) {
      for (const name of identityFields) {
        const control=node.querySelector(`[name="${name}"]`);
        if(control){control.disabled=true;hidden(name,item[name]||'');}
      }
      for (const name of linkFields) hidden(name,item[name]||'');
      selection.textContent=`Origem oficial vinculada (${item.inventoryItemId?'Inventário':item.managementRecordId?'Gestão TI':'Suprimentos'}): ${item.equipment} · TAG ${item.tag||'não informada'} · Série ${item.serial||'não informada'} · Setor ${item.sector||'não informado'}. Corrija esses dados na fonte oficial.`;
      selection.hidden=false;
      status.textContent='Identificação e Setor oficiais bloqueados neste módulo consumidor.';
      clear.remove();
      query.disabled=true;
      return;
    }
    const search=async term=>{
      const request=++sequence;
      status.textContent='Consultando Inventário, Gestão TI e Suprimentos…';
      list.hidden=true;
      try {
        const rows=await backend().central.search(term);
        if(request!==sequence||!node.isConnected)return;
        results=window.AldeckotFluxSearch?.prepare(rows,term)||rows;
        list.replaceChildren();
        for(const row of results){
          const button=document.createElement('button');button.type='button';button.dataset.controlSourceResult=String(results.indexOf(row));
          button.textContent=`${row.equipment||'Equipamento'} · ${describe(row)}`;
          list.append(button);
        }
        list.hidden=!results.length;
        status.textContent=results.length?'Selecione o cadastro correto; correspondências ambíguas permanecem separadas.':'Nenhuma correspondência. Você pode continuar sem vínculo e sem inventar dados.';
      }catch(error){if(request===sequence)status.textContent=`Busca indisponível: ${backendMessage(error)}. Você ainda pode cadastrar sem vínculo.`;}
    };
    query.addEventListener('input',()=>{
      clearTimeout(timer);list.hidden=true;results=[];
      const term=query.value.trim();
      if(term.length<2){status.textContent='Digite ao menos dois caracteres da TAG ou série.';return;}
      timer=setTimeout(()=>void search(term),240);
    });
    query.addEventListener('keydown',event=>{
      if(event.key!=='Enter')return;event.preventDefault();
      if(results.length===1)bind(results[0]);
      else if(results.length>1)status.textContent='Há várias correspondências. Escolha o equipamento exato na lista.';
      else void search(query.value.trim());
    });
    list.addEventListener('click',event=>{
      const button=event.target.closest('[data-control-source-result]');
      if(button&&results[Number(button.dataset.controlSourceResult)])bind(results[Number(button.dataset.controlSourceResult)]);
    });
    clear.addEventListener('click',()=>{
      selected=null;releaseIdentity();selection.hidden=true;clear.hidden=true;
      status.textContent='Vínculo removido. Os campos voltaram a ser editáveis; preencha apenas dados confirmados.';
    });
  }

  function itemActionMenu(item) {
    return `<span class="inv-item-action-menu-wrap"><button class="inv-item-action-trigger" type="button" data-inv-action="toggle-item-actions" aria-haspopup="menu" aria-expanded="${state.itemActionMenu}">Ação <svg viewBox="0 0 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>${state.itemActionMenu ? `<span class="inv-item-action-menu" role="menu"><button type="button" data-inv-edit-item="${escape(item.id)}" role="menuitem"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg>Editar</button><button class="danger" type="button" data-inv-delete-item="${escape(item.id)}" role="menuitem"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg>Excluir</button></span>` : ''}</span>`;
  }

  async function refreshInstallationDetail(node) {
    if (!node?.isConnected || !backend().inventory?.peripheralInstallation) return;
    const field = [...node.querySelectorAll('.inv-detail')]
      .find(detail => detail.querySelector('span')?.textContent === 'Local de instalação');
    const value = field?.querySelector('b');
    if (!value) return;
    const itemId = node.dataset.itemId;
    try {
      const assignment = await backend().inventory.peripheralInstallation(itemId);
      if (!node.isConnected || node.dataset.itemId !== itemId) return;
      const physicalLocation = assignment?.terminal || node.dataset.inventoryLocation || '—';
      value.textContent = assignment?.computer || assignment?.computerTag
        ? `${physicalLocation} — PC ${assignment.computerTag || 'sem TAG'} (${assignment.computer || 'nome não informado'})`
        : assignment ? `${physicalLocation} — sem PC instalado` : physicalLocation;
    } catch (error) {
      console.warn('Não foi possível consultar o PC atual da posição:', error);
    }
  }

  function details(item) {
    if (controlMode) { controlDetails(item); return; }
    if (fluxMode) { fluxDetails(item); return; }
    const table = activeTable();
    const branch = branchModel.branchFor(table, item);
    const branches = branchModel.branchesFor(table, item);
    const field = (label, value, tone = '', action = '', markup = escape(value || '—')) => `<div class="inv-detail ${tone}"><span>${label}</span><div class="inv-detail-value"><b>${markup}</b>${action}</div></div>`;
    const section = (title, fields) => `<section class="inv-equipment-section"><h3>${title}</h3><div class="inv-detail-grid">${fields.join('')}</div></section>`;
    const image = escape(imageKey(branchModel.categoryForTable(table), item.brand, item.model));
    const latest = branchModel.lastChangedAt(item);
    const logActions = entry => entry.id && !entry.eventId ? `<div class="inv-log-actions"><button class="inv-log-action edit" data-inv-action="edit-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Editar registro" aria-label="Editar registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inv-log-action delete" data-inv-action="delete-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Excluir registro" aria-label="Excluir registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div>` : '';
    const replacementAction=!controlMode&&!fluxMode&&inventoryIntegrationReady&&item.status==='Ativo'?`<button type="button" class="inv-replacement-inline" data-inv-replace-item="${escape(item.id)}">Substituir</button>`:'';
    const node = modal(`<div class="inv-dialog-head"><div><small class="inv-equipment-eyebrow">INVENTÁRIO / ${escape(table?.name || '—')}</small><h2>${escape(item.equipment)}</h2><p class="inv-equipment-subtitle">${escape(item.tag || 'TAG não informada')} · ${escape(item.model || 'Modelo não informado')}</p></div><div class="inv-dialog-head-actions">${itemActionMenu(item)}<button class="inv-close" data-inv-close aria-label="Fechar detalhes">×</button></div></div><div class="inv-equipment-top"><div class="inv-equipment-image"><span class="inventory-image-placeholder" aria-hidden="true">◇</span><img data-inv-image-key="${image}" alt="Imagem de ${escape(item.equipment)}" decoding="async" hidden></div><div class="inv-equipment-summary">${section('Identificação', [field('Equipamento', item.equipment), field('TAG', item.tag), field('Nº de série', item.serial), field('Categoria', table?.name), ...(branches.length ? [field('Ramificações', branches.map(entry => entry.name).join(' · '))] : []), field('Marca', item.brand), field('Modelo', item.model, '', replacementAction)])}</div></div>${section('Localização', [field('Setor', item.sector), field('Local de instalação', item.location)])}${section('Estado atual', [field('Status', item.status, `inv-priority-detail priority-${choiceTone('status', item.status)}`), field('Situação', item.situation), field('Tipo de limpeza', item.cleaning, '', '', cleaningPill(item.cleaning)), field('Prioridade', item.priority || 'Estável')])}${section('Informações complementares', [field('Data de cadastro', dateTimeValue(item.createdAt)), field('Última alteração', dateTimeValue(latest)), field('Observações', item.notes)])}<div class="inv-log-head"><h3>Histórico</h3><button class="inv-log-add" data-inv-action="add-log" data-inv-log-item="${item.id}">＋ Adicionar registro</button></div><div class="inv-log-list">${(item.logs || []).map(entry => `<div class="inv-log"><b>${escape(entry.at)}</b><span>${escape(entry.text)}</span>${logActions(entry)}</div>`).join('') || '<div class="inv-log">Nenhum registro no histórico.</div>'}</div><div class="inv-actions"><button class="inv-ghost" data-inv-close>Fechar</button></div>`, 'inv-equipment-detail-dialog');
    node.dataset.itemId = item.id;
    node.dataset.inventoryLocation = item.location || '';
    void refreshInstallationDetail(node);
    if (canManage()) node.querySelector('.inv-actions')?.insertAdjacentHTML('afterbegin', `<button type="button" class="inv-primary" data-inv-transfer-item="${item.id}">Transferência</button>${table?.branches?.length ? `<button type="button" class="inv-ghost" data-inv-manage-shares="${item.id}">Ramificações</button>` : ''}`);
    applyStatusModalGlow(node, item.status);
    void applySharedImages();
  }

  function shareDialog(item) {
    const table = activeTable();
    if (!table || !item || !canManage()) return;
    const primary = branchModel.branchFor(table, item);
    const shared = new Set(item.sharedBranchIds || []);
    const rows = (table.branches || []).map(branch => {
      const isPrimary = primary?.id === branch.id;
      const isShared = shared.has(branch.id);
      return `<div class="inventory-share-row"><div><b>${escape(branch.name)}</b><small>${isPrimary ? 'Principal' : isShared ? 'Compartilhada' : 'Não vinculada'}</small></div>${isPrimary ? '' : `<button type="button" data-inv-share-${isShared ? 'remove' : 'add'}="${escape(branch.id)}" data-inv-share-item="${escape(item.id)}">${isShared ? 'Remover' : 'Compartilhar'}</button>`}</div>`;
    }).join('') || '<p>Nenhuma ramificação criada nesta categoria.</p>';
    modal(`<div class="inv-dialog-head"><h2>Ramificações de ${escape(item.equipment)}</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">O mesmo cadastro pode aparecer em várias ramificações desta categoria. Status, localização e histórico continuam únicos.</p><div class="inventory-share-list">${rows}</div><div class="inv-actions"><button type="button" class="inv-ghost" data-inv-close>Fechar</button></div>`, 'inventory-share-dialog');
  }

  function controlDetails(item) {
    const labels = [['equipment', 'Equipamento'], ['model', 'Modelo'], ['brand', 'Marca'], ['serial', 'Nº de série'], ['tag', 'TAG'], ['sector', 'Setor'], ['entryDate', 'Data de Entrada'], ['exitDate', 'Data de Saída'], ['status', 'Estado técnico do acompanhamento'], ['priority', 'Prioridade do chamado'], ['situation', 'Limpeza no chamado'], ['date', 'Atualizado'], ['notes', 'Observações']];
    const display = (key, value) => key === 'entryDate' || key === 'exitDate' ? dateValue(value) : (value || '—');
    const logActions = entry => entry.id && !entry.eventId ? `<div class="inv-log-actions"><button class="inv-log-action edit" data-inv-action="edit-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Editar registro" aria-label="Editar registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inv-log-action delete" data-inv-action="delete-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Excluir registro" aria-label="Excluir registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div>` : '';
    const node = modal(`<div class="inv-dialog-head"><h2>${escape(item.equipment)}</h2><div class="inv-dialog-head-actions">${itemActionMenu(item)}<button class="inv-close" data-inv-close>×</button></div></div><div class="inv-detail-grid">${labels.map(([key, label]) => `<div class="inv-detail ${key === 'notes' ? 'inv-full' : ''}${key === 'priority' ? ` inv-priority-detail priority-${choiceTone('priority', item[key])}` : ''}">${label}<b>${key === 'situation' ? cleaningPill(item[key]) : escape(key === 'priority' ? (item[key] || 'Estável') : display(key, item[key]))}</b></div>`).join('')}</div><div class="inv-log-head"><h3>Histórico</h3><button class="inv-log-add" data-inv-action="add-log" data-inv-log-item="${item.id}">＋ Adicionar registro</button></div><div class="inv-log-list">${(item.logs || []).map(entry => `<div class="inv-log"><b>${escape(entry.at)}</b><span>${escape(entry.text)}</span>${logActions(entry)}</div>`).join('') || '<div class="inv-log">Nenhum registro no histórico.</div>'}</div><div class="inv-actions"><button class="inv-ghost" data-inv-close>Fechar</button></div>`);
    node.dataset.itemId = item.id;
    node.querySelector('.inv-detail-grid')?.insertAdjacentHTML('afterbegin',
      `<div class="inv-detail">Status operacional<b>${controlBoard.pill(controlBoard.statusFor(item), controlBoard.statuses, { legacy: item.status })}</b></div>
       <div class="inv-detail">Situação do chamado<b>${controlBoard.pill(controlBoard.situationFor(item), controlBoard.situations, { empty: 'Sem situação definida' })}</b></div>
       ${item.equipmentState?.situation ? '<div class="inv-detail">Situação física atual<b>' + escape(item.equipmentState.situation) + '</b></div>' : ''}
       ${item.equipmentState?.cleaning_type ? '<div class="inv-detail">Limpeza atual no cadastro<b>' + cleaningPill(item.equipmentState.cleaning_type) + '</b></div>' : ''}`);
    if (canManage() && data.controlBoardReady) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'inv-ghost';
      edit.textContent = 'Editar classificação';
      edit.addEventListener('click', () => controlClassificationForm(item));
      node.querySelector('.inv-actions')?.prepend(edit);
    }
    if (data.controlBoardReady) {
      const timeline = document.createElement('section');
      timeline.className = 'inv-equipment-section';
      timeline.innerHTML = '<h3>Classificação e atividades</h3><div class="inv-log-list" role="status">Carregando histórico…</div>';
      node.querySelector('.inv-log-head')?.before(timeline);
      controlTimeline(item).then(events => {
        if (node.isConnected) timeline.querySelector('.inv-log-list').innerHTML =
          controlTimelineMarkup(events.filter(event => event.origin === 'board'));
      }).catch(() => {
        if (node.isConnected) timeline.querySelector('.inv-log-list').textContent = 'Histórico complementar indisponível.';
      });
    }
    if (canManage() && item.followUpKind === 'verification'
      && item.verificationInventoryItemId && item.status === 'Aguardando avaliação') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inv-primary';
      button.dataset.invPromoteVerification = item.id;
      button.textContent = 'Encaminhar para manutenção';
      node.querySelector('.inv-actions')?.prepend(button);
    }
    mountSourcePhoto(node, item);
    if (typeof moduleApi().listCases === 'function') {
      const history = document.createElement('section');
      history.className = 'inv-equipment-section control-case-history';
      history.innerHTML = '<h3>Chamados técnicos</h3><div class="inv-log-list" role="status">Carregando histórico…</div>';
      node.querySelector('.inv-log-head')?.before(history);
      moduleApi().listCases(item.id).then(cases => {
        if (!node.isConnected || node.dataset.itemId !== item.id) return;
        const selectedCaseId = moduleRoute.get('case');
        history.querySelector('.inv-log-list').innerHTML = cases.length
          ? cases.map(entry => `<div class="inv-log${entry.id === selectedCaseId ? ' control-case-focused' : ''}"${entry.id === selectedCaseId ? ' aria-current="true"' : ''}><b>${escape(entry.ticket_state || 'Estado legado a revisar')}${entry.id === selectedCaseId ? ' · Chamado selecionado' : ''}</b><span>${escape(dateTimeValue(entry.opened_at))} · ${escape(entry.followup_kind === 'verification' ? 'Verificação' : 'Manutenção')}${entry.closed_at ? ` · encerrado em ${escape(dateTimeValue(entry.closed_at))}` : ''}${entry.requires_review ? ' · vínculo de origem a revisar' : ''}</span>${window.AldeckotControlCaseDetail && !controlCaseDetailUnavailable ? `<button type="button" class="inv-ghost" data-control-open-case="${escape(entry.id)}">Abrir chamado</button>` : ''}</div>`).join('')
          : '<div class="inv-log">Nenhum chamado registrado.</div>';
        history.querySelector('.control-case-focused')?.scrollIntoView({ block: 'nearest' });
        if (selectedCaseId && cases.some(entry => entry.id === selectedCaseId)
          && window.AldeckotControlCaseDetail && typeof moduleApi().caseDetail === 'function'
          && !controlCaseDetailUnavailable) void showControlCaseDetail(item, selectedCaseId);
      }).catch(error => {
        if (!node.isConnected || node.dataset.itemId !== item.id) return;
        if (/42P01|PGRST205/.test(String(error?.code || '')) || /control_cases.*(?:does not exist|schema cache)/i.test(error?.message || '')) {
          history.remove();
          return;
        }
        history.querySelector('.inv-log-list').textContent = 'Histórico de chamados temporariamente indisponível.';
        console.warn('Histórico de chamados indisponível:', error);
      });
    }
    applyStatusModalGlow(node, item.status);
  }

  function renderControlCaseDetail(node, tab = 'overview') {
    if (!node?.isConnected || !node.__caseDetail) return;
    node.dataset.caseTab = tab;
    node.querySelector('[data-control-case-detail-root]').innerHTML =
      window.AldeckotControlCaseDetail.markup(
        node.__caseDetail, tab, canManage(), node.__legacyLogs || []);
  }

  async function showControlCaseDetail(item, caseId, tab = 'overview') {
    if (!caseId || controlCaseDetailUnavailable || !window.AldeckotControlCaseDetail
      || typeof moduleApi().caseDetail !== 'function') return;
    const node = modal('<div class="inv-dialog-head"><h2>Detalhes do chamado</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><div data-control-case-detail-root role="status">Carregando chamado…</div>', 'control-case-dialog');
    node.dataset.itemId = item.id;
    node.dataset.caseId = caseId;
    try {
      const detail = await moduleApi().caseDetail(caseId);
      if (!node.isConnected || node.dataset.caseId !== caseId) return;
      node.__caseDetail = detail;
      node.__legacyLogs = detail.case?.control_item_id === item.id ? item.logs || [] : [];
      renderControlCaseDetail(node, tab);
    } catch (error) {
      if (!node.isConnected) return;
      if (/PGRST202|42883/.test(String(error?.code || ''))
        || /get_control_case_detail.*(?:does not exist|schema cache)/i.test(error?.message || '')) {
        controlCaseDetailUnavailable = true;
        controlDetails(item);
        return;
      }
      node.querySelector('[data-control-case-detail-root]').textContent =
        'Não foi possível carregar este chamado. ' + backendMessage(error);
    }
  }

  function fluxDeliveryWizard() {
    const pending = data.tables.flatMap(table => table.items.filter(item =>
      item.movement === 'Envio' && ['Pendente', 'Em Trânsito'].includes(item.status))
      .map(item => ({ ...item, tableId: table.id, tableName: table.name })))
      .sort((a, b) => String(b.sendDate).localeCompare(String(a.sendDate)));
    if (!pending.length) {
      window.AldeckotMessage.show('Não há envios aguardando confirmação de entrega.');
      return;
    }
    const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const node = modal(`<div class="inv-dialog-head"><h2>Confirmar Entrega</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">Escolha o envio exato, inclusive de meses anteriores. A entrega não registra retorno ao remetente.</p><form data-flux-delivery-form><div class="inv-fields equipment-fields"><label class="inv-full"><span>Buscar por equipamento, TAG, série ou mês</span><input type="search" data-flux-delivery-search autocomplete="off"></label><label class="inv-full"><span>Envio pendente *</span><select name="itemId" required data-flux-delivery-select></select></label><div class="inv-full flux-acquisition-state" data-flux-delivery-summary></div><label><span>Data e hora da entrega *</span><input name="deliveredAt" type="datetime-local" required value="${localNow}"></label><label><span>Confirmado por *</span><input name="receivedBy" required maxlength="160"></label><label><span>Transportadora</span><input name="carrier" maxlength="160"></label><label class="inv-full"><span>Observações</span><textarea name="notes" maxlength="500"></textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button type="submit" class="inv-primary">Revisar entrega</button></div></form>`, 'equipment-dialog flux-dialog');
    const form = node.querySelector('[data-flux-delivery-form]');
    const list = form.querySelector('[data-flux-delivery-select]');
    const search = form.querySelector('[data-flux-delivery-search]');
    const summary = form.querySelector('[data-flux-delivery-summary]');
    const refresh = () => {
      const query = comparable(search.value);
      const matches = pending.filter(item => !query ||
        [item.equipment, item.tag, item.serial, item.tableName, item.senderCompany,
          item.destinationCompany].some(value => comparable(value).includes(query)));
      const selectedId = list.value;
      list.innerHTML = '<option value="">Selecione o envio</option>' + matches.map(item =>
        `<option value="${escape(item.id)}">${escape(item.tableName)} · ${escape(item.equipment)} · ${escape(item.tag || item.serial)} · ${dateValue(item.sendDate)}</option>`).join('');
      if (matches.some(item => item.id === selectedId)) list.value = selectedId;
      summary.textContent = matches.length ? `${matches.length} envio(s) compatíveis. Selecione um para conferir origem e destino.` : 'Nenhum envio corresponde à busca.';
      if (list.value) showSelected();
    };
    const showSelected = () => {
      const item = pending.find(candidate => candidate.id === list.value);
      if (!item) return;
      summary.textContent = `${item.equipment} · TAG ${item.tag || 'não informada'} · série ${item.serial || 'não informada'} · ${item.senderCompany} → ${item.destinationCompany} · envio em ${dateValue(item.sendDate)} · ${item.status}.`;
    };
    search.addEventListener('input', refresh);
    list.addEventListener('change', showSelected);
    refresh();
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (form.dataset.busy) return;
      const item = pending.find(candidate => candidate.id === list.value);
      if (!item) { window.AldeckotMessage.show('Selecione o envio correto.'); return; }
      const values = Object.fromEntries(new FormData(form));
      const deliveredAt = new Date(values.deliveredAt);
      if (!Number.isFinite(deliveredAt.valueOf())) { window.AldeckotMessage.show('Informe uma data de entrega válida.'); return; }
      if (!await window.AldeckotMessage.confirm(`Confirmar entrega de ${item.equipment} em ${item.destinationCompany}, recebida por ${values.receivedBy}? O envio original será preservado.`, { title: 'Revisar entrega', confirmText: 'Confirmar entrega' })) return;
      form.dataset.busy = 'true';
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      const finish = window.AldeckotLoading?.beginSave?.('Confirmando entrega…');
      try {
        const requestKey = JSON.stringify([item.id, values]);
        if (form.dataset.requestKey !== requestKey) {
          form.dataset.requestKey = requestKey;
          form.dataset.requestId = crypto.randomUUID();
        }
        const requestId = form.dataset.requestId;
        await moduleApi().confirmDelivery(item, { ...values, deliveredAt: deliveredAt.toISOString() }, requestId);
        closeModal();
        state.active = item.tableId;
        await reloadInventory(); renderInventory();
        const updated = activeTable()?.items.find(row => row.id === item.id);
        if (updated) details(updated);
        window.AldeckotMessage.show('Entrega confirmada e registrada no histórico.');
      } catch (error) {
        window.AldeckotMessage.show(backendMessage(error));
      } finally { delete form.dataset.busy; button.disabled = false; await finish?.(); }
    });
  }

  function fluxReturnWizard() {
    const returnedIds = new Set(data.tables.flatMap(table => table.items
      .map(item => item.returnOf).filter(Boolean)));
    const eligible = data.tables.flatMap(table => table.items.filter(item =>
      item.movement === 'Envio' && item.status === 'Entregue' && Boolean(item.deliveredAt)
      && item.situation !== 'Aquisição' && !returnedIds.has(item.id))
      .map(item => ({ ...item, tableId: table.id, tableName: table.name })))
      .sort((a, b) => String(b.sendDate).localeCompare(String(a.sendDate)));
    if (!eligible.length) {
      window.AldeckotMessage.show('Não há envios com entrega confirmada e sem retorno. Registros antigos sem confirmação individual exigem conferência antes de vincular um retorno.');
      return;
    }
    const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const sourceTables = data.tables.filter(table => eligible.some(item => item.tableId === table.id));
    const node = modal(`<div class="inv-dialog-head"><h2>Registrar Retorno</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">Vincule a entrada física ao envio original, mesmo que tenha ocorrido em outro mês. Depois do recebimento, confira o destino patrimonial.</p><form data-flux-return-form><div class="inv-fields equipment-fields"><label><span>Tabela de origem do envio *</span><select name="sourceTableId" required data-flux-return-source><option value="">Selecione o mês</option>${sourceTables.map(table => `<option value="${escape(table.id)}">${escape(table.name)}</option>`).join('')}</select></label><label><span>Buscar nome, série ou TAG</span><input type="search" data-flux-return-search autocomplete="off"></label><label class="inv-full"><span>Envio original *</span><select name="sendId" required data-flux-return-send><option value="">Selecione o envio</option></select></label><div class="inv-full flux-acquisition-state" data-flux-return-summary></div><label><span>Tabela do recebimento *</span><select name="targetTableId" required>${data.tables.map(table => `<option value="${escape(table.id)}" ${table.id === activeTable()?.id ? 'selected' : ''}>${escape(table.name)}</option>`).join('')}</select></label><label><span>Data e hora do recebimento *</span><input name="receivedAt" type="datetime-local" required value="${localNow}"></label><label><span>Retornou de *</span><input name="originCompany" required maxlength="160"></label><label><span>Chegou em *</span><input name="destinationCompany" required maxlength="160"></label><label><span>Quem recebeu *</span><input name="receivedBy" required maxlength="160"></label><label><span>Transportadora</span><input name="carrier" maxlength="160"></label><label><span>Status pretendido após regularização *</span><select name="postReceiptStatus" required>${['Reserva','Ativo','Verificação','Defeito','Manutenção'].map(status => `<option>${status}</option>`).join('')}</select></label><label class="inv-full"><span>Motivo do retorno *</span><textarea name="returnReason" required minlength="5" maxlength="500" placeholder="Descreva por que o equipamento retornou."></textarea></label><label class="inv-full"><span>Observações</span><textarea name="notes" maxlength="500"></textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button type="submit" class="inv-primary">Revisar retorno</button></div></form>`, 'equipment-dialog flux-dialog');
    const form = node.querySelector('[data-flux-return-form]');
    const source = form.querySelector('[data-flux-return-source]');
    const search = form.querySelector('[data-flux-return-search]');
    const list = form.querySelector('[data-flux-return-send]');
    const summary = form.querySelector('[data-flux-return-summary]');
    const showSelected = () => {
      const item = eligible.find(row => row.id === list.value);
      if (!item) return;
      summary.textContent = `${item.equipment} · TAG ${item.tag || 'não informada'} · série ${item.serial || 'não informada'} · ${item.senderCompany} → ${item.destinationCompany} · enviado em ${dateValue(item.sendDate)} · ${item.status}.`;
      form.elements.originCompany.value = item.destinationCompany;
      form.elements.destinationCompany.value = item.senderCompany;
    };
    const refresh = () => {
      const query = comparable(search.value);
      const matches = eligible.filter(item => item.tableId === source.value &&
        (!query || [item.equipment, item.serial, item.tag].some(value => comparable(value).includes(query))));
      const selectedId = list.value;
      list.innerHTML = '<option value="">Selecione o envio</option>' + matches.map(item =>
        `<option value="${escape(item.id)}">${escape(item.equipment)} · ${escape(item.tag || item.serial)} · ${dateValue(item.sendDate)} · ${escape(item.destinationCompany)}</option>`).join('');
      if (matches.some(item => item.id === selectedId)) list.value = selectedId;
      summary.textContent = source.value ? `${matches.length} envio(s) elegíveis nesta tabela.` : 'Escolha primeiro a tabela do envio.';
      if (list.value) showSelected();
    };
    source.addEventListener('change', refresh);
    search.addEventListener('input', refresh);
    list.addEventListener('change', showSelected);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (form.dataset.busy) return;
      const item = eligible.find(row => row.id === list.value && row.tableId === source.value);
      if (!item) { window.AldeckotMessage.show('Selecione o envio original.'); return; }
      const values = Object.fromEntries(new FormData(form));
      const receivedAt = new Date(values.receivedAt);
      if (!Number.isFinite(receivedAt.valueOf())) { window.AldeckotMessage.show('Informe uma data de recebimento válida.'); return; }
      const target = data.tables.find(table => table.id === values.targetTableId);
      if (!target) { window.AldeckotMessage.show('Selecione a tabela do recebimento.'); return; }
      const nextStep = item.inventoryItemId || item.managementComputerId
        ? 'O destino poderá ser conferido e aplicado no detalhe do retorno.'
        : 'O destino precisa ser conferido no módulo de origem.';
      if (!await window.AldeckotMessage.confirm(`Registrar a entrada de ${item.equipment} de ${values.originCompany} em ${values.destinationCompany}, recebida por ${values.receivedBy}, na tabela ${target.name}? ${nextStep}`, { title: 'Revisar retorno', confirmText: 'Registrar retorno' })) return;
      form.dataset.busy = 'true';
      const button = form.querySelector('[type="submit"]'); button.disabled = true;
      const finish = window.AldeckotLoading?.beginSave?.('Registrando retorno…');
      try {
        const requestKey = JSON.stringify([item.id, values]);
        if (form.dataset.requestKey !== requestKey) {
          form.dataset.requestKey = requestKey;
          form.dataset.requestId = crypto.randomUUID();
        }
        const saved = await moduleApi().registerReturn(item, target.id,
          { ...values, receivedAt: receivedAt.toISOString() }, form.dataset.requestId);
        closeModal();
        state.active = target.id;
        await reloadInventory(); renderInventory();
        const updated = activeTable()?.items.find(row => row.id === saved.id);
        if (updated) details(updated);
        window.AldeckotMessage.show(`Retorno físico registrado. ${nextStep}`);
      } catch (error) {
        window.AldeckotMessage.show(backendMessage(error));
      } finally { delete form.dataset.busy; button.disabled = false; await finish?.(); }
    });
    refresh();
  }

  function fluxReturnDestination(item) {
    const installingComputer = item.managementComputerId && item.postReceiptStatus === 'Ativo';
    const suggestedLocation = item.postReceiptStatus === 'Reserva' ? 'Sala CPD' : '';
    const sectors = window.AldeckotSectors?.names || [];
    const sectorOptions = sectors.map(value => `<option value="${escape(value)}" ${value === item.sector ? 'selected' : ''}>${escape(value)}</option>`).join('');
    const node = modal(`<div class="inv-dialog-head"><h2>Regularizar destino do retorno</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div>
      <p class="inv-log-intro">${escape(item.equipment)} · ${escape(item.tag || item.serial)} · Condição solicitada: ${escape(item.postReceiptStatus)}.</p>
      <form data-flux-return-destination><div class="inv-fields equipment-fields">
        <label><span>${installingComputer ? 'Terminal de destino *' : 'Local final *'}</span><input name="location" required maxlength="160" value="${suggestedLocation}" placeholder="${installingComputer ? 'Nome do terminal na Gestão TI' : 'PDV 10 ou Sala CPD'}"></label>
        <label><span>Setor final *</span><select name="sector" required><option value="">Selecione</option>${sectorOptions}</select></label>
        <label class="inv-full"><span>Motivo da decisão *</span><textarea name="reason" required minlength="5" maxlength="500"></textarea></label>
      </div><p class="inv-log-intro" data-flux-destination-review aria-live="polite">Confira o destino antes de aplicar.</p>
      <div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button>
        <button type="button" class="inv-ghost" data-flux-destination-check>Conferir destino</button>
        <button type="submit" class="inv-primary" disabled>Aplicar destino</button></div>
      </form>`, 'equipment-dialog flux-dialog');
    const form = node.querySelector('[data-flux-return-destination]');
    const feedback = form.querySelector('[data-flux-destination-review]');
    const checkButton = form.querySelector('[data-flux-destination-check]');
    const apply = form.querySelector('[type="submit"]');
    let revision = 0;
    let review;
    let busy = false;
    const values = () => Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, value.trim()]));
    const valid = draft => form.reportValidity() && draft.location && draft.reason.length >= 5;
    form.addEventListener('input', () => {
      revision += 1;
      review = null;
      apply.disabled = true;
      feedback.textContent = 'Dados alterados. Confira o destino novamente.';
    });
    checkButton.addEventListener('click', async () => {
      const draft = values();
      if (busy || !valid(draft)) return;
      const current = ++revision;
      review = null;
      apply.disabled = true;
      checkButton.disabled = true;
      feedback.textContent = 'Conferindo equipamento, destino e chamados…';
      try {
        const result = await moduleApi().previewReturnDestination(item, draft);
        if (!node.isConnected || current !== revision) return;
        const technical = { complete: 'O chamado de manutenção será concluído.',
          reuse: 'O chamado atual será mantido.', verify: 'O Controle TI abrirá uma verificação.',
          maintenance: 'O Controle TI registrará a manutenção.' };
        const old = result.item;
        const next = result.target;
        const occupants = (result.occupants || []).map(row => row.tag || row.equipment).filter(Boolean);
        feedback.textContent = result.blocked
          ? `${result.reason}${occupants.length ? ` Ocupante: ${occupants.join(', ')}.` : ''}`
          : `${old.location || 'Sem local'} / ${old.sector || 'Sem setor'} / ${old.status} → ${next.location} / ${next.sector} / ${next.status}${next.situation === 'Verificando' ? ' (Verificando)' : ''}. ${technical[result.technicalAction] || ''}`.trim();
        if (!result.blocked) {
          review = { draft, token: result.token, requestId: crypto.randomUUID() };
          apply.disabled = false;
        }
      } catch (error) {
        if (node.isConnected && current === revision) feedback.textContent = backendMessage(error);
      } finally { checkButton.disabled = false; }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !review) return;
      const checked = review;
      if (JSON.stringify(values()) !== JSON.stringify(checked.draft)) return;
      busy = true;
      checkButton.disabled = true;
      apply.disabled = true;
      let saved = false;
      try {
        await moduleApi().confirmReturnDestination(item, checked.draft, checked.token, checked.requestId);
        saved = true;
        await reloadInventory();
        renderInventory();
        if (node.isConnected) {
          const updated = activeTable()?.items.find(row => row.id === item.id);
          if (updated) details(updated);
          else closeModal();
        }
        window.AldeckotMessage.show('Destino aplicado. O retorno foi vinculado ao histórico do equipamento.');
      } catch (error) {
        if (node.isConnected) feedback.textContent = saved
          ? 'Destino aplicado. Recarregue a tabela para ver o novo estado.'
          : backendMessage(error);
      } finally {
        busy = false;
        checkButton.disabled = false;
        apply.disabled = saved || review !== checked;
      }
    });
  }

  function fluxHistoryModal() {
    const { historyEvents, filterHistory, compareHistory } = window.AldeckotFluxCycles;
    let events = historyEvents(data.tables);
    const months = [...new Set(events.map(row => row.period))].sort().reverse();
    let linkedLoading = true;
    let linkedError = false;
    const node = modal(`<div class="inv-dialog-head"><h2>Histórico Geral do Flux</h2><button type="button" class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">Saídas, entregas confirmadas, entradas e eventos de outros módulos vinculados por ID patrimonial. Horários conhecidos são exibidos no horário de Brasília; nos demais casos, apenas a data foi informada. Períodos antigos sem evento explícito não recebem uma confirmação presumida.</p><div class="flux-history-filters"><input type="search" data-flux-history-search placeholder="Equipamento, TAG, série, empresa..." aria-label="Buscar no histórico"><select data-flux-history-month aria-label="Filtrar mês"><option value="">Todos os meses</option>${months.map(month => `<option value="${month}">${month.slice(5)}/${month.slice(0, 4)}</option>`).join('')}</select><select data-flux-history-type aria-label="Filtrar evento"><option value="">Todos os eventos</option>${['Saída', 'Entrega', 'Entrada', 'Retorno'].map(type => `<option>${type}</option>`).join('')}</select><select data-flux-history-status aria-label="Filtrar status"><option value="">Todos os status registrados</option>${statuses.map(status => `<option>${status}</option>`).join('')}</select><input type="date" data-flux-history-from aria-label="Data inicial"><input type="date" data-flux-history-to aria-label="Data final"></div><div class="flux-history-list" aria-live="polite"></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Fechar</button></div>`, 'equipment-dialog flux-history-dialog');
    const update = () => {
      const query = comparable(node.querySelector('[data-flux-history-search]').value);
      const month = node.querySelector('[data-flux-history-month]').value;
      const type = node.querySelector('[data-flux-history-type]').value;
      const status = node.querySelector('[data-flux-history-status]').value;
      const from = node.querySelector('[data-flux-history-from]').value;
      const to = node.querySelector('[data-flux-history-to]').value;
      if (from && to && from > to) {
        node.querySelector('.flux-history-list').innerHTML = '<p>A data inicial deve ser anterior ou igual à data final.</p>';
        return;
      }
      const results = filterHistory(events, { query, month, type, status, from, to });
      node.querySelector('.flux-history-list').innerHTML = `<p>${results.length} ${results.length === 1 ? 'evento encontrado' : 'eventos encontrados'}${results.length > 100 ? '; exibindo os 100 mais recentes' : ''}.${linkedLoading ? ' Consultando eventos vinculados…' : linkedError ? ' Eventos vinculados indisponíveis no momento.' : ''}</p>` +
        (results.slice(0, 100).map(row => {
          if (row.shared) {
            const entry = row.shared;
            const before = entry.previous_location || entry.origin_location || '';
            const after = entry.new_location || entry.destination_location || '';
            const place = before && after && before !== after ? ` de ${before} para ${after}` : after ? ` em ${after}` : '';
            const change = entry.previous_status && entry.new_status && entry.previous_status !== entry.new_status
              ? `; status ${entry.previous_status} → ${entry.new_status}` : entry.new_status ? `; status ${entry.new_status}` : '';
            return `<article class="flux-timeline-event"><span class="entry">${escape(row.tableName)}</span><div><b>${escape(dateTimeValue(row.when))} — ${escape(row.item.equipment)}: ${escape(entry.action || 'evento registrado')}${escape(place)}${escape(change)}.</b><small>Horário de registro · TAG ${escape(row.item.tag || 'não informada')} · série ${escape(row.item.serial || 'não informada')}</small><details><summary>Dados técnicos</summary><dl><dt>Evento</dt><dd>${escape(entry.id)}</dd><dt>Módulo de origem</dt><dd>${escape(entry.source_module)}</dd><dt>Registro de origem</dt><dd>${escape(entry.source_id)}</dd><dt>Motivo</dt><dd>${escape(entry.reason || 'não informado')}</dd><dt>Item patrimonial</dt><dd>${escape(entry.inventory_item_id)}</dd></dl></details><button type="button" data-flux-history-open="${escape(row.item.id)}" data-flux-history-table="${escape(row.tableId)}">Abrir equipamento</button></div></article>`;
          }
          return `<article class="flux-timeline-event"><span class="${row.type === 'Saída' ? 'send' : 'entry'}">${escape(row.type)}</span><div><b>${escape(row.dateOnly ? dateValue(row.when) + ' (horário não informado)' : dateTimeValue(row.when))} — ${escape(row.text)}</b><small>${escape(row.tableName)} · status atual do Flux: ${escape(row.item.status)} · TAG ${escape(row.item.tag || 'não informada')} · série ${escape(row.item.serial || 'não informada')}</small><details><summary>Dados técnicos</summary><dl><dt>Registro</dt><dd>${escape(row.item.id)}</dd><dt>Equipamento</dt><dd>${escape(row.item.equipmentUid || 'identidade legada')}</dd>${row.item.returnOf ? `<dt>Envio original</dt><dd>${escape(row.item.returnOf)}</dd>` : ''}</dl></details><button type="button" data-flux-history-open="${escape(row.item.id)}" data-flux-history-table="${escape(row.tableId)}">Abrir equipamento</button></div></article>`;
        }).join('') || '<p>Nenhum evento corresponde aos filtros.</p>');
    };
    node.querySelectorAll('.flux-history-filters input, .flux-history-filters select').forEach(field =>
      field.addEventListener(field.tagName === 'INPUT' ? 'input' : 'change', update));
    node.addEventListener('click', event => {
      const button = event.target.closest('[data-flux-history-open]');
      if (!button) return;
      const table = data.tables.find(row => row.id === button.dataset.fluxHistoryTable);
      const item = table?.items.find(row => row.id === button.dataset.fluxHistoryOpen);
      if (!item) return;
      state.active = table.id;
      renderInventory();
      details(item);
    });
    const linkedByInventory = new Map();
    data.tables.forEach(table => table.items.forEach(item => {
      if (item.inventoryItemId && !linkedByInventory.has(item.inventoryItemId))
        linkedByInventory.set(item.inventoryItemId, { item, tableId: table.id });
    }));
    update();
    if (!linkedByInventory.size) {
      linkedLoading = false;
      update();
      return;
    }
    moduleApi().equipmentEventsForItems([...linkedByInventory.keys()]).then(rows => {
      if (!node.isConnected) return;
      const moduleNames = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', supplies: 'Suprimentos', nfe: 'Fiscal' };
      const linked = rows.flatMap(entry => {
        const source = linkedByInventory.get(entry.inventory_item_id);
        if (!source) return [];
        const day = fluxLocalDay(entry.created_at);
        return [{ ...source, shared: entry, type: entry.action || 'Outro módulo',
          tableName: moduleNames[entry.source_module] || entry.source_module || 'Outro módulo',
          when: entry.created_at, timestamp: entry.created_at, key: entry.id,
          day, period: day.slice(0, 7) }];
      });
      events = [...events, ...linked].sort(compareHistory);
      const setOptions = (selector, label, values, format = value => value) => {
        const field = node.querySelector(selector);
        const selected = field.value;
        field.innerHTML = `<option value="">${label}</option>` + values.map(value =>
          `<option value="${escape(value)}">${escape(format(value))}</option>`).join('');
        field.value = selected;
      };
      setOptions('[data-flux-history-month]', 'Todos os meses',
        [...new Set(events.map(row => row.period))].sort().reverse(),
        value => `${value.slice(5)}/${value.slice(0, 4)}`);
      setOptions('[data-flux-history-type]', 'Todos os eventos',
        [...new Set(events.map(row => row.type))].sort((a, b) => a.localeCompare(b, 'pt-BR')));
      setOptions('[data-flux-history-status]', 'Todos os status registrados',
        [...new Set(events.map(row => row.shared ? row.shared.new_status : row.item.status).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b, 'pt-BR')));
      linkedLoading = false;
      update();
    }).catch(error => {
      if (!node.isConnected) return;
      linkedLoading = false;
      linkedError = true;
      update();
      console.warn('Histórico geral vinculado indisponível:', error);
    });
  }

  function fluxDetails(item) {
    const labels = [['movement', 'Movimentação'], ['equipment', 'Equipamento'], ['model', 'Modelo'], ['brand', 'Marca'], ['tag', 'TAG'], ['serial', 'Nº de série'], ['senderCompany', 'Empresa Remetente'], ['destinationCompany', 'Empresa Destino'], ['senderResponsible', 'Responsável Envio'], ['receiverResponsible', 'Responsável Recebimento'], ['sendDate', 'Data de Envio'], ['receivedDate', 'Data de Recebimento'], ['deliveredAt', 'Entrega confirmada em'], ['deliveredBy', 'Entrega confirmada por'], ['receivedAt', 'Entrada física em'], ['returnOf', 'Envio original'], ['returnReason', 'Motivo do retorno'], ['postReceiptStatus', 'Status pretendido'], ['resolutionState', 'Regularização de status/local'], ['shippingType', 'Tipo de Envio'], ['situation', 'Motivo'], ['status', 'Status'], ['priority', 'Prioridade'], ['date', 'Atualizado'], ['notes', 'Observações']];
    const display = (key, value) => key === 'sendDate' || key === 'receivedDate' ? dateValue(value)
      : key === 'deliveredAt' || key === 'receivedAt' ? dateTimeValue(value) : (value || '—');
    const logActions = entry => entry.id && !entry.eventId ? `<div class="inv-log-actions"><button class="inv-log-action edit" data-inv-action="edit-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Editar registro" aria-label="Editar registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="m4 16.5-.8 4.3 4.3-.8L18.6 8.9l-3.5-3.5L4 16.5Z"/><path d="m13.8 6.7 3.5 3.5"/></svg></button><button class="inv-log-action delete" data-inv-action="delete-log" data-inv-log-item="${item.id}" data-inv-log-id="${entry.id}" title="Excluir registro" aria-label="Excluir registro"><svg viewBox="0 0 24" aria-hidden="true"><path d="M5 7h14M10 3h4l1 4H9l1-4Zm-3 4 1 13h8l1-13"/><path d="M10 11v5m4-5v5"/></svg></button></div>` : '';
    const node = modal(`<div class="inv-dialog-head"><h2>${escape(item.equipment)}</h2><div class="inv-dialog-head-actions">${itemActionMenu(item)}<button class="inv-close" data-inv-close>×</button></div></div><div class="inv-detail-grid flux-detail-grid">${labels.filter(([key]) => item[key] !== null && item[key] !== undefined && item[key] !== '').map(([key, label]) => `<div class="inv-detail ${key === 'notes' ? 'inv-full' : ''}${key === 'priority' ? ` inv-priority-detail priority-${choiceTone('priority', item[key])}` : ''}">${label}<b>${escape(key === 'priority' ? (item[key] || 'Estável') : display(key, item[key]))}</b></div>`).join('')}</div><div class="inv-log-head"><h3>Histórico</h3><button class="inv-log-add" data-inv-action="add-log" data-inv-log-item="${item.id}">＋ Adicionar registro</button></div><div class="inv-log-list">${(item.logs || []).map(entry => `<div class="inv-log"><b>${escape(entry.at)}</b><span>${escape(entry.text)}</span>${logActions(entry)}</div>`).join('') || '<div class="inv-log">Nenhum registro no histórico.</div>'}</div><div class="inv-actions"><button class="inv-ghost" data-inv-close>Fechar</button></div>`);
    const group = fluxGroups(activeTable()).find(candidate => candidate.items.some(entry => entry.id === item.id));
    const sortTrajectory = timeline => {
      const articles = [...timeline.querySelectorAll(':scope > .flux-timeline-event')].map(article => ({
        article, day: article.dataset.fluxDay, timestamp: article.dataset.fluxTime, key: article.dataset.fluxKey
      }));
      articles.sort(window.AldeckotFluxCycles.compareHistory);
      timeline.append(...articles.map(({ article }) => article));
    };
    if (group) {
      const timeline = document.createElement('section');
      timeline.className = 'flux-equipment-timeline';
      timeline.innerHTML = `<h3>Trajetória do equipamento</h3><p>${group.items.length} ${group.items.length === 1 ? 'registro' : 'registros'} em ${new Set(group.items.map(entry => entry.tableId)).size} ${new Set(group.items.map(entry => entry.tableId)).size === 1 ? 'período' : 'períodos'}. Registros sem vínculo explícito permanecem separados.</p>${group.items.map(entry => {
        const inbound = entry.movement === 'Recebimento';
        const date = inbound ? entry.receivedAt || entry.receivedDate : entry.sendDate;
        const verb = inbound ? (entry.returnOf ? 'registrou o retorno de' : 'registrou a entrada de') : 'registrou a saída de';
        const from = entry.senderCompany ? ` de ${entry.senderCompany}` : '';
        const to = entry.destinationCompany ? ` para ${entry.destinationCompany}` : '';
        const precise = inbound && entry.receivedAt ? entry.receivedAt : '';
        const day = precise ? fluxLocalDay(precise) : String(date || '').slice(0, 10);
        return `<article class="flux-timeline-event" data-flux-day="${escape(day)}" data-flux-time="${escape(precise)}" data-flux-key="${escape(entry.id)}:movimento"><span class="${inbound ? 'entry' : 'send'}">${inbound ? (entry.returnOf ? '↓ Retorno' : '↓ Entrada') : '↑ Saída'}</span><div><b>${date ? (precise ? dateTimeValue(date) : dateValue(date) + ' (horário não informado)') : 'Data não informada'} — Flux ${verb} ${escape(entry.equipment)}${escape(from)}${escape(to)}${entry.situation ? ` por ${escape(entry.situation.toLowerCase())}` : ''}${inbound && entry.receiverResponsible ? `; recebido por ${escape(entry.receiverResponsible)}` : ''}.</b><small>${escape(entry.tableName || 'Período não informado')} · ${escape(entry.status || 'Estado não informado')}${entry.resolutionState === 'Pendente' ? ' · status/local de origem pendentes' : ''}</small><details><summary>Dados técnicos</summary><dl><dt>Registro</dt><dd>${escape(entry.id)}</dd><dt>Origem</dt><dd>${escape(entry.sourceModule || 'não vinculada')}</dd><dt>Série</dt><dd>${escape(entry.serial || 'não informada')}</dd><dt>TAG</dt><dd>${escape(entry.tag || 'não informada')}</dd>${entry.returnOf ? `<dt>Envio original</dt><dd>${escape(entry.returnOf)}</dd><dt>Motivo do retorno</dt><dd>${escape(entry.returnReason || 'não informado')}</dd>` : ''}</dl></details></div></article>`;
      }).join('')}`;
      const originalEvents = [...timeline.querySelectorAll('.flux-timeline-event')];
      group.items.forEach((entry, index) => {
        if (!entry.deliveredAt || !originalEvents[index]) return;
        originalEvents[index].insertAdjacentHTML('afterend', `<article class="flux-timeline-event" data-flux-day="${escape(fluxLocalDay(entry.deliveredAt))}" data-flux-time="${escape(entry.deliveredAt)}" data-flux-key="${escape(entry.id)}:entrega"><span class="entry">✓ Entrega</span><div><b>${dateTimeValue(entry.deliveredAt)} — A entrega de ${escape(entry.equipment)} em ${escape(entry.destinationCompany)} foi confirmada${entry.deliveredBy ? ` por ${escape(entry.deliveredBy)}` : ''}.</b><small>${escape(entry.tableName || 'Período não informado')} · confirmação distinta do retorno físico</small><details><summary>Dados técnicos</summary><dl><dt>Envio</dt><dd>${escape(entry.id)}</dd><dt>Transportadora</dt><dd>${escape(entry.deliveryCarrier || 'não informada')}</dd>${entry.deliveryNote ? `<dt>Observações</dt><dd>${escape(entry.deliveryNote)}</dd>` : ''}</dl></details></div></article>`);
      });
      sortTrajectory(timeline);
      node.querySelector('.inv-detail-grid')?.before(timeline);
    }
    node.dataset.itemId = item.id;
    const inventoryIds = [...new Set((group?.items || [item]).map(entry => entry.inventoryItemId).filter(Boolean))];
    if (inventoryIds.length === 1) {
      const shared = document.createElement('section');
      shared.className = 'flux-equipment-timeline';
      shared.innerHTML = '<h3>Eventos nos módulos vinculados</h3><p>Consultando o histórico do item patrimonial identificado…</p>';
      const fluxTimeline = node.querySelector('.flux-equipment-timeline');
      if (fluxTimeline) fluxTimeline.after(shared);
      else node.querySelector('.inv-detail-grid')?.before(shared);
      moduleApi().equipmentEvents(inventoryIds[0]).then(events => {
        if (!node.isConnected || node.dataset.itemId !== item.id) return;
        const shown = events.slice(0, 200);
        shared.innerHTML = `<h3>Eventos nos módulos vinculados</h3><p>${shown.length ? `${shown.length} evento(s) do mesmo item patrimonial${events.length > 200 ? '; exibindo os 200 mais recentes' : ''}. O horário indica quando cada evento foi registrado.` : 'Não há eventos de outros módulos vinculados a este item.'}</p>${shown.map(entry => {
          const before = entry.previous_location || entry.origin_location || '';
          const after = entry.new_location || entry.destination_location || '';
          const place = before && after && before !== after ? ` de ${before} para ${after}` : after ? ` em ${after}` : '';
          const status = entry.previous_status && entry.new_status && entry.previous_status !== entry.new_status
            ? `; status ${entry.previous_status} → ${entry.new_status}` : entry.new_status ? `; status ${entry.new_status}` : '';
          const moduleNames = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', supplies: 'Suprimentos', nfe: 'Fiscal' };
          const moduleName = moduleNames[entry.source_module] || entry.source_module || 'Módulo';
          const action = entry.action === 'peripheral-transfer' ? 'foi movimentado' :
            entry.action === 'Correção cadastral de local' ? 'teve o local cadastral corrigido' :
              entry.action === 'Regularização após retorno' ? 'teve o local regularizado após o retorno' :
                entry.action === 'Manutenção concluída' ? 'teve a manutenção concluída' :
                  entry.action === 'Verificação concluída' ? 'teve a verificação concluída' :
                `recebeu o registro “${entry.action}”`;
          const details = [['Evento', entry.id], ['Módulo de origem', entry.source_module],
            ['Registro de origem', entry.source_id], ['Motivo', entry.reason],
            ['Local anterior', entry.previous_location], ['Novo local', entry.new_location],
            ['Status anterior', entry.previous_status], ['Novo status', entry.new_status],
            ['Vínculo anterior', entry.previous_assignment], ['Novo vínculo', entry.new_assignment],
            ['Módulos afetados', Array.isArray(entry.affected_modules) ? entry.affected_modules.join(', ') : ''],
            ['Operação correlacionada', entry.metadata?.requestId || entry.metadata?.operationId],
            ['Chamado', entry.metadata?.ticketId || entry.metadata?.caseId]];
          return `<article class="flux-timeline-event" data-flux-day="${escape(fluxLocalDay(entry.created_at))}" data-flux-time="${escape(entry.created_at)}" data-flux-key="${escape(entry.id)}"><span class="entry">${escape(moduleName)}</span><div><b>${escape(dateTimeValue(entry.created_at))} — ${escape(item.equipment)} ${escape(action)}${escape(place)}${escape(status)}.</b><small>${escape(entry.action)}${entry.reason ? ` · ${escape(entry.reason)}` : ''}</small><details><summary>Dados técnicos</summary><dl>${details.filter(([, value]) => value).map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join('')}</dl></details></div></article>`;
        }).join('')}`;
        if (fluxTimeline) {
          fluxTimeline.querySelector('p').textContent += ` ${shown.length ? `${shown.length} ${shown.length === 1 ? 'evento de outro módulo vinculado' : 'eventos de outros módulos vinculados'}.` : 'Sem eventos de outros módulos vinculados.'} Eventos com apenas a data informada não têm ordem conhecida dentro do mesmo dia.`;
          fluxTimeline.append(...shared.querySelectorAll('.flux-timeline-event'));
          sortTrajectory(fluxTimeline);
          shared.remove();
        }
      }).catch(error => {
        if (!node.isConnected || node.dataset.itemId !== item.id) return;
        shared.innerHTML = '<h3>Eventos nos módulos vinculados</h3><p>Não foi possível consultar os eventos correlacionados agora.</p>';
        console.warn('Histórico integrado indisponível:', error);
      });
    }
    if (item.resolutionState === 'Pendente') {
      const linked = item.inventoryItemId || item.managementComputerId;
      const notice = document.createElement('p');
      notice.className = 'flux-acquisition-note';
      notice.textContent = linked
        ? 'O retorno físico foi registrado. Confira o destino antes de encerrar a regularização.'
        : 'O retorno físico foi registrado. O destino precisa ser conferido no módulo de origem.';
      node.querySelector('.inv-actions')?.before(notice);
      if (linked && canManage()) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'inv-primary';
        button.textContent = 'Regularizar destino';
        button.addEventListener('click', () => fluxReturnDestination(item));
        node.querySelector('.inv-actions')?.prepend(button);
      }
    }
    mountSourcePhoto(node, item);
    if (item.situation === 'Aquisição' && canManage()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'inv-primary';
      button.dataset.invFluxAcquisition = item.id;
      button.textContent = 'Destino da aquisição';
      node.querySelector('.inv-actions')?.prepend(button);
    }
    if (canManage()) {
      moduleApi().previewReversal(item.id).then(preview => {
        if (!preview?.eligible || !node.isConnected || node.dataset.itemId !== item.id) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'inv-ghost inv-danger';
        button.dataset.invFluxReversal = item.id;
        button.textContent = 'Estornar movimentação';
        node.querySelector('.inv-actions')?.prepend(button);
      }).catch(error => console.warn('Elegibilidade do estorno indisponível:', error));
    }
    applyStatusModalGlow(node, item.status);
  }

  function mountSourcePhoto(node, item) {
    const service = window.AldeckotEquipmentImages;
    const grid = node.querySelector('.inv-detail-grid');
    if (!grid) return;
    node.classList.add('inv-source-detail-dialog');
    const fields = [...grid.children];
    const section = (title, entries) => {
      const wrapper = document.createElement('section');
      wrapper.className = 'inv-equipment-section';
      const heading = document.createElement('h3');
      heading.textContent = title;
      const contents = document.createElement('div');
      contents.className = 'inv-detail-grid';
      contents.append(...entries);
      wrapper.append(heading, contents);
      return wrapper;
    };
    const top = document.createElement('div');
    top.className = 'inv-source-layout';
    const photo = document.createElement('section');
    photo.className = 'inv-source-photo';
    photo.innerHTML = `<div class="inv-source-photo-frame"><span class="inv-source-photo-placeholder" aria-hidden="true">◇</span><img alt="Imagem de ${escape(item.equipment)}" hidden></div><small class="inv-source-photo-caption">Buscando imagem vinculada à origem…</small>`;
    const summary = section('Identificação', fields.slice(0, 6));
    top.append(photo, summary);
    const lower = controlMode
      ? [section('Datas', fields.slice(6, 8)), section('Estado atual', fields.slice(8, 12)), section('Informações complementares', fields.slice(12))]
      : [section('Movimentação', fields.slice(6, 14)), section('Estado atual', fields.slice(14, 17)), section('Informações complementares', fields.slice(17))];
    grid.replaceWith(top, ...lower);
    const caption = photo.querySelector('.inv-source-photo-caption');
    if (!service?.sourceOf(item, moduleConfig.key)) {
      caption.textContent = 'Nenhuma imagem vinculada a este equipamento.';
      return;
    }
    service.urlForItem(item, moduleConfig.key).then(url => {
      if (!photo.isConnected || node.dataset.itemId !== item.id) return;
      const image = photo.querySelector('img');
      const placeholder = photo.querySelector('.inv-source-photo-placeholder');
      if (!url) { caption.textContent = 'Nenhuma imagem cadastrada na origem deste equipamento.'; return; }
      image.onload = () => { image.hidden = false; placeholder.hidden = true; caption.hidden = true; };
      image.onerror = () => { image.hidden = true; placeholder.hidden = false; caption.textContent = 'Não foi possível exibir a imagem agora.'; };
      image.src = url;
      if (image.complete && image.naturalWidth) image.onload();
    }).catch(error => {
      if (photo.isConnected) caption.textContent = 'Imagem temporariamente indisponível.';
      console.warn('Imagem de origem indisponível:', error);
    });
  }

  async function fluxReversalWizard(item) {
    const preview = await moduleApi().previewReversal(item.id);
    if (!preview?.eligible) {
      window.AldeckotMessage.show(preview?.reason || 'Esta movimentação não permite estorno automático.');
      return;
    }
    const source = preview.sourceModule === 'management' ? 'Gestão TI' : 'Inventário';
    const date = preview.createdAt ? new Date(preview.createdAt).toLocaleString('pt-BR') : '—';
    const node = modal(`<div class="inv-dialog-head"><h2>Estornar movimentação</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div>
      <p class="inv-log-intro">O registro original e os históricos serão preservados. Confira as alterações antes de confirmar.</p>
      <div class="inv-detail-grid flux-detail-grid">
        <div class="inv-detail">Equipamento<b>${escape(preview.equipment)}</b></div>
        <div class="inv-detail">TAG / Série<b>${escape(preview.tag)} · ${escape(preview.serial)}</b></div>
        <div class="inv-detail">Movimentação<b>${escape(preview.movement)}</b></div>
        <div class="inv-detail">Data / Responsável<b>${escape(date)} · ${escape(preview.actorName)}</b></div>
        <div class="inv-detail">${source}<b>Manutenção → ${escape(preview.restoredStatus)}</b></div>
        <div class="inv-detail">Controle TI<b>Chamado → Cancelado</b></div>
      </div>
      <p class="inv-log-intro">${escape(preview.consequence)} Evento original: ${escape(preview.originalEventId)}</p>
      <form data-flux-reversal-form><div class="inv-fields"><label class="inv-full"><span>Motivo do estorno *</span><textarea name="reason" required minlength="5" maxlength="500" placeholder="Explique por que esta movimentação deve ser estornada."></textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button type="submit" class="inv-primary">Confirmar estorno</button></div></form>`, 'equipment-dialog flux-reversal-dialog');
    node.dataset.itemId = item.id;
    node.dataset.reviewToken = preview.token;
    node.querySelector('[name=reason]')?.focus();
  }

  async function fluxAcquisitionWizard(item) {
    if (!fluxMode || !canManage() || item.situation !== 'Aquisição') return;
    let intent;
    let categories;
    let supplyOptions = { items: [], variants: [] };
    try {
      [intent, categories] = await Promise.all([
        moduleApi().acquisitionIntent(item.id), moduleApi().inventoryCategories()
      ]);
    } catch (error) {
      details(item);
      window.AldeckotMessage.show(`Movimentação preservada. Assistente indisponível: ${backendMessage(error)}. Confirme se a migração 069 foi aplicada.`);
      return;
    }
    if (intent?.status === 'completed') {
      const peripheral = intent.destination === 'management' && intent.management_kind === 'peripheral';
      const moduleName = peripheral ? 'Inventário para a Gestão TI'
        : intent.destination === 'management' ? 'Gestão TI' : intent.destination === 'supplies' ? 'Suprimentos' : 'Inventário';
      const recordId = intent.supply_movement_id || intent.management_record_id || intent.inventory_item_id;
      const inventoryLink = peripheral ? `<p><a class="flux-supply-add-variant" href="inventory.html?table=${encodeURIComponent(intent.inventory_table_id)}&amp;item=${encodeURIComponent(recordId)}">Abrir no Inventário</a></p>
        <p>Para instalar, confirme uma TAG compatível no Inventário e use a Conferência por PDV na Gestão TI.</p>` : '';
      modal(`<div class="inv-dialog-head"><h2>Aquisição integrada</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><div class="flux-acquisition-content"><p><b>${escape(item.equipment)}</b> · TAG no recebimento: ${escape(item.tag || 'não informada')} · série ${escape(item.serial)}</p><p>O recebimento já foi integrado ao ${escape(moduleName)}.</p>${inventoryLink}<small>Identificador do registro: ${escape(recordId)}</small></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Fechar</button></div>`, 'equipment-dialog flux-acquisition-dialog');
      return;
    }
    if (intent?.supplyAvailable) {
      try { supplyOptions = await moduleApi().supplyAcquisitionOptions(); }
      catch (error) {
        intent.supplyAvailable = false;
        window.AldeckotMessage.show(`Consulta de Suprimentos indisponível: ${backendMessage(error)}`);
      }
    }
    const destination = intent?.destination || '';
    const category = intent?.inventory_table_id || '';
    const received = item.status === 'Recebido';
    const node = modal(`<div class="inv-dialog-head"><h2>Destino da aquisição</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><div class="flux-acquisition-content"><p>Deseja cadastrar <b>${escape(item.equipment)}</b> (TAG ${escape(item.tag || 'não informada')} · série ${escape(item.serial)}) em algum módulo?</p><p class="flux-acquisition-state">${received ? 'Recebimento confirmado no Flux. A entrada será efetivada somente após sua confirmação.' : 'Aguardando status Recebido: a escolha ficará salva, sem entrada no estoque.'}</p><form data-flux-acquisition-form><div class="inv-fields flux-acquisition-fields"><label><span>Destino *</span><select name="destination" required><option value="" ${destination ? '' : 'selected'} disabled>Selecione</option><option value="inventory" ${destination === 'inventory' ? 'selected' : ''} ${categories.length ? '' : 'disabled'}>Inventário</option><option value="none" ${destination === 'none' ? 'selected' : ''}>Não cadastrar agora</option><option disabled>Gestão TI — próxima etapa</option><option disabled>Suprimentos — próxima etapa</option></select></label><label data-flux-inventory-category ${destination === 'inventory' ? '' : 'hidden'}><span>Tabela do Inventário *</span><select name="inventoryTableId" ${destination === 'inventory' ? 'required' : 'disabled'}><option value="" ${category ? '' : 'selected'} disabled>Escolha a categoria real</option>${categories.map(row => `<option value="${escape(row.id)}" ${category === row.id ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}</select></label></div><p class="flux-acquisition-note">${intent?.status === 'pending' ? 'Escolha salva. Assim que a movimentação estiver Recebida, volte aqui para confirmar a entrada.' : 'O cadastro adicional é opcional; a movimentação do Flux já está salva.'}</p><div class="inv-footer"><button class="inv-primary" type="submit">${received ? 'Continuar' : 'Salvar escolha'}</button><button type="button" class="inv-ghost" data-inv-close>Agora não</button></div></form></div>`, 'equipment-dialog flux-acquisition-dialog');
    node.dataset.itemId = item.id;
    const destinationSelect = node.querySelector('[name="destination"]');
    const categoryLabel = node.querySelector('[data-flux-inventory-category]');
    const categorySelect = node.querySelector('[name="inventoryTableId"]');
    if (intent?.managementAvailable) {
      const managementOption = [...destinationSelect.options].find(option => option.textContent.startsWith('Gestão TI'));
      managementOption.value = 'management';
      managementOption.textContent = 'Gestão TI';
      managementOption.disabled = false;
      const managementFields = document.createElement('div');
      managementFields.className = 'inv-fields flux-acquisition-fields';
      managementFields.dataset.fluxManagementFields = '';
      const kinds = ['Impressora', 'Leitor', 'Gaveta', 'Pin Pad', 'Balança', 'Monitor', 'Teclado'];
      const sectors = window.AldeckotSectors?.names || [];
      const options = (values, selected) => values.map(value =>
        `<option value="${escape(value)}" ${selected === value ? 'selected' : ''}>${escape(value)}</option>`).join('');
      managementFields.innerHTML = `<label><span>Tipo *</span><select name="managementKind">
        <option value="computer">Computador</option>
        <option value="peripheral" ${intent.management_kind === 'peripheral' ? 'selected' : ''} ${intent.peripheralAvailable && categories.length ? '' : 'disabled'}>Periférico</option>
        </select></label>
        <label data-flux-computer-area><span>Área da Gestão TI *</span><select name="managementArea"><option value="">Selecione a área</option>${options(['Frente de Loja', 'Escritório', 'Estoque'], intent.management_area)}</select></label>
        <label data-flux-peripheral-field hidden><span>Tipo de periférico *</span><select name="peripheralKind"><option value="">Selecione o tipo</option>${options(kinds, intent.peripheral_kind)}</select></label>
        <label data-flux-peripheral-field hidden><span>Setor *</span><select name="peripheralSector"><option value="">Selecione o setor</option>${options(sectors, intent.peripheral_sector || item.sector)}</select></label>
        <p class="inv-full flux-acquisition-note" data-flux-peripheral-field hidden>O cadastro inicial fica no Inventário, em Reserva na Sala CPD. Informe a série. A TAG pode ser atribuída antes da instalação em um PDV.</p>`;
      categoryLabel.closest('.flux-acquisition-fields').after(managementFields);
      destinationSelect.value = destination;
    }
    const managementFields = node.querySelector('[data-flux-management-fields]');
    if (intent?.supplyAvailable) {
      const supplyOption = [...destinationSelect.options].find(option => option.textContent.startsWith('Suprimentos'));
      supplyOption.value = 'supplies';
      supplyOption.textContent = 'Suprimentos próprios';
      supplyOption.disabled = !supplyOptions.items.length || item.sourceModule === 'inventory' || Boolean(item.inventoryItemId);
      const supplyFields = document.createElement('div');
      supplyFields.className = 'inv-fields flux-acquisition-fields flux-supply-fields';
      supplyFields.dataset.fluxSupplyFields = '';
      supplyFields.innerHTML = `<label class="inv-full"><span>Buscar item próprio</span><input type="search" data-flux-supply-search placeholder="Nome ou categoria" autocomplete="off"></label><label><span>Item *</span><select name="supplyId" required></select></label><label><span>Variação</span><select name="supplyVariantId"></select></label><label><span>Quantidade recebida *</span><input name="supplyQuantity" type="number" min="1" max="1000000" step="1" value="${intent.supply_quantity || ''}" required></label><p class="flux-supply-balance" data-flux-supply-balance>Selecione um item e informe a quantidade.</p><a class="flux-supply-add-variant" data-flux-supply-add-variant href="supplies.html" target="_blank" rel="noopener noreferrer">Adicionar nova variação em Suprimentos</a><small class="inv-full">Depois de criar uma variação, reabra este assistente para selecioná-la. Sem variação, a entrada vai somente ao saldo base.</small>`;
      (managementFields || categoryLabel.closest('.flux-acquisition-fields')).after(supplyFields);
      const itemSelect = supplyFields.querySelector('[name="supplyId"]');
      const variantSelect = supplyFields.querySelector('[name="supplyVariantId"]');
      const quantityInput = supplyFields.querySelector('[name="supplyQuantity"]');
      const searchInput = supplyFields.querySelector('[data-flux-supply-search]');
      const balance = supplyFields.querySelector('[data-flux-supply-balance]');
      const addVariant = supplyFields.querySelector('[data-flux-supply-add-variant]');
      const updateBalance = () => {
        const selected = supplyOptions.items.find(row => row.id === itemSelect.value);
        const variant = supplyOptions.variants.find(row => row.id === variantSelect.value && row.supply_id === selected?.id);
        const previous = Number(variant ? variant.quantity_stock : selected?.quantity_stock || 0);
        const quantity = Number(quantityInput.value);
        balance.textContent = selected && Number.isSafeInteger(quantity) && quantity > 0
          ? `Saldo da ${variant ? `variação ${variant.name}` : 'base'}: ${previous} → ${previous + quantity} unidade(s). A prévia será conferida novamente no banco.`
          : 'Selecione um item e informe uma quantidade positiva.';
      };
      const updateVariants = preferred => {
        variantSelect.replaceChildren(new Option('Sem variação (saldo base)', ''));
        for (const variant of supplyOptions.variants.filter(row => row.supply_id === itemSelect.value)) {
          variantSelect.add(new Option(`${variant.name}${variant.brand ? ` · ${variant.brand}` : ''}${variant.model && variant.model !== variant.name ? ` · ${variant.model}` : ''}`, variant.id));
        }
        variantSelect.value = preferred || '';
        addVariant.href = itemSelect.value ? `supplies.html?item=${encodeURIComponent(itemSelect.value)}` : 'supplies.html';
        updateBalance();
      };
      const updateItems = preferred => {
        const query = searchInput.value.trim().toLocaleLowerCase('pt-BR');
        itemSelect.replaceChildren(new Option('Selecione um item próprio', '', true, true));
        for (const row of supplyOptions.items.filter(entry =>
          `${entry.name} ${entry.category}`.toLocaleLowerCase('pt-BR').includes(query))) {
          itemSelect.add(new Option(`${row.name} · ${row.category}`, row.id));
        }
        itemSelect.value = preferred || '';
        updateVariants(itemSelect.value === intent.supply_id ? intent.supply_variant_id : '');
      };
      searchInput.addEventListener('input', () => updateItems(itemSelect.value));
      itemSelect.addEventListener('change', () => updateVariants(''));
      variantSelect.addEventListener('change', updateBalance);
      quantityInput.addEventListener('input', updateBalance);
      updateItems(intent.supply_id);
      destinationSelect.value = destination;
    }
    const supplyFields = node.querySelector('[data-flux-supply-fields]');
    const updateDestinationFields = () => {
      const inventory = destinationSelect.value === 'inventory';
      const management = destinationSelect.value === 'management';
      const supplies = destinationSelect.value === 'supplies';
      const kind = managementFields?.querySelector('[name="managementKind"]');
      const peripheral = management && kind?.value === 'peripheral';
      categoryLabel.hidden = !(inventory || peripheral);
      categorySelect.disabled = !(inventory || peripheral);
      categorySelect.required = inventory || peripheral;
      if (managementFields) {
        managementFields.hidden = !management;
        kind.disabled = !management;
        const areaLabel = managementFields.querySelector('[data-flux-computer-area]');
        const area = areaLabel.querySelector('select');
        areaLabel.hidden = peripheral;
        area.disabled = !management || peripheral;
        area.required = management && !peripheral;
        managementFields.querySelectorAll('[data-flux-peripheral-field]').forEach(field => {
          field.hidden = !peripheral;
          const select = field.querySelector('select');
          if (select) {
            select.disabled = !peripheral;
            select.required = peripheral;
          }
        });
      }
      if (supplyFields) {
        supplyFields.hidden = !supplies;
        supplyFields.querySelectorAll('select, input[name="supplyQuantity"]').forEach(field => {
          field.disabled = !supplies;
          field.required = supplies && field.name !== 'supplyVariantId';
        });
      }
    };
    destinationSelect.addEventListener('change', updateDestinationFields);
    managementFields?.querySelector('[name="managementKind"]').addEventListener('change', updateDestinationFields);
    updateDestinationFields();
  }

  function logForm(item, entry = null) {
    const node = modal(`<div class="inv-dialog-head"><h2>${entry ? 'Editar registro' : 'Adicionar registro'}</h2><button class="inv-close" data-inv-close>×</button></div><p class="inv-log-intro">${escape(item.equipment)} · ${entry ? 'altere o texto do registro abaixo.' : 'o horário do registro será salvo automaticamente.'}</p><form data-inv-log-form><div class="inv-fields"><label class="inv-full"><span>Ocorrência</span><textarea name="message" required maxlength="500" placeholder="Ex.: Equipamento revisado, manutenção realizada ou troca de local.">${escape(entry?.text || '')}</textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button class="inv-primary">${entry ? 'Salvar alterações' : 'Salvar no histórico'}</button></div></form>`);
    node.dataset.itemId = item.id;
    node.dataset.logId = entry?.id || '';
  }

  function promotionForm(item) {
    const node = modal(`<div class="inv-dialog-head"><h2>Encaminhar para manutenção</h2><button class="inv-close" data-inv-close aria-label="Fechar">×</button></div><p class="inv-log-intro">${escape(item.equipment)} · a verificação será encerrada e um chamado de manutenção relacionado será aberto. O status no Inventário passará a Manutenção; setor e localização serão preservados.</p><form data-inv-promotion-form><div class="inv-fields"><label class="inv-full"><span>Justificativa *</span><textarea name="reason" required minlength="3" maxlength="2000" placeholder="Descreva o diagnóstico que exige manutenção."></textarea></label></div><div class="inv-footer"><button type="button" class="inv-ghost" data-inv-close>Cancelar</button><button type="submit" class="inv-primary">Confirmar encaminhamento</button></div></form>`, 'equipment-dialog');
    node.dataset.itemId = item.id;
    node.dataset.operationId = crypto.randomUUID();
  }

  function updateLogMessage(old, values) {
    if (!old) return controlMode ? 'Equipamento adicionado ao Controle TI.' : fluxMode ? 'Movimentação adicionada ao Flux.' : 'Equipamento adicionado ao inventário.';
    if (controlMode) {
      const labels = { equipment: 'equipamento', model: 'modelo', brand: 'marca', serial: 'nº de série', tag: 'TAG', sector: 'setor', entryDate: 'data de entrada', exitDate: 'data de saída', status: 'status', priority: 'prioridade', situation: 'tipo de limpeza', notes: 'observações' };
      const changes = Object.entries(labels).flatMap(([key, label]) => String(old[key] || '') !== String(values[key] || '') ? [`${label}: “${old[key] || '—'}” → “${values[key] || '—'}”`] : []);
      return changes.length ? `Alterações realizadas — ${changes.join('; ')}.` : 'Equipamento revisado sem alterações de campos.';
    }
    if (fluxMode) {
      const labels = { movement: 'movimentação', equipment: 'equipamento', model: 'modelo', brand: 'marca', tag: 'TAG', serial: 'nº de série', senderCompany: 'empresa remetente', destinationCompany: 'empresa destino', senderResponsible: 'responsável pelo envio', receiverResponsible: 'responsável pelo recebimento', sendDate: 'data de envio', receivedDate: 'data de recebimento', shippingType: 'tipo de envio', situation: 'motivo', status: 'status', priority: 'prioridade', notes: 'observações' };
      const changes = Object.entries(labels).flatMap(([key, label]) => String(old[key] || '') !== String(values[key] || '') ? [`${label}: “${old[key] || '—'}” → “${values[key] || '—'}”`] : []);
      return changes.length ? `Alterações realizadas — ${changes.join('; ')}.` : 'Movimentação revisada sem alterações de campos.';
    }
    const labels = { equipment: 'equipamento', model: 'modelo', brand: 'marca', serial: 'nº de série', tag: 'TAG', sector: 'setor', location: 'local', status: 'status', priority: 'prioridade', situation: 'situação', cleaning: 'tipo de limpeza', notes: 'observações' };
    const changes = Object.entries(labels).flatMap(([key, label]) => String(old[key] || '') !== String(values[key] || '') ? [`${label}: “${old[key] || '—'}” → “${values[key] || '—'}”`] : []);
    return changes.length ? `Alterações realizadas — ${changes.join('; ')}.` : 'Equipamento revisado sem alterações de campos.';
  }

  function chooseMaintenanceResult(item) {
    return new Promise(resolve => {
      const peripheral = Boolean(item.inventoryItemId) &&
        /^(?:IMPR|EAN|GVT|PP|BAL|AJMON|MON|TEC)[0-9]+$/i.test(String(item.tag || '').trim());
      const sectors = window.AldeckotSectors?.optionsFor(item.sector) ||
        ['', item.sector, 'Frente de Loja', 'Doca', 'Escritório', 'Informática',
          'Monitoramento', 'Tesouraria', 'Padaria', 'Açougue', 'Refeitório']
          .filter((value, index, all) => all.indexOf(value) === index);
      const sectorChoice = sectors.map(value => `<option value="${escape(value)}" ${value === item.sector ? 'selected' : ''}>${escape(value || 'Selecione um setor')}</option>`).join('');
      const destinationFields = peripheral ? `<div class="inv-fields"><label><span>Local final *</span><input name="location" required placeholder="PDV 10 ou Sala CPD"></label><label><span>Setor final *</span><select name="sector" required>${sectorChoice}</select></label><label class="inv-full"><span>Motivo da decisão *</span><textarea name="reason" required minlength="5" maxlength="500" placeholder="Descreva o destino físico confirmado"></textarea></label></div><div class="inv-log-intro" data-maintenance-preview aria-live="polite">Escolha o status e o destino para conferir o PDV antes de concluir.</div>` : '';
      const node = modal(`<div class="inv-dialog-head"><h2>Concluir manutenção</h2><button type="button" class="inv-close" data-inv-maintenance-cancel aria-label="Cancelar">×</button></div><p class="inv-log-intro">${peripheral ? `Confira a condição e o destino físico de ${escape(item.equipment)}. Ativo exige PDV livre; Reserva exige local fora dos PDVs.` : `Defina o status de ${escape(item.equipment)} no módulo de origem. A localização e os vínculos existentes serão preservados.`}</p><form data-inv-maintenance-choice><div class="inv-maintenance-choices" role="radiogroup" aria-label="Status do equipamento"><label><input type="radio" name="equipmentStatus" value="Ativo" required><span>Ativo</span></label><label><input type="radio" name="equipmentStatus" value="Reserva" required><span>Reserva</span></label></div>${destinationFields}<div class="inv-footer"><button type="button" class="inv-ghost" data-inv-maintenance-cancel>Cancelar</button>${peripheral ? '<button type="button" class="inv-ghost" data-maintenance-review>Conferir destino</button>' : ''}<button type="submit" class="inv-primary" ${peripheral ? 'disabled' : ''}>Confirmar conclusão</button></div></form>`, 'equipment-dialog inv-maintenance-dialog');
      node.querySelectorAll('[data-inv-maintenance-cancel]').forEach(button => button.addEventListener('click', () => { closeModal(); resolve(null); }));
      const form = node.querySelector('[data-inv-maintenance-choice]');
      let review = null;
      let revision = 0;
      if (peripheral) {
        const previewNode = node.querySelector('[data-maintenance-preview]');
        const confirmButton = form.querySelector('[type="submit"]');
        const reviewButton = form.querySelector('[data-maintenance-review]');
        form.addEventListener('input', () => {
          revision += 1; review = null; confirmButton.disabled = true;
          previewNode.textContent = 'Dados alterados. Confira novamente antes de concluir.';
        });
        reviewButton.addEventListener('click', async () => {
          if (!form.reportValidity()) return;
          const values = Object.fromEntries(new FormData(form));
          const currentRevision = revision;
          reviewButton.disabled = true;
          previewNode.textContent = 'Conferindo equipamento, chamado e PDV…';
          try {
            const result = await moduleApi().previewPeripheralCompletion(item.id, {
              status: values.equipmentStatus, location: values.location.trim(),
              sector: values.sector.trim()
            });
            if (currentRevision !== revision) return;
            review = result;
            previewNode.textContent = result.blocked
              ? `Operação bloqueada: ${result.reason || 'destino inválido'}.`
              : `${result.item?.tag || item.tag}: ${result.item?.location || 'sem local'} / ${result.item?.status} → ${result.target?.location} / ${result.target?.status}. Controle TI, Inventário e Gestão TI serão conferidos na mesma operação.`;
            confirmButton.disabled = Boolean(result.blocked);
          } catch (error) {
            if (currentRevision !== revision) return;
            review = null; previewNode.textContent = backendMessage(error);
          } finally { reviewButton.disabled = false; }
        });
      }
      form.addEventListener('submit', event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const selection = values.equipmentStatus;
        if (!['Ativo', 'Reserva'].includes(selection)) return;
        if (peripheral && (!review || review.blocked)) return;
        closeModal();
        resolve(peripheral ? { status: selection, location: values.location.trim(),
          sector: values.sector.trim(), reason: values.reason.trim(), token: review.token }
          : selection);
      });
    });
  }

  async function saveItem(form) {
    if (fluxMode && form.dataset.fluxBusy === 'true') return;
    const table = activeTable(); const values = Object.fromEntries(new FormData(form)); const modalNode = document.querySelector('.inv-modal'); const id = modalNode.dataset.itemId; const old = id ? table.items.find(entry => entry.id === id) : null; let item = { ...values, id: id || `item-${Date.now()}`, date: old?.date || new Date().toISOString().slice(0, 10) };
    const verificationStart = !controlMode && !fluxMode && item.situation === 'Verificando'
      && old?.situation !== 'Verificando';
    if (verificationStart) {
      if (!old) {
        window.AldeckotMessage.show('Cadastre o equipamento primeiro; depois inicie a verificação com um motivo.');
        return;
      }
      const unrelatedChanges = ['equipment','model','brand','serial','tag','sector','location',
        'status','priority','cleaning','notes','branchId'].filter(field =>
        String(old[field] ?? '').trim() !== String(values[field] ?? '').trim());
      if (unrelatedChanges.length) {
        window.AldeckotMessage.show('Salve as outras alterações primeiro. A verificação preserva status, local e demais dados do equipamento.');
        return;
      }
      if (String(values.verificationReason || '').trim().length < 3) {
        window.AldeckotMessage.show('Descreva o motivo da verificação antes de continuar.');
        form.querySelector('[name="verificationReason"]')?.focus();
        return;
      }
    }
    const usesPdv = location => /^PDV\s+[0-9]+$/i.test(String(location || '').trim());
    const pdvMovement = !controlMode && !fluxMode && old
      && String(old.location || '').trim() !== String(item.location || '').trim()
      && (usesPdv(old.location) || usesPdv(item.location));
    const movementReason = String(values.movementReason || '').trim();
    if (pdvMovement && movementReason.length < 5) {
      window.AldeckotMessage.show('Explique o motivo da mudança de Local antes de salvar.');
      form.querySelector('[name="movementReason"]')?.focus();
      return;
    }
    if (!controlMode && !fluxMode && values.branchId) {
      const suggested = branchModel.proposalForTable(table, { equipment: values.equipment });
      const chosen = table.branches.find(branch => branch.id === values.branchId);
      if (suggested && chosen && branchModel.normalize(suggested) !== branchModel.normalize(chosen.classificationKey || chosen.name)) {
        const proceed = await window.AldeckotMessage.confirm(`Este equipamento normalmente pertence a “${suggested}”. Continuar em “${chosen.name}”?`, { title: 'Conferir ramificação', confirmText: 'Continuar' });
        if (!proceed) return;
      }
    }
    const valuesToSave = { ...item };
    if (fluxMode) {
      valuesToSave.sourceModule = modalNode.dataset.sourceModule || null;
      valuesToSave.sourceRecordId = modalNode.dataset.sourceRecordId || null;
      valuesToSave.inventoryItemId = modalNode.dataset.inventoryItemId || null;
    }
    if (old) {
      ['tag', 'serial'].forEach(field => {
        const before = String(old[field] || '').trim().toLocaleLowerCase('pt-BR');
        const after = String(item[field] || '').trim().toLocaleLowerCase('pt-BR');
        if (before === after) delete valuesToSave[field];
      });
    }
    if (pdvMovement && window.AldeckotLocalRegularization?.peripheralTag(old?.tag)) {
      const unrelatedChanges = ['equipment', 'model', 'brand', 'serial', 'tag',
        'situation', 'cleaning', 'notes', 'priority', 'branchId'].filter(field =>
        String(old[field] ?? '').trim() !== String(values[field] ?? '').trim());
      if (unrelatedChanges.length) {
        window.AldeckotMessage.show('Salve os outros campos primeiro. A conferência de local deve registrar somente local, setor e status.');
        return;
      }
      try {
        await window.AldeckotLocalRegularization.open({ item: old,
          location: item.location, sector: item.sector, status: item.status,
          reason: movementReason,
          onSaved: async saved => {
            closeModal();
            await reloadInventory();
            renderInventory();
            const updated = activeTable()?.items.find(entry => entry.id ===
              (saved.incomingItemId || saved.id));
            if (updated) details(updated);
          } });
      } catch (error) { window.AldeckotMessage.show(backendMessage(error)); }
      return;
    }
    const verificationCompletion = controlMode && old?.followUpKind === 'verification'
      && old.status !== 'Verificação concluída' && item.status === 'Verificação concluída';
    if (controlMode && old?.followUpKind === 'verification') {
      if (form.dataset.verificationBusy) return;
      if (['tag','serial'].some(key => String(old[key] || '').trim() !== String(item[key] || '').trim())) {
        window.AldeckotMessage.show('Altere a identificação do equipamento no módulo de origem.'); return;
      }
      if (verificationCompletion && String(valuesToSave.notes || '').trim().length < 3) {
        window.AldeckotMessage.show('Descreva o resultado da verificação em Observações antes de concluir.');
        form.querySelector('[name="notes"]')?.focus(); return;
      }
    }
    let maintenanceStatus = null;
    if (controlMode && old && old.status !== 'Manutenção concluída' && item.status === 'Manutenção concluída') {
      if (old.supplyUnitId) {
        window.AldeckotMessage.show('Conclua esta ordem pelo fluxo próprio de manutenção de Suprimentos.');
        return;
      }
      maintenanceStatus = await chooseMaintenanceResult(old);
      if (!maintenanceStatus) return;
    }
    let fluxReview = null;
    if (fluxMode) {
      form.dataset.fluxBusy = 'true';
      valuesToSave.tag = item.tag;
      valuesToSave.serial = item.serial;
      try {
        const preview = await moduleApi().previewMovement(table.id, valuesToSave, id || null);
        if (!window.AldeckotFluxReview) throw new Error('Prévia de movimentação indisponível. Recarregue a página.');
        if (!await window.AldeckotFluxReview.confirm(preview, item)) {
          delete form.dataset.fluxBusy;
          return;
        }
        const requestKey = JSON.stringify({ tableId: table.id, existingId: id || null, values,
          sourceModule: valuesToSave.sourceModule, sourceRecordId: valuesToSave.sourceRecordId });
        if (form.dataset.fluxRequestKey !== requestKey) {
          form.dataset.fluxRequestKey = requestKey;
          form.dataset.fluxRequestId = crypto.randomUUID();
        }
        fluxReview = { token: preview.token, requestId: form.dataset.fluxRequestId };
      } catch (error) {
        delete form.dataset.fluxBusy;
        window.AldeckotMessage.show(backendMessage(error));
        return;
      }
    }
    const submit = form.querySelector('[type="submit"]'); const originalLabel = submit?.textContent; const finishSave = window.AldeckotLoading?.beginSave?.(old ? 'Salvando alterações…' : 'Adicionando item…');
    if (submit) { submit.disabled = true; submit.textContent = 'Salvando…'; }
    let savedCommitted = false;
    try {
      let message = updateLogMessage(old, item);
      if (!controlMode && !fluxMode && old && values.branchId) {
        const before = branchModel.branchFor(table, old)?.name || 'Sem ramificação';
        const after = table.branches.find(branch => branch.id === values.branchId)?.name || 'Sem ramificação';
        if (before !== after) message = `Ramificação: ${before} → ${after}. ${message}`;
      }
      if (pdvMovement) message = `Motivo da movimentação: ${movementReason}. ${message}`;
      const movementContext = pdvMovement ? {
        operationId: modalNode.dataset.movementOperationId,
        expectedUpdatedAt: old.updatedAt,
        reason: movementReason,
        previousLocation: old.location,
        previousTag: old.tag
      } : null;
      if (verificationCompletion) {
        form.dataset.verificationBusy = 'true';
        form.dataset.verificationRequestId ||= crypto.randomUUID();
      }
      const saved = verificationCompletion
        ? await moduleApi().completeVerification(id, valuesToSave, form.dataset.verificationRequestId)
        : verificationStart
        ? await moduleApi().startVerification(id, String(values.verificationReason).trim(),
          old.updatedAt, form.dataset.verificationStartRequestId ||= crypto.randomUUID())
        : maintenanceStatus
        ? await moduleApi().completeMaintenance(id, valuesToSave, maintenanceStatus, crypto.randomUUID())
        : await moduleApi().saveItem(table.id, valuesToSave, id || null, message.slice(0, 490),
          fluxMode ? fluxReview : movementContext);
      savedCommitted = true;
      let peripheralSync;
      try { peripheralSync = await moduleApi().syncManagementPeripheral?.(saved, old); }
      catch (syncError) {
        console.warn('Não foi possível concluir a sincronização com a Gestão TI.', syncError);
        peripheralSync = { state: 'sync-failed' };
      }
      closeModal();
      await reloadInventory();
      if (!controlMode && !fluxMode && state.branchId && values.branchId) state.branchId = values.branchId;
      renderInventory();
      const updatedItem = activeTable()?.items.find(entry => entry.id === saved.id);
      if (updatedItem && fluxMode && updatedItem.situation === 'Aquisição' && canManage()) await fluxAcquisitionWizard(updatedItem);
      else if (updatedItem) details(updatedItem);
      if (peripheralSync?.state === 'updated' || peripheralSync?.state === 'already-synced') window.AldeckotMessage.show(`${peripheralSync.type} sincronizado no computador ${peripheralSync.location}.`);
      if (peripheralSync?.state === 'target-not-found') window.AldeckotMessage.show(`Equipamento salvo, mas não há computador na Gestão TI com o nome “${peripheralSync.location}”.`);
      if (peripheralSync?.state === 'cleared') window.AldeckotMessage.show('Vínculo do periférico removido da Gestão TI.');
      if (peripheralSync?.state === 'sync-failed') window.AldeckotMessage.show('Equipamento salvo. A sincronização com a Gestão TI será retomada quando o módulo atualizar.');
    } catch (error) {
      if (submit) { submit.disabled = false; submit.textContent = originalLabel; }
      window.AldeckotMessage.show(savedCommitted
        ? `${fluxMode ? 'Movimentação gravada' : 'Item salvo'}, mas a tela não atualizou: ${backendMessage(error)}. Recarregue antes de tentar novamente.`
        : backendMessage(error));
    } finally { delete form.dataset.verificationBusy; if (fluxMode) delete form.dataset.fluxBusy; await finishSave?.(); }
  }
  function download(content, name, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = name; link.click(); URL.revokeObjectURL(link.href); }
  function safeFileName(value) { return String(value || 'inventario').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }
  function formattedNow() { return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }

  function showControlPdf() {
    const ordered = controlBoard.periods(data.tables);
    const initial = activeTable() || ordered[0];
    if (!initial) {
      window.AldeckotMessage.show('Nenhum período está disponível para exportar.');
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'control-pdf-dialog';
    dialog.setAttribute('aria-labelledby', 'control-pdf-title');
    dialog.innerHTML = controlBoard.pdfDialog(ordered, initial.id);
    const period = dialog.querySelector('[name="period"]');
    const scope = dialog.querySelector('[name="scope"]');
    const report = dialog.querySelector('.control-pdf-report');
    const count = dialog.querySelector('[data-control-pdf-count]');
    const print = dialog.querySelector('[data-control-pdf-print]');
    const originalTitle = document.title;
    const restoreTitle = () => { document.title = originalTitle; };
    const refreshPreview = () => {
      const table = data.tables.find(entry => entry.id === period.value);
      const canUseFilters = table?.id === state.active && Boolean(state.query.trim() || state.status || state.situation || state.operation);
      scope.options[1].disabled = !canUseFilters;
      if (!canUseFilters) scope.value = 'all';
      const items = scope.value === 'filtered' ? filteredControlItems(table) : scopedItems(table);
      print.disabled = !items.length;
      count.textContent = `${items.length} ${items.length === 1 ? 'registro para exportar' : 'registros para exportar'}`;
      report.innerHTML = table ? controlBoard.pdfReport(table, items, scope.selectedOptions[0].textContent, formattedNow(), dateValue)
        : '<p>Este período não está mais disponível.</p>';
      return table;
    };
    if (state.active && (state.query.trim() || state.status || state.situation || state.operation)) scope.value = 'filtered';
    dialog.addEventListener('change', refreshPreview);
    dialog.querySelector('[data-control-pdf-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      restoreTitle();
      window.removeEventListener('afterprint', restoreTitle);
      dialog.remove();
    }, { once: true });
    print.addEventListener('click', () => {
      const table = refreshPreview();
      if (print.disabled) return;
      document.title = `aldeckot-controle-ti-${safeFileName(table.name)}${scope.value === 'filtered' ? '-filtrado' : ''}`;
      window.addEventListener('afterprint', restoreTitle, { once: true });
      window.print();
    });
    refreshPreview();
    document.body.append(dialog);
    dialog.showModal();
  }

  function exportPdf(popupWindow = null) {
    const table = activeTable();
    if (!table) { window.AldeckotMessage.show('Selecione uma tabela para exportá-la em PDF.'); return; }
    const printBrand = new URL('assets/aldeckot-symbol.png?v=2.0.73', location.href).href;
    if (fluxMode) {
      const rows = table.items.map(item => `<tr><td>${escape(item.movement)}</td><td>${escape(item.equipment)}</td><td>${escape(item.model)}</td><td>${escape(item.brand)}</td><td>${escape(item.tag)}</td><td>${escape(item.serial)}</td><td>${escape(item.senderCompany)}</td><td>${escape(item.destinationCompany)}</td><td>${escape(item.senderResponsible)}</td><td>${escape(item.receiverResponsible)}</td><td>${dateValue(item.sendDate)}</td><td>${dateValue(item.receivedDate)}</td><td>${escape(item.shippingType)}</td><td>${escape(item.situation)}</td><td>${escape(item.status)}</td><td>${escape(item.notes || '—')}</td></tr>`).join('') || '<tr><td colspan="16" class="empty">Nenhuma movimentação cadastrada nesta tabela.</td></tr>';
      const popup = popupWindow || window.open('', '_blank', 'width=1280,height=860');
      if (!popup) { window.AldeckotMessage.show('Permita a abertura da janela de impressão para gerar o PDF.'); return; }
      popup.document.open();
      popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ALDECKOT — ${escape(table.name)}</title><style>@page{size:A3 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17202d;font-size:6px;margin:0}header{border-bottom:2px solid #2596e7;margin-bottom:10px;padding-bottom:7px}h1{font-size:17px;margin:0 0 3px;color:#10203a}p{margin:0;color:#516070}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#13223c;color:#fff;font-size:6px;letter-spacing:.1px;padding:5px 2px;text-align:left}td{border-bottom:1px solid #d5dce4;vertical-align:top;overflow-wrap:anywhere;padding:4px 2px}tbody tr:nth-child(even){background:#f4f7fa}.empty{text-align:center;padding:28px;color:#617084}footer{position:fixed;bottom:0;font-size:7px;color:#647386}.print-brand{display:block;width:54px;height:36px;object-fit:contain;margin-bottom:3px}</style></head><body><header><img class="print-brand" src="${printBrand}" alt=""><h1>ALDECKOT · FLUX</h1><p>Tabela: <strong>${escape(table.name)}</strong> · ${table.items.length} movimentação(ões) · Exportado em ${formattedNow()}</p></header><table><thead><tr><th>Movimentação</th><th>Equipamento</th><th>Modelo</th><th>Marca</th><th>TAG</th><th>Nº Série</th><th>Remetente</th><th>Destino</th><th>Responsável Envio</th><th>Responsável Recebimento</th><th>Envio</th><th>Recebimento</th><th>Tipo</th><th>Motivo</th><th>Status</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table><footer>ALDECKOT — Controle de envio e recebimento</footer><script>window.onload=()=>{window.focus();window.print();};<\/script></body></html>`);
      popup.document.close();
      return;
    }
    const rows = table.items.map(item => `<tr><td>${escape(item.equipment)}</td><td>${escape(item.model)}</td><td>${escape(item.brand)}</td><td>${escape(item.serial)}</td><td>${escape(item.tag)}</td><td>${escape(item.status)}</td><td>${escape(item.situation)}</td><td>${escape(item.cleaning || 'Não realizada')}</td><td>${escape(item.date || '—')}</td><td>${escape(item.notes || '—')}</td></tr>`).join('') || '<tr><td colspan="10" class="empty">Nenhum equipamento cadastrado nesta tabela.</td></tr>';
    const popup = popupWindow || window.open('', '_blank', 'width=1280,height=860');
    if (!popup) { window.AldeckotMessage.show('Permita a abertura da janela de impressão para gerar o PDF.'); return; }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ALDECKOT — ${escape(table.name)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17202d;font-size:9px;margin:0}header{border-bottom:2px solid #2596e7;margin-bottom:14px;padding-bottom:10px}h1{font-size:20px;margin:0 0 4px;color:#10203a}p{margin:0;color:#516070}table{width:100%;border-collapse:collapse;table-layout:fixed}th{background:#13223c;color:#fff;font-size:8px;letter-spacing:.2px;padding:8px 5px;text-align:left}td{border-bottom:1px solid #d5dce4;vertical-align:top;overflow-wrap:anywhere;padding:7px 5px}tbody tr:nth-child(even){background:#f4f7fa}.empty{text-align:center;padding:28px;color:#617084}footer{position:fixed;bottom:0;font-size:8px;color:#647386}@media print{footer{position:fixed}}.print-brand{display:block;width:54px;height:36px;object-fit:contain;margin-bottom:3px}</style></head><body><header><img class="print-brand" src="${printBrand}" alt=""><h1>ALDECKOT · INVENTÁRIO</h1><p>Tabela: <strong>${escape(table.name)}</strong> · ${table.items.length} item(ns) · Exportado em ${formattedNow()}</p></header><table><thead><tr><th>Equipamento</th><th>Modelo</th><th>Marca</th><th>Nº Série</th><th>TAG</th><th>Status</th><th>Situação</th><th>Limpeza</th><th>Data</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table><footer>ALDECKOT — Controle de Equipamentos</footer><script>window.onload=()=>{window.focus();window.print();};<\/script></body></html>`);
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
    const settingsReady = meta.availability === 'ready';
    const backupNotice = meta.availability === 'loading' ? 'Consultando backup em rede…'
      : settingsReady ? '' : 'Backup em rede indisponível. Tente novamente ao reabrir esta janela.';
    const latestMessage = latest ? 'Backup realizado com sucesso' : settingsReady ? 'Nenhum backup realizado' : 'Último backup indisponível';
    const latestDetail = latest ? (latest.source === 'automatic' ? 'Backup automático' : latest.source === 'local' ? 'Backup local' : 'Backup manual') : `Crie seu primeiro backup para proteger os dados do ${moduleConfig.backupName}.`;
    return replaceBackupModal(`<section class="backup-dialog-content"><header class="backup-dialog-header"><div class="backup-title-icon">${backupSvg('backup')}</div><div><h2>Sistema de Backup</h2><p>Proteção e recuperação dos dados do ${moduleConfig.backupName}</p></div><button class="backup-close" data-inv-close aria-label="Fechar sistema de backup" title="Fechar">${backupSvg('close')}</button></header><p data-inv-backup-availability role="status" ${backupNotice ? '' : 'hidden'}>${backupNotice}</p><section class="backup-latest" aria-labelledby="backup-latest-title"><h3 id="backup-latest-title">Último backup</h3><div class="backup-latest-grid"><div class="backup-latest-result ${latest ? 'success' : 'empty'}"><span class="backup-status-icon">${backupSvg(latest ? 'check' : 'history')}</span><span><b>${latestMessage}</b><small>${latestDetail}</small></span></div><div class="backup-latest-time">${backupSvg('calendar')}<span><b>${latest ? backupDate(latest.created_at) : '—'}</b><small>${latest ? backupTime(latest.created_at) : '—'}</small></span></div><button class="backup-automatic-status" data-inv-action="toggle-auto-backup" role="switch" aria-checked="${meta.automatic}" ${settingsReady ? '' : 'disabled'} aria-label="${meta.automatic ? 'Desativar' : 'Ativar'} backup automático"><i></i><span><b>${!settingsReady ? 'Indisponível' : meta.automatic ? 'Ativado' : 'Desativado'}</b><small>Backup automático</small></span></button></div></section><section class="backup-actions-section" aria-labelledby="backup-actions-title"><h3 id="backup-actions-title">Ações</h3><div class="backup-action-grid"><button class="backup-action-card create" data-inv-action="create-backup"><span class="backup-action-icon">${backupSvg('download')}</span><span><b>Criar Backup</b><small>Criar uma cópia completa dos dados do ${moduleConfig.backupName}.</small></span></button><button class="backup-action-card restore" data-inv-action="restore-backup"><span class="backup-action-icon">${backupSvg('upload')}</span><span><b>Restaurar Backup</b><small>Selecionar um backup e recuperar os dados.</small></span></button></div></section><div class="backup-details-grid"><section class="backup-automatic-panel" aria-labelledby="backup-auto-title"><h3 id="backup-auto-title">Backup automático</h3><button class="backup-switch-row" data-inv-action="toggle-auto-backup" role="switch" aria-checked="${meta.automatic}" ${settingsReady ? '' : 'disabled'}><span class="backup-switch ${meta.automatic ? 'enabled' : ''}"><i></i></span><span><b>Backup automático</b><small>Criar automaticamente uma cópia dos dados em intervalos definidos.</small></span></button><label class="backup-frequency"><span>Frequência</span><span class="backup-frequency-control">${backupSvg('calendar')}<input type="number" min="1" max="90" step="1" value="${meta.frequencyDays}" ${settingsReady ? '' : 'disabled'} data-inv-backup-frequency aria-label="Frequência do backup automático em dias"><em>dias</em></span><small>De 1 a 90 dias. A alteração é salva automaticamente.</small></label></section><section class="backup-history-panel" aria-labelledby="backup-history-title"><h3 id="backup-history-title">Histórico de backups</h3><div class="backup-history-list">${backupHistoryMarkup(meta.history)}</div></section></div><footer class="backup-dialog-footer"><div class="backup-warning">${backupSvg('warning')}<p><b>Atenção:</b> restaurar um backup substituirá todos os dados atuais do ${moduleConfig.backupName} pelos dados do backup selecionado.<br>Esta ação não poderá ser desfeita.</p></div><button class="backup-secondary-button" data-inv-close>Fechar</button></footer></section>`);
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
    if (controlMode || fluxMode) requestAnimationFrame(() => {
      const warning = document.querySelector('.backup-confirm-warning p');
      if (warning) warning.textContent = `A restauração substituirá todos os dados atuais do ${moduleConfig.backupName} pelos dados do backup selecionado. Esta ação não poderá ser desfeita.`;
    });
    const tableCount = pendingRestore.snapshot?.tables?.length || 0;
    return replaceBackupModal(`<section class="backup-dialog-content backup-confirm-dialog"><header class="backup-dialog-header"><div class="backup-title-icon restore-title-icon">${backupSvg('upload')}</div><div><h2>Confirmar restauração</h2><p>${escape(pendingRestore.label)}</p></div><button class="backup-close" data-inv-close aria-label="Fechar">${backupSvg('close')}</button></header><div class="backup-confirm-summary">${backupSvg('calendar')}<span><b>${escape(pendingRestore.dateLabel)}</b><small>${tableCount} ${tableCount === 1 ? 'tabela será restaurada' : 'tabelas serão restauradas'}</small></span></div><div class="backup-confirm-warning">${backupSvg('warning')}<div><b>Atenção</b><p>A restauração substituirá os dados atuais do Inventário pelos dados do backup selecionado. Esta ação não poderá ser desfeita.</p></div></div><footer class="backup-choice-footer"><button class="backup-secondary-button" data-inv-action="restore-backup">Cancelar</button><button class="backup-critical-button" data-inv-action="confirm-backup-restore">Restaurar Backup</button></footer></section>`);
  }

  async function createLocalBackup(button) {
    if (!backupButtonBusy(button, 'Criando Backup…')) return;
    try {
      const snapshot = !controlMode && !fluxMode ? await moduleApi().load() : data;
      const now = new Date();
      const payload = { application: 'ALDECKOT', module: moduleConfig.backupModule, version: 1, createdAt: now.toISOString(), data: clone(snapshot) };
      download(JSON.stringify(payload, null, 2), `aldeckot-${moduleConfig.backupFile}-backup-${now.toISOString().slice(0, 10)}.json`, 'application/json');
      writeBackupMeta({ last: formattedNow(), lastAt: now.toISOString(), lastSource: 'local' });
      closeModal(); renderInventory(); window.AldeckotMessage.show('Backup local criado com sucesso.');
    } catch (error) {
      console.error('Falha ao criar backup local:', error);
      clearBackupBusy();
      window.AldeckotMessage.show(backendMessage(error));
    } finally { backupBusy = false; }
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
          console.warn(`Backup do ${moduleConfig.backupName} rejeitado:`, error);
          window.AldeckotMessage.show(`Este arquivo não é um backup válido do ${moduleConfig.backupName}.`);
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
      const snapshot = !controlMode && !fluxMode ? await moduleApi().load() : data;
      const row = await backupApi().create(clone(snapshot), `Backup manual do ${moduleConfig.backupName}`, 'network');
      const meta = readBackupMeta();
      writeBackupMeta({ last: new Date(row.created_at).toLocaleString('pt-BR'), lastAt: row.created_at, lastSource: row.source, history: [row, ...meta.history.filter(backup => backup.id !== row.id)].slice(0, 3) });
      closeModal(); renderInventory(); window.AldeckotMessage.show('Backup criado com sucesso.');
    } catch (error) {
      console.error(`Falha ao criar backup do ${moduleConfig.backupName}:`, error);
      clearBackupBusy();
      window.AldeckotMessage.show('Não foi possível criar o backup. Verifique sua conexão e tente novamente.');
    } finally { backupBusy = false; }
  }

  function prepareNetworkRestore(backupId) {
    const backup = readBackupMeta().history.find(entry => entry.id === backupId);
    if (!backup) { window.AldeckotMessage.show(`Este backup não está mais disponível. Atualize o ${moduleConfig.backupName} e tente novamente.`); return; }
    pendingRestore = { snapshot: backup.snapshot, label: `Backup ${backupSource(backup.source).toLowerCase()}`, dateLabel: `${backupDate(backup.created_at)} — ${backupTime(backup.created_at)}`, legacy: false };
    backupRestoreConfirmation();
  }

  async function restoreSelectedBackup(button) {
    if (!pendingRestore || !backupButtonBusy(button, 'Restaurando Backup…')) return;
    try {
      await moduleApi().replace(pendingRestore.snapshot);
      await reloadInventory();
      const restoredLegacy = pendingRestore.legacy;
      pendingRestore = null;
      closeModal(); renderInventory();
      window.AldeckotMessage.show(restoredLegacy ? 'Backup antigo importado e convertido com sucesso.' : 'Backup restaurado com sucesso.');
    } catch (error) {
      console.error(`Falha ao restaurar backup do ${moduleConfig.backupName}:`, error);
      clearBackupBusy();
      window.AldeckotMessage.show('Não foi possível restaurar o backup. Verifique sua conexão e tente novamente.');
    } finally { backupBusy = false; }
  }

  async function toggleAutomaticBackup(button) {
    const meta = readBackupMeta();
    if (meta.availability !== 'ready' || !backupButtonBusy(button, `${meta.automatic ? 'Desativando' : 'Ativando'}…`)) return;
    try {
      const setting = await backupApi().setAutomatic(!meta.automatic);
      writeBackupMeta({ automatic: setting.automatic });
      backupBusy = false;
      backupModal();
    } catch (error) {
      console.error('Falha ao atualizar backup automático:', error);
      clearBackupBusy();
      window.AldeckotMessage.show('Não foi possível atualizar o backup automático. Tente novamente.');
    } finally { backupBusy = false; }
  }

  async function updateBackupFrequency(input) {
    const days = Number(input.value);
    const meta = readBackupMeta();
    if (meta.availability !== 'ready') return;
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      input.value = meta.frequencyDays;
      window.AldeckotMessage.show('Informe uma frequência entre 1 e 90 dias.');
      return;
    }
    input.disabled = true;
    try {
      const setting = await backupApi().setFrequency(days);
      writeBackupMeta({ automatic: setting.automatic, frequencyDays: Number(setting.frequency_days || 7) });
      backupModal();
      window.AldeckotMessage.show(`Backup automático ajustado para cada ${days} ${days === 1 ? 'dia' : 'dias'}.`);
    } catch (error) {
      input.disabled = false;
      window.AldeckotMessage.show(error?.message || 'Não foi possível atualizar a frequência do backup.');
    }
  }

  async function openInventorySafely() {
    try {
      if (!initialized) renderConnectionState(`Conectando ao ${moduleConfig.name}`, 'Preparando seus dados com segurança…');
      if (!controlMode && !fluxMode && !initialized) {
        const result = await (await backend().init()).client.from('equipment_sync_events').select('id').limit(1);
        inventoryIntegrationReady = !result.error && Array.isArray(result.data);
        statuses[3] = inventoryIntegrationReady ? 'Inativo' : 'Troca';
      }
      const globalVisible = !controlMode && !fluxMode && !state.active
        && Boolean(document.querySelector('.inventory-global-workspace'));
      const categoriesBefore = globalVisible
        ? JSON.stringify(data.tables.map(table => [table.id, table.name, table.icon])) : '';
      if (await reloadInventory()) {
        const categoriesAfter = JSON.stringify(data.tables.map(table => [table.id, table.name, table.icon]));
        if (globalVisible && !state.active && categoriesBefore === categoriesAfter) {
          renderGlobalTable();
          const charts = document.querySelector('.inventory-global-charts');
          if (charts) charts.innerHTML = inventoryHomeSidebar();
        } else renderInventory();
        if (controlMode && !state.active) void refreshControlOperational();
      }
    }
    catch (error) {
      console.error(error);
      if (initialized && document.querySelector('.inventory-shell')) {
        window.AldeckotMessage?.show?.(`Não foi possível atualizar agora: ${backendMessage(error)}`);
      } else renderConnectionState(`${moduleConfig.name} indisponível`, backendMessage(error), true);
    }
  }
  let realtimeRefreshTimer;
  const realtimeTables = controlMode
    ? ['module_tables', 'inventory_items', 'module_records', 'control_items', 'control_item_logs', 'control_cases',
      'control_case_transitions', 'control_backups', 'control_backup_settings']
    : fluxMode
      ? ['module_tables', 'flux_items', 'flux_item_logs', 'flux_backups', 'flux_backup_settings']
      : ['module_tables', 'inventory_items', 'inventory_item_logs', 'inventory_branches', 'inventory_backups', 'inventory_backup_settings'];
  window.addEventListener('aldeckot:realtime-change', event => {
    if (!controlMode && !fluxMode && event.detail?.table === 'module_records') {
      void refreshInstallationDetail(
        document.querySelector('.inv-equipment-detail-dialog')?.closest('.inv-modal'));
      return;
    }
    if (!controlMode && !fluxMode && ['supplies', 'supply_variants'].includes(event.detail?.table)) {
      sharedImagesLoadedAt = 0;
      signedImageUrls.clear();
      void applySharedImages();
      return;
    }
    if (!realtimeTables.includes(event.detail?.table)) return;
    if (event.detail.table.includes('backup')) backupMetaLoadedAt = 0;
    window.clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = window.setTimeout(() => openInventorySafely(), 180);
  });
  window.openInventory = openInventorySafely;
  window.AldeckotInventoryOpenDetails = async ({ id, tableId } = {}) => {
    if (!controlMode && !fluxMode && tableId && (!data.tables.find(entry => entry.id === tableId)?.itemsLoaded)) {
      state.active = tableId;
      if (!await reloadInventory()) return;
    }
    const table = data.tables.find(entry => entry.id === tableId) || data.tables.find(entry => entry.items?.some(item => item.id === id));
    let item = table?.items?.find(entry => entry.id === id);
    if (!item && table && !controlMode && !fluxMode) {
      state.active = table.id;
      try { item = (await ensureFullActiveTable())?.items.find(entry => entry.id === id); }
      catch (error) { window.AldeckotMessage.show(backendMessage(error)); return; }
    }
    if (!table || !item) return;
    state.active = table.id;
    state.sidebarOpen = false;
    state.query = '';
    state.status = '';
    state.situation = '';
    renderInventory();
    details(item);
  };
  async function selectModuleTable(id, direction) {
    if (state.active === id || !data.tables.some(table => table.id === id)) return;
    if (controlMode || fluxMode) {
      Object.assign(state, { active: id, page: 1, tableActionMenu: false,
        tableMenu: null, tableMenuPosition: null });
    } else {
      const filters = document.querySelector('.module-table-filters');
      filters?.setAttribute('aria-busy', 'true');
      if (filters) filters.inert = true;
      window.clearTimeout(categorySearchTimer);
      ++categoryRequestSequence;
      try {
        if (!await reloadInventory(id)) return;
      } catch (error) {
        window.AldeckotMessage.show(backendMessage(error));
        return;
      } finally {
        if (filters) {
          filters.inert = false;
          filters.removeAttribute('aria-busy');
          filters.querySelector('[data-module-table-select]').value = state.active || '';
        }
      }
    }
    renderInventory();
    const nextStep = direction && document.querySelector(`[data-module-table-step="${direction}"]:enabled`);
    (nextStep || document.querySelector('[data-module-table-select]'))?.focus({ preventScroll: true });
  }
  document.querySelectorAll('#nav button').forEach(button => {
    if (button.textContent.includes('Inventário')) button.onclick = openInventorySafely;
  });
  window.addEventListener('click', event => {
    const button = event.target.closest && event.target.closest('#nav button');
    if (button && button.textContent.includes('Inventário')) { event.preventDefault(); event.stopImmediatePropagation(); openInventorySafely(); }
  }, true);
  document.addEventListener('keydown', event => {
    if (!fluxMode || !['Enter', ' '].includes(event.key)) return;
    const card = event.target.closest('.flux-card[role="button"]');
    if (!card) return;
    event.preventDefault();
    card.click();
  });

  document.addEventListener('click', async event => {
    const inventoryHomeAction = event.target.closest('[data-inv-home-action]');
    if (inventoryHomeAction) {
      const type = inventoryHomeAction.dataset.invHomeAction;
      if (type === 'search') document.querySelector('[data-inv-global-search]')?.focus();
      else if (type === 'category') document.querySelector('[data-module-home-table-select]')?.focus();
      else document.querySelector(`.inventory-header [data-inv-action="${type}"]`)?.click();
      return;
    }
    const controlHomeAction = event.target.closest('[data-control-home-action]');
    if (controlHomeAction) {
      const type = controlHomeAction.dataset.controlHomeAction;
      if (type === 'refresh') void refreshControlOperational();
      else document.querySelector(`[data-control-tab="${type}"]`)?.click();
      return;
    }
    const nav = event.target.closest('#nav button');
    if (nav?.textContent.includes('Inventário')) { event.preventDefault(); event.stopImmediatePropagation(); openInventorySafely(); return; }
    const tableStep = event.target.closest('[data-module-table-step]:enabled');
    if (tableStep) {
      void selectModuleTable(tableStep.dataset.tableId, tableStep.dataset.moduleTableStep);
      return;
    }
    if (controlMode) {
      const detailTab = event.target.closest('[data-control-case-tab]');
      if (detailTab) {
        renderControlCaseDetail(detailTab.closest('.inv-modal'), detailTab.dataset.controlCaseTab);
        return;
      }
      const openCase = event.target.closest('[data-control-open-case]');
      if (openCase) {
        const itemId = openCase.closest('.inv-modal')?.dataset.itemId;
        const item = activeTable()?.items.find(entry => entry.id === itemId);
        if (item) void showControlCaseDetail(item, openCase.dataset.controlOpenCase);
        return;
      }
    }
    if (controlMode && !state.active) {
      const tab = event.target.closest('[data-control-tab]');
      if (tab) {
        window.clearTimeout(controlOperationalSearchTimer);
        controlOperational.tab = tab.dataset.controlTab;
        controlOperational.page = 1;
        controlOperational.listing = null;
        if (controlOperational.tab === 'reports') controlOperational.report = null;
        void refreshControlOperational();
        return;
      }
      if (event.target.closest('[data-control-export-csv]')) {
        downloadControlReportCsv();
        return;
      }
      if (event.target.closest('[data-control-export-pdf]')) {
        printControlReport();
        return;
      }
      const printCase = event.target.closest('[data-report-print-id]');
      if (printCase) { printControlReport(printCase.dataset.reportPrintId); return; }
      const page = event.target.closest('[data-control-page]');
      if (page && !page.disabled) {
        controlOperational.page = Number(page.dataset.controlPage);
        void refreshControlOperational();
        return;
      }
      if (event.target.closest('[data-control-refresh]')) {
        void refreshControlOperational();
        return;
      }
    }
    const moduleHomeButton = event.target.closest('[data-inv-module-home]');
    if (moduleHomeButton && (controlMode || fluxMode)) {
      await showModuleHome();
      return;
    }
    if (fluxMode && event.target.closest('[data-inv-module-all]')) {
      globalState.view = 'all';
      globalState.page = 1;
      renderModuleHomeRows();
      return;
    }
    const modulePage = event.target.closest('[data-inv-module-page]');
    if (modulePage && !modulePage.disabled && (controlMode || fluxMode)) {
      globalState.page = Number(modulePage.dataset.invModulePage);
      renderModuleHomeRows(); return;
    }
    const globalPage = event.target.closest('[data-inv-global-page]');
    if (globalPage && !globalPage.disabled) {
      globalState.page = Number(globalPage.dataset.invGlobalPage);
      void refreshGlobalPage();
      return;
    }
    if (event.target.closest('[data-inv-global-home]')) {
      await showModuleHome();
      return;
    }
    const branchCard = event.target.closest('[data-inv-branch]');
    if (branchCard) { state.branchId = branchCard.dataset.invBranch; state.page = 1; state.query = ''; state.status = ''; state.situation = ''; state.addMenu = false; void refreshCategoryPage(); return; }
    if (event.target.closest('[data-inv-branch-home]')) { state.branchId = null; state.page = 1; state.query = ''; state.status = ''; state.situation = ''; state.addMenu = false; void refreshCategoryPage(); return; }
    const recent = event.target.closest('[data-inv-recent]');
    if (recent) { const item = activeTable()?.items.find(row => row.id === recent.dataset.invRecent); if (item) details(item); return; }
    const editBranch = event.target.closest('[data-inv-branch-edit]');
    if (editBranch && canManage()) { branchForm(activeTable()?.branches.find(row => row.id === editBranch.dataset.invBranchEdit)); return; }
    const deleteBranch = event.target.closest('[data-inv-branch-delete]');
    if (deleteBranch && canManage()) {
      let table;
      try { table = await ensureFullActiveTable(); }
      catch (error) { window.AldeckotMessage.show(backendMessage(error)); return; }
      const id = deleteBranch.dataset.invBranchDelete;
      const count = table.items.filter(item => branchModel.inBranch(table, item, id)).length;
      if (count) { window.AldeckotMessage.show(`Realocar os ${count} equipamentos desta ramificação antes de excluí-la.`); return; }
      if (await window.AldeckotMessage.confirm('Excluir esta ramificação vazia?', { title: 'Excluir ramificação', confirmText: 'Excluir' })) {
        try { await moduleApi().deleteBranch(id); state.branchId = null; await reloadInventory(); renderInventory(); }
        catch (error) { window.AldeckotMessage.show(backendMessage(error)); }
      }
      return;
    }
    const pageButton = event.target.closest('[data-inv-page]');
    if (pageButton && !pageButton.disabled) {
      state.page = Number(pageButton.dataset.invPage);
      if (!controlMode && !fluxMode) void refreshCategoryPage();
      else applyInventoryFilters();
      return;
    }
    if (!event.target.closest('.inventory-table-action-menu-wrap') && state.tableActionMenu) {
      state.tableActionMenu = false; renderInventory(); return;
    }
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
    const chosen = event.target.closest('[data-inv-table]');
    if (chosen && !event.target.closest('[data-inv-edit-table],[data-inv-delete-table],[data-inv-table-menu]')) {
      const previousTable = state.active;
      const previousSidebarOpen = state.sidebarOpen;
      state.active = chosen.dataset.invTable;
      state.branchId = null; state.addMenu = false; state.query = '';
      state.status = ''; state.situation = ''; state.page = 1;
      state.sidebarOpen = false;
      state.tableMenu = null; state.tableMenuPosition = null; state.tableActionMenu = false;
      try { if (await reloadInventory()) renderInventory(); }
      catch (error) {
        state.active = previousTable; state.sidebarOpen = previousSidebarOpen;
        window.AldeckotMessage.show(backendMessage(error));
      }
      return;
    }
    const editTable = event.target.closest('[data-inv-edit-table]'); if (editTable) { event.stopPropagation(); state.tableMenu = null; state.tableMenuPosition = null; document.querySelector('.inventory-table-actions-popover')?.remove(); tableForm(data.tables.find(table => table.id === editTable.dataset.invEditTable)); return; }
    const deleteTable = event.target.closest('[data-inv-delete-table]'); if (deleteTable) {
      state.tableMenu = null; state.tableMenuPosition = null; document.querySelector('.inventory-table-actions-popover')?.remove();
      if (await window.AldeckotMessage.confirm('Excluir esta tabela e todos os seus itens?', { title: 'Excluir tabela', confirmText: 'Excluir' })) {
        moduleApi().deleteTable(deleteTable.dataset.invDeleteTable).then(async () => {
          if (state.active === deleteTable.dataset.invDeleteTable) {
            state.active = null;
            state.sidebarOpen = true;
          }
          await reloadInventory(); closeModal(); renderInventory();
        }).catch(error => window.AldeckotMessage.show(backendMessage(error)));
      }
      return;
    }
    const action = event.target.closest('[data-inv-action]');
    if (action) {
      const type = action.dataset.invAction;
      const restrictedActions = new Set(['add-table', 'add-item', 'toggle-add-menu', 'new-equipment', 'new-branch', 'toggle-active-table-actions', 'edit-active-table', 'delete-active-table', 'toggle-item-actions', 'add-log', 'edit-log', 'delete-log', 'backup', 'create-backup', 'restore-backup', 'backup-local-create', 'backup-local-restore', 'backup-network-create', 'backup-network-restore', 'prepare-network-restore', 'confirm-backup-restore', 'toggle-auto-backup', 'flux-new-send', 'flux-return', 'flux-delivery', 'flux-replace']);
      if (restrictedActions.has(type) && !canManage()) { event.preventDefault(); return; }
      if (controlMode && type === 'control-report') { controlReportForm(); return; }
      if (controlMode && canManage() && ['control-part', 'control-preventive'].includes(type)) {
        controlActivityForm(type === 'control-part' ? 'part' : 'preventive');
        return;
      }
      if (fluxMode && type === 'flux-new-send') { itemForm(); return; }
      if (fluxMode && type === 'flux-delivery') { fluxDeliveryWizard(); return; }
      if (fluxMode && type === 'flux-return') { fluxReturnWizard(); return; }
      if (fluxMode && type === 'flux-history') { fluxHistoryModal(); return; }
      if (fluxMode && type === 'flux-replace') {
        try {
          await window.AldeckotLocalRegularization.open({
            onSaved: async () => { await reloadInventory(); renderInventory(); }
          });
        } catch (error) { window.AldeckotMessage.show(backendMessage(error)); }
        return;
      }
      if (type === 'toggle-tables') { state.sidebarOpen = !state.sidebarOpen; state.tableMenu = null; state.tableMenuPosition = null; renderInventory(); }
      if (type === 'add-table') tableForm();
      if (type === 'add-item') itemForm();
      if (type === 'simulate-branches') { try { await showClassificationSimulation(); } catch (error) { window.AldeckotMessage.show(backendMessage(error)); } return; }
      if (type === 'download-branch-report' && currentSimulationReport) { download(JSON.stringify(currentSimulationReport, null, 2), 'aldeckot-simulacao-ramificacoes.json', 'application/json'); return; }
      if (type === 'toggle-add-menu') { state.addMenu = !state.addMenu; renderBranchView(); return; }
      if (type === 'new-equipment') { state.addMenu = false; itemForm(); return; }
      if (type === 'new-branch') { state.addMenu = false; branchForm(); return; }
      if (type === 'toggle-active-table-actions') { state.tableActionMenu = !state.tableActionMenu; renderInventory(); return; }
      if (type === 'edit-active-table') { state.tableActionMenu = false; tableForm(activeTable()); return; }
      if (type === 'delete-active-table') {
        state.tableActionMenu = false;
        const table = activeTable();
        if (table && await window.AldeckotMessage.confirm(`Excluir a tabela “${table.name}” e todos os seus itens?`, { title: 'Excluir tabela', confirmText: 'Excluir' })) {
          moduleApi().deleteTable(table.id).then(async () => {
            state.active = null;
            state.sidebarOpen = true;
            await reloadInventory(); renderInventory();
          }).catch(error => window.AldeckotMessage.show(backendMessage(error)));
        }
        return;
      }
      if (type === 'toggle-item-actions') {
        const item = activeTable()?.items.find(entry => entry.id === document.querySelector('.inv-modal')?.dataset.itemId);
        state.itemActionMenu = !state.itemActionMenu;
        if (item) details(item);
        return;
      }
      if (type === 'add-log') { const item = activeTable()?.items.find(entry => entry.id === action.dataset.invLogItem); if (item) { closeModal(); logForm(item); } }
      if (type === 'edit-log') {
        const item = activeTable()?.items.find(entry => entry.id === action.dataset.invLogItem);
        const logEntry = item?.logs?.find(entry => entry.id === action.dataset.invLogId);
        if (logEntry?.eventId) { window.AldeckotMessage.show('Registros automáticos de movimentação não podem ser editados.'); return; }
        if (item && logEntry) { closeModal(); logForm(item, logEntry); }
      }
      if (type === 'delete-log') {
        const itemId = action.dataset.invLogItem;
        const item = activeTable()?.items.find(entry => entry.id === itemId);
        const logEntry = item?.logs?.find(entry => entry.id === action.dataset.invLogId);
        if (!logEntry) return;
        if (logEntry.eventId) { window.AldeckotMessage.show('Registros automáticos de movimentação não podem ser excluídos.'); return; }
        if (await window.AldeckotMessage.confirm('Excluir este registro do histórico?', { title: 'Excluir registro', confirmText: 'Excluir' })) {
          (async () => {
            await moduleApi().deleteLog(logEntry.id);
            if (!controlMode && logEntry.sourceModule === 'control' && logEntry.sourceLogId) {
              await window.AldeckotSupabase.control.deleteLog(logEntry.sourceLogId);
            }
            await reloadInventory(); closeModal(); const item = activeTable()?.items.find(entry => entry.id === itemId); if (item) details(item);
          })().catch(error => window.AldeckotMessage.show(backendMessage(error)));
        }
      }
      if (type === 'export-pdf') {
        if (controlMode) showControlPdf();
        else if (!fluxMode && activeTable()) {
          const popup = window.open('', '_blank', 'width=1280,height=860');
          if (!popup) { window.AldeckotMessage.show('Permita a abertura da janela de impressão para gerar o PDF.'); return; }
          try { await ensureFullActiveTable(); exportPdf(popup); }
          catch (error) { popup.close(); window.AldeckotMessage.show(backendMessage(error)); }
        } else exportPdf();
      }
      if (type === 'backup') {
        backupModal();
        if (backupMeta.availability === 'unavailable') backupMetaLoadedAt = 0;
        void refreshModuleBackupMeta();
      }
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
      if (type === 'retry') openInventorySafely();
      if (type === 'home') {
        if (window.AldeckotRoute?.goHome) window.AldeckotRoute.goHome();
        else window.location.href = 'index.html';
      }
      return;
    }
    const row = event.target.closest('[data-inv-item]'); if (row) {
      state.itemActionMenu = false;
      if (!state.active && (controlMode || fluxMode)) {
        const table = data.tables.find(entry => entry.id === row.dataset.invTableId);
        const item = table?.items.find(entry => entry.id === row.dataset.invItem);
        if (!item) return;
        state.active = table.id; state.sidebarOpen = false;
        renderInventory(); details(item);
      } else if (!state.active && !controlMode && !fluxMode) {
        const found = (globalState.result?.items || []).find(item => item.id === row.dataset.invItem);
        if (!found) return;
        state.active = found.table_id;
        state.sidebarOpen = false;
        try {
          if (!await reloadInventory()) return;
          await ensureFullActiveTable();
          const item = activeTable()?.items.find(entry => entry.id === found.id);
          state.branchId = item ? branchModel.branchFor(activeTable(), item)?.id || null : null;
          renderInventory();
          if (item) details(item);
          else window.AldeckotMessage.show('O equipamento mudou. Atualize a consulta e tente novamente.');
        } catch (error) { state.active = null; state.sidebarOpen = true; window.AldeckotMessage.show(backendMessage(error)); }
      } else {
        const item = activeTable()?.items.find(entry => entry.id === row.dataset.invItem);
        if (item) details(item);
      }
      return;
    }
    if (event.target.closest('[data-inv-close]')) { closeModal(); return; }
    const acquisition = event.target.closest('[data-inv-flux-acquisition]');
    if (acquisition && fluxMode && canManage()) {
      const item = activeTable()?.items.find(entry => entry.id === acquisition.dataset.invFluxAcquisition);
      if (item) await fluxAcquisitionWizard(item);
      return;
    }
    const reversal = event.target.closest('[data-inv-flux-reversal]');
    if (reversal && fluxMode && canManage()) {
      const item = activeTable()?.items.find(entry => entry.id === reversal.dataset.invFluxReversal);
      if (item) {
        try { await fluxReversalWizard(item); }
        catch (error) { window.AldeckotMessage.show(backendMessage(error)); }
      }
      return;
    }
    const promotion = event.target.closest('[data-inv-promote-verification]');
    if (promotion && controlMode && canManage()) {
      const item = activeTable()?.items.find(entry => entry.id === promotion.dataset.invPromoteVerification);
      if (item) promotionForm(item);
      return;
    }
    const manageShares = event.target.closest('[data-inv-manage-shares]');
    if (manageShares && canManage()) {
      shareDialog(activeTable()?.items.find(item => item.id === manageShares.dataset.invManageShares));
      return;
    }
    const shareAction = event.target.closest('[data-inv-share-add],[data-inv-share-remove]');
    if (shareAction && canManage()) {
      const itemId = shareAction.dataset.invShareItem;
      const branchId = shareAction.dataset.invShareAdd || shareAction.dataset.invShareRemove;
      shareAction.disabled = true;
      try {
        if (shareAction.hasAttribute('data-inv-share-add')) await moduleApi().shareAdd(itemId, branchId);
        else await moduleApi().shareRemove(itemId, branchId);
        if (await reloadInventory()) {
          renderInventory();
          shareDialog(activeTable()?.items.find(item => item.id === itemId));
        }
      } catch (error) {
        shareAction.disabled = false;
        window.AldeckotMessage.show(backendMessage(error));
      }
      return;
    }
    const editItem = event.target.closest('[data-inv-edit-item]'); if (editItem) { if (!canManage()) return; const item = activeTable().items.find(entry => entry.id === editItem.dataset.invEditItem); closeModal(); itemForm(item); return; }
    const transferItem = event.target.closest('[data-inv-transfer-item]');
    if (transferItem && canManage() && !controlMode && !fluxMode) {
      try { const table = await ensureFullActiveTable(); const item = table?.items.find(row => row.id === transferItem.dataset.invTransferItem); if (item) { closeModal(); transferForm(item); } }
      catch (error) { window.AldeckotMessage.show(backendMessage(error)); }
      return;
    }
    const replaceItem = event.target.closest('[data-inv-replace-item]');
    if (replaceItem) {
      if (!canManage()) return;
      try { const table = await ensureFullActiveTable(); const item = table?.items.find(entry => entry.id === replaceItem.dataset.invReplaceItem); if (item) replaceEquipmentForm(item); }
      catch (error) { window.AldeckotMessage.show(backendMessage(error)); }
      return;
    }
    const deleteItem = event.target.closest('[data-inv-delete-item]');
    if (deleteItem && canManage()) {
      const confirmed = await window.AldeckotMessage.confirm('Excluir este equipamento?', { title: 'Excluir equipamento', confirmText: 'Excluir' });
      if (confirmed) moduleApi().deleteItem(deleteItem.dataset.invDeleteItem).then(async () => { await reloadInventory(); closeModal(); renderInventory(); }).catch(error => window.AldeckotMessage.show(backendMessage(error)));
    }
  }, true);
  document.addEventListener('input', event => {
    if (controlMode && event.target.matches('[data-control-query]')) {
      controlOperational.query = event.target.value.slice(0, 100);
      controlOperational.page = 1;
      window.clearTimeout(controlOperationalSearchTimer);
      controlOperationalSearchTimer = window.setTimeout(() => {
        controlOperational.listing = null;
        void refreshControlOperational();
      }, 260);
      return;
    }
    if (event.target.matches('[data-inv-module-search]') && (controlMode || fluxMode)) {
      globalState.query = event.target.value.slice(0, 100);
      globalState.page = 1;
      renderModuleHomeRows();
      return;
    }
    if (event.target.matches('[data-inv-global-search]')) {
      globalState.query = event.target.value.slice(0, 100);
      globalState.page = 1;
      window.clearTimeout(globalSearchTimer);
      globalSearchTimer = window.setTimeout(() => { void refreshGlobalPage(); }, 260);
      return;
    }
    if (event.target.matches('[data-inv-search]')) {
      state.query = event.target.value; state.page = 1;
      if (!controlMode && !fluxMode) {
        ++categoryRequestSequence;
        window.clearTimeout(categorySearchTimer);
        categorySearchTimer = window.setTimeout(() => { void refreshCategoryPage(); }, 260);
      } else applyInventoryFilters();
    }
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-inv-replacement-select]')) {
      updateReplacementPreview(event.target.closest('.inv-modal'),event.target.value);
      return;
    }
    if (controlMode && event.target.matches('[data-report-filter]')) {
      const key = event.target.dataset.reportFilter;
      controlOperational.reportFilters[key] = event.target.value.trim();
      controlOperational.report = null;
      void refreshControlOperational();
      return;
    }
    if (controlMode && event.target.matches('[data-control-state], [data-control-priority], [data-control-page-size]')) {
      if (event.target.matches('[data-control-state]')) controlOperational.status = event.target.value;
      if (event.target.matches('[data-control-priority]')) controlOperational.priority = event.target.value;
      if (event.target.matches('[data-control-page-size]')) {
        const size = Number(event.target.value);
        if (!pageSizes.includes(size)) return;
        controlOperational.pageSize = size;
      }
      controlOperational.page = 1;
      controlOperational.listing = null;
      void refreshControlOperational();
      return;
    }
    const globalFields = {
      '[data-inv-global-category]': 'category', '[data-inv-global-status]': 'status',
      '[data-inv-global-situation]': 'situation', '[data-inv-global-order]': 'order'
    };
    for (const [selector, key] of Object.entries(globalFields)) {
      if (event.target.matches(selector)) {
        globalState[key] = event.target.value;
        globalState.page = 1;
        void refreshGlobalPage();
        return;
      }
    }
    if (event.target.matches('[data-inv-page-size]')) {
      const size = Number(event.target.value);
      if (!pageSizes.includes(size)) return;
      state.pageSize = size;
      state.page = 1;
      try { window.localStorage.setItem(pageSizeKey, String(size)); } catch { /* A preferência não impede a navegação. */ }
      if (!controlMode && !fluxMode) void refreshCategoryPage();
      else applyInventoryFilters();
      return;
    }
    if (event.target.matches('[data-module-table-select]')) {
      void selectModuleTable(event.target.value);
      return;
    }
    if (event.target.matches('[data-module-home-table-select]')) {
      if (event.target.value) void selectModuleTable(event.target.value);
      return;
    }
    if (event.target.matches('[data-inv-status-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('status', event.target.value));
    if (event.target.matches('[data-inv-situation-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('situation', event.target.value));
    if (event.target.matches('[data-inv-cleaning-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('cleaning', event.target.value));
    if (event.target.matches('[data-inv-priority-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('priority', event.target.value));
    if (event.target.matches('[data-inv-movement-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('movement', event.target.value));
    if (event.target.matches('[data-inv-shipping-choice]')) event.target.closest('[data-inv-choice-field]')?.setAttribute('data-tone', choiceTone('shipping', event.target.value));
    if (event.target.matches('[data-inv-status]')) { state.status = event.target.value; state.operation = ''; state.page = 1; if (!controlMode && !fluxMode) void refreshCategoryPage(); else applyInventoryFilters(); }
    if (event.target.matches('[data-inv-situation]')) { state.situation = event.target.value; state.operation = ''; state.page = 1; if (!controlMode && !fluxMode) void refreshCategoryPage(); else applyInventoryFilters(); }
  });
  document.addEventListener('change', event => {
    if (event.target.matches('[data-inv-backup-frequency]')) updateBackupFrequency(event.target);
  });
  document.addEventListener('submit', event => {
    if (event.target.matches('[data-control-case-resolution]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form=event.target,node=form.closest('.inv-modal');
      if (!node?.dataset.caseId || form.dataset.busy==='true'
        || ['Resolvido','Concluído','Cancelado'].includes(node.__caseDetail?.case?.ticket_state)) return;
      const values=new FormData(form);
      const payload=Object.fromEntries(['finalDiagnosis','solution','tests','failureCategory','finalCondition','observations']
        .map(key=>[key,String(values.get(key)||'').trim()]));
      if (payload.finalDiagnosis.length<3 || payload.solution.length<3 || payload.tests.length<3
        || !window.AldeckotControlCaseDetail?.failureCategories?.includes(payload.failureCategory)
        || (node.__caseDetail?.case?.source_module==='inventory'
          && !['Ativo','Reserva'].includes(payload.finalCondition))) {
        window.AldeckotMessage.show('Preencha diagnóstico, solução, testes, categoria e confirme Ativo ou Reserva para equipamento do Inventário.');
        return;
      }
      const fingerprint=JSON.stringify(payload);
      if (form.dataset.payload!==fingerprint) {
        form.dataset.requestId=crypto.randomUUID();
        form.dataset.payload=fingerprint;
      }
      form.dataset.busy='true';
      const submit=form.querySelector('[type="submit"]');
      submit.disabled=true;
      moduleApi().resolveCase(node.dataset.caseId,payload,form.dataset.requestId)
        .then(()=>moduleApi().caseDetail(node.dataset.caseId))
        .then(detail=>{
          if (!node.isConnected) return;
          node.__caseDetail=detail;
          renderControlCaseDetail(node,'overview');
          const notice=document.createElement('p');
          notice.className='control-case-success';
          notice.setAttribute('role','status');
          notice.textContent='Resolução registrada e chamado marcado como Resolvido. O status do equipamento não foi alterado; a categoria técnica ficará disponível para comparação de reincidência.';
          node.querySelector('.control-case-detail > header')?.after(notice);
          if (!state.active) void refreshControlOperational();
        }).catch(error=>window.AldeckotMessage.show(backendMessage(error)))
        .finally(()=>{delete form.dataset.busy;if(submit.isConnected)submit.disabled=false;});
      return;
    }
    if (event.target.matches('[data-control-case-reopen]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form=event.target,node=form.closest('.inv-modal');
      if (!node?.dataset.caseId || node.__caseDetail?.case?.ticket_state!=='Resolvido'
        || form.dataset.busy==='true') return;
      const reason=String(new FormData(form).get('reason') || '').trim();
      if (reason.length<3 || reason.length>2000) {
        window.AldeckotMessage.show('Informe o motivo da reabertura (3 a 2000 caracteres).');
        return;
      }
      if (form.dataset.payload!==reason) {
        form.dataset.requestId=crypto.randomUUID();
        form.dataset.payload=reason;
      }
      form.dataset.busy='true';
      const submit=form.querySelector('[type=\"submit\"]');
      submit.disabled=true;
      moduleApi().reopenCase(node.dataset.caseId,reason,form.dataset.requestId)
        .then(()=>moduleApi().caseDetail(node.dataset.caseId))
        .then(detail=>{
          if (!node.isConnected) return;
          node.__caseDetail=detail;
          renderControlCaseDetail(node,'overview');
          const notice=document.createElement('p');
          notice.className='control-case-success';
          notice.setAttribute('role','status');
          notice.textContent='Chamado reaberto para diagnóstico. A solução anterior permanece no histórico.';
          node.querySelector('.control-case-detail > header')?.after(notice);
          if (!state.active) void refreshControlOperational();
        }).catch(error=>window.AldeckotMessage.show(backendMessage(error)))
        .finally(()=>{delete form.dataset.busy;if(submit.isConnected)submit.disabled=false;});
      return;
    }
    if (event.target.matches('[data-control-case-priority]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form=event.target,node=form.closest('.inv-modal');
      if (!node?.dataset.caseId || form.dataset.busy==='true') return;
      const priority=String(new FormData(form).get('priority') || '');
      if (!['Baixa','Média','Alta','Crítica'].includes(priority)) {
        window.AldeckotMessage.show('Selecione uma prioridade válida.');
        return;
      }
      if (form.dataset.payload!==priority) {
        form.dataset.requestId=crypto.randomUUID();
        form.dataset.payload=priority;
      }
      form.dataset.busy='true';
      const submit=form.querySelector('[type=\"submit\"]');
      submit.disabled=true;
      moduleApi().setCasePriority(node.dataset.caseId,priority,form.dataset.requestId)
        .then(()=>moduleApi().caseDetail(node.dataset.caseId))
        .then(detail=>{
          if (!node.isConnected) return;
          node.__caseDetail=detail;
          renderControlCaseDetail(node,'overview');
          const notice=document.createElement('p');
          notice.className='control-case-success';
          notice.setAttribute('role','status');
          notice.textContent='Prioridade atualizada e registrada no histórico.';
          node.querySelector('.control-case-detail > header')?.after(notice);
          if (!state.active) void refreshControlOperational();
        }).catch(error=>window.AldeckotMessage.show(backendMessage(error)))
        .finally(()=>{delete form.dataset.busy;if(submit.isConnected)submit.disabled=false;});
      return;
    }
    if (event.target.matches('[data-control-task-create],[data-control-task-update]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form=event.target, node=form.closest('.inv-modal');
      if (!node?.dataset.caseId || !node.__caseDetail?.tasksAvailable
        || form.dataset.busy==='true') return;
      const values=new FormData(form);
      const dueText=String(values.get('dueAt') || '');
      const dueAt=dueText ? new Date(dueText) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) {
        window.AldeckotMessage.show('Informe um prazo válido.');
        return;
      }
      const payload={
        description:String(values.get('description') || '').trim(),
        priority:String(values.get('priority') || 'Média'),
        dueAt:dueAt?.toISOString() || null,
        notes:String(values.get('notes') || '').trim()
      };
      const update=form.matches('[data-control-task-update]');
      if (update) Object.assign(payload,{
        state:String(values.get('state') || ''),
        completionNote:String(values.get('completionNote') || '').trim(),
        revision:Number(values.get('revision'))
      });
      if (payload.description.length<3
        || (update && payload.state==='Concluída' && payload.completionNote.length<3)) {
        window.AldeckotMessage.show('Revise a descrição, o prazo e a conclusão da pendência.');
        return;
      }
      const signature=JSON.stringify(payload);
      if (form.dataset.payload!==signature) {
        form.dataset.requestId=crypto.randomUUID();
        form.dataset.payload=signature;
      }
      form.dataset.busy='true';
      const submit=form.querySelector('[type="submit"]');
      submit.disabled=true;
      const action=update
        ? moduleApi().updateCaseTask(form.dataset.taskId,payload,form.dataset.requestId)
        : moduleApi().createCaseTask(node.dataset.caseId,payload,form.dataset.requestId);
      action.then(()=>moduleApi().caseDetail(node.dataset.caseId)).then(detail=>{
        if (!node.isConnected) return;
        node.__caseDetail=detail;
        renderControlCaseDetail(node,'pending');
        const notice=document.createElement('p');
        notice.className='control-case-success';
        notice.setAttribute('role','status');
        notice.textContent=update?'Pendência atualizada com histórico preservado.':'Pendência criada neste chamado.';
        node.querySelector('.control-case-detail > header')?.after(notice);
        if (!state.active) void refreshControlOperational();
      }).catch(error=>window.AldeckotMessage.show(backendMessage(error)))
        .finally(()=>{delete form.dataset.busy;if(submit.isConnected)submit.disabled=false;});
      return;
    }
    if (event.target.matches('[data-control-case-close]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form=event.target,node=form.closest('.inv-modal');
      if (!node?.dataset.caseId || !node.__caseDetail?.tasksAvailable
        || form.dataset.busy==='true') return;
      const open=(node.__caseDetail.tasks || []).filter(t=>
        ['Pendente','Em andamento'].includes(t.task_state));
      const reason=String(new FormData(form).get('reason') || '').trim();
      const keepOpen=Boolean(new FormData(form).get('keepOpen'));
      if (reason.length<3 || (open.length && !keepOpen)) {
        window.AldeckotMessage.show('Revise as pendências e confirme sua decisão.');
        return;
      }
      const ids=open.map(t=>t.id).sort();
      const decision=open.length?'Manter abertas':null;
      const signature=JSON.stringify({reason,ids,decision});
      if (form.dataset.payload!==signature) {
        form.dataset.requestId=crypto.randomUUID();
        form.dataset.payload=signature;
      }
      form.dataset.busy='true';
      const submit=form.querySelector('[type="submit"]');
      submit.disabled=true;
      moduleApi().closeCaseWithTasks(node.dataset.caseId,reason,
        form.dataset.requestId,ids,decision)
        .then(()=>moduleApi().caseDetail(node.dataset.caseId))
        .then(detail=>{
          if (!node.isConnected) return;
          node.__caseDetail=detail;
          renderControlCaseDetail(node,'overview');
          const notice=document.createElement('p');
          notice.className='control-case-success';
          notice.setAttribute('role','status');
          notice.textContent='Chamado concluído. Pendências abertas foram preservadas.';
          node.querySelector('.control-case-detail > header')?.after(notice);
          if (!state.active) void refreshControlOperational();
        }).catch(error=>window.AldeckotMessage.show(backendMessage(error)))
        .finally(()=>{delete form.dataset.busy;if(submit.isConnected)submit.disabled=false;});
      return;
    }
    if (event.target.matches('[data-control-component-form]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form=event.target,node=form.closest('.inv-modal');
      if (!node?.dataset.caseId || !node.__caseDetail?.componentsAvailable
        || form.dataset.busy==='true') return;
      const values=new FormData(form);
      const action=String(values.get('action') || '');
      const occurred=new Date(String(values.get('occurredAt') || ''));
      const expectedRaw=String(values.get('expectedReturnAt') || '');
      const expected=expectedRaw ? new Date(expectedRaw) : null;
      const inventoryItemId=String(values.get('inventoryItemId') || '').trim();
      const supplyUnitId=String(values.get('supplyUnitId') || '').trim();
      const replacementSupplyUnitId=String(values.get('replacementSupplyUnitId') || '').trim();
      const stockDestination=String(values.get('stockDestination') || '');
      const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const result=String(values.get('result') || '').trim();
      const supplier=String(values.get('supplier') || '').trim();
      const reason=String(values.get('reason') || '').trim();
      const serviceStatus=String(values.get('serviceStatus') || '');
      if (Number.isNaN(occurred.getTime()) || result.length<3
        || (inventoryItemId && !uuid.test(inventoryItemId))
        || (supplyUnitId && !uuid.test(supplyUnitId))
        || (inventoryItemId && supplyUnitId)
        || (replacementSupplyUnitId && !uuid.test(replacementSupplyUnitId))
        || (inventoryItemId && ['Instalado','Removido','Substituído'].includes(action))
        || (expected && Number.isNaN(expected.getTime()))
        || (['Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor'].includes(action)
          && (!supplier || !reason))
        || (action==='Enviado ao fornecedor' && !expected)
        || (action==='Acompanhamento externo' && !serviceStatus)
        || (action==='Retornado do fornecedor' && (!serviceStatus || serviceStatus!=='Concluído'))) {
        window.AldeckotMessage.show('Revise identidade, resultado e dados obrigatórios do fornecedor.');
        return;
      }
      if ((['Instalado','Removido','Substituído'].includes(action) && supplyUnitId && !reason)
        || (action==='Removido' && supplyUnitId
          && !['Em estoque','Reserva','Defeito','Inativo'].includes(stockDestination))
        || (action==='Substituído' && supplyUnitId
          && (!replacementSupplyUnitId || replacementSupplyUnitId===supplyUnitId
            || !['Em estoque','Reserva','Defeito','Inativo'].includes(stockDestination)))
        || (action!=='Substituído' && replacementSupplyUnitId)
        || (!['Removido','Substituído'].includes(action) && stockDestination)) {
        window.AldeckotMessage.show('Para movimentar uma unidade, informe o motivo e, quando aplicável, a nova unidade e o destino.');
        return;
      }
      const component={
        name:String(values.get('name') || '').trim(),
        brand:String(values.get('brand') || '').trim(),
        model:String(values.get('model') || '').trim(),
        tag:String(values.get('tag') || '').trim(),
        serial:String(values.get('serial') || '').trim(),
        inventoryItemId:inventoryItemId || null,supplyUnitId:supplyUnitId || null
      };
      if (!component.name && !inventoryItemId && !supplyUnitId) {
        window.AldeckotMessage.show('Informe o nome ou vincule um item existente.');
        return;
      }
      const eventPayload={
        action,occurredAt:occurred.toISOString(),result,
        notes:String(values.get('notes') || '').trim(),supplier,reason,
        protocol:String(values.get('protocol') || '').trim(),
        expectedReturnAt:expected ? expected.toISOString() : null,
        replacementSupplyUnitId:replacementSupplyUnitId || null,stockDestination,
        serviceStatus:action==='Enviado ao fornecedor'?'Enviado'
          :action==='Retornado do fornecedor'?'Retornado':serviceStatus
      };
      const signature=JSON.stringify({component,eventPayload});
      if (form.dataset.payload!==signature) {
        form.dataset.requestId=crypto.randomUUID();
        form.dataset.componentRequestId=crypto.randomUUID();
        form.dataset.payload=signature;
      }
      form.dataset.busy='true';
      const submit=form.querySelector('[type="submit"]');
      submit.disabled=true;
      moduleApi().appendCaseComponentEvent(node.dataset.caseId,
        {...component,requestId:form.dataset.componentRequestId},
        eventPayload,form.dataset.requestId)
        .then(()=>moduleApi().caseDetail(node.dataset.caseId))
        .then(detail=>{
          if(!node.isConnected)return;
          node.__caseDetail=detail;
          renderControlCaseDetail(node,'components');
          const notice=document.createElement('p');
          notice.className='control-case-success';notice.setAttribute('role','status');
          notice.textContent=['Instalado','Removido','Substituído'].includes(action) && supplyUnitId
            ? 'Componente salvo; a movimentação de Suprimentos foi validada e registrada oficialmente.'
            : 'Registro salvo no histórico; nenhum estoque ou evento de Flux foi criado implicitamente.';
          node.querySelector('.control-case-detail > header')?.after(notice);
        }).catch(error=>window.AldeckotMessage.show(backendMessage(error)))
        .finally(()=>{delete form.dataset.busy;if(submit.isConnected)submit.disabled=false;});
      return;
    }
    if (event.target.matches('[data-control-intervention-form]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form = event.target;
      const node = form.closest('.inv-modal');
      if (!node?.dataset.caseId || !node.__caseDetail?.interventionsAvailable
        || form.dataset.busy === 'true') return;
      const values = new FormData(form);
      const occurred = new Date(String(values.get('occurredAt') || ''));
      const description = String(values.get('description') || '').trim();
      const result = String(values.get('result') || '').trim();
      if (Number.isNaN(occurred.getTime()) || description.length < 3 || result.length < 3) {
        window.AldeckotMessage.show('Informe data, descrição e resultado da intervenção.');
        return;
      }
      const payload = {
        occurredAt: occurred.toISOString(), type: String(values.get('type') || ''),
        description, result,
        technicalAuthor: String(values.get('technicalAuthor') || '').trim(),
        referenceNote: String(values.get('referenceNote') || '').trim()
      };
      form.dataset.busy = 'true';
      form.dataset.requestId ||= crypto.randomUUID();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      moduleApi().appendCaseIntervention(node.dataset.caseId, payload, form.dataset.requestId)
        .then(() => moduleApi().caseDetail(node.dataset.caseId))
        .then(detail => {
          if (!node.isConnected) return;
          node.__caseDetail = detail;
          renderControlCaseDetail(node, 'interventions');
          const notice = document.createElement('p');
          notice.className = 'control-case-success';
          notice.setAttribute('role', 'status');
          notice.textContent = 'Intervenção registrada sem alterar o estado do chamado.';
          node.querySelector('.control-case-detail > header')?.after(notice);
          if (!state.active) void refreshControlOperational();
        }).catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(() => { delete form.dataset.busy; if (submit.isConnected) submit.disabled = false; });
      return;
    }
    if (event.target.matches('[data-control-diagnostic-form]')) {
      event.preventDefault();
      if (!controlMode || !canManage()) return;
      const form = event.target;
      const node = form.closest('.inv-modal');
      if (!node?.dataset.caseId || form.dataset.busy === 'true') return;
      const values = new FormData(form);
      const payload = Object.fromEntries(
        ['symptom','hypothesis','tests','results','cause','finalDiagnosis']
          .map(key => [key, String(values.get(key) || '').trim()]));
      if (!Object.values(payload).some(Boolean)) {
        window.AldeckotMessage.show('Informe ao menos um campo do diagnóstico.');
        return;
      }
      form.dataset.busy = 'true';
      form.dataset.requestId ||= crypto.randomUUID();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      moduleApi().appendCaseDiagnostic(node.dataset.caseId, payload, form.dataset.requestId)
        .then(() => moduleApi().caseDetail(node.dataset.caseId))
        .then(detail => {
          if (!node.isConnected) return;
          node.__caseDetail = detail;
          renderControlCaseDetail(node, 'diagnosis');
          window.AldeckotMessage.show('Nova revisão do diagnóstico registrada.');
        }).catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(() => { delete form.dataset.busy; if (submit.isConnected) submit.disabled = false; });
      return;
    }
    if (event.target.matches('[data-flux-reversal-form]')) {
      event.preventDefault();
      if (!fluxMode || !canManage()) return;
      const form = event.target;
      if (form.dataset.busy === 'true') return;
      const itemId = form.closest('.inv-modal')?.dataset.itemId;
      const token = form.closest('.inv-modal')?.dataset.reviewToken;
      const reason = String(new FormData(form).get('reason') || '').trim();
      if (!itemId || !token || reason.length < 5) return;
      form.dataset.busy = 'true';
      form.dataset.requestId ||= crypto.randomUUID();
      const submit = form.querySelector('[type=submit]');
      submit.disabled = true;
      let committed = false;
      (async () => {
        const preview = await moduleApi().previewReversal(itemId);
        if (!preview?.eligible || preview.token !== token) throw new Error(preview?.reason || 'O estado mudou. Reabra o estorno para revisar novamente.');
        await moduleApi().reverseMovement(itemId, token, form.dataset.requestId, reason);
        committed = true;
        await reloadInventory();
        closeModal();
        renderInventory();
        const original = activeTable()?.items.find(row => row.id === itemId);
        if (original) details(original);
        window.AldeckotMessage.show('Estorno registrado com histórico preservado. O chamado foi cancelado.');
      })().catch(error => window.AldeckotMessage.show(committed
        ? `Estorno registrado, mas a tela não atualizou: ${backendMessage(error)}. Recarregue antes de tentar novamente.`
        : backendMessage(error))).finally(() => {
        delete form.dataset.busy;
        if (submit.isConnected) submit.disabled = false;
      });
      return;
    }
    if (event.target.matches('[data-flux-acquisition-form]')) {
      event.preventDefault();
      if (!fluxMode || !canManage()) return;
      const form = event.target;
      if (form.dataset.busy === 'true') return;
      const itemId = form.closest('.inv-modal')?.dataset.itemId;
      const item = activeTable()?.items.find(entry => entry.id === itemId);
      if (!item || item.situation !== 'Aquisição') return;
      const values = new FormData(form);
      const destination = String(values.get('destination') || '');
      const managementKind = destination === 'management' ? String(values.get('managementKind') || '') : null;
      const peripheral = managementKind === 'peripheral';
      const tableId = destination === 'inventory' || peripheral ? String(values.get('inventoryTableId') || '') : null;
      const managementArea = managementKind === 'computer' ? String(values.get('managementArea') || '') : null;
      const peripheralKind = peripheral ? String(values.get('peripheralKind') || '') : null;
      const peripheralSector = peripheral ? String(values.get('peripheralSector') || '') : null;
      const supplyId = destination === 'supplies' ? String(values.get('supplyId') || '') : null;
      const supplyVariantId = destination === 'supplies' ? String(values.get('supplyVariantId') || '') || null : null;
      const supplyQuantity = destination === 'supplies' ? Number(values.get('supplyQuantity')) : null;
      if (!['inventory', 'management', 'supplies', 'none'].includes(destination) ||
          (destination === 'inventory' && !tableId) ||
          (destination === 'management' && (peripheral ? !tableId || !peripheralKind || !peripheralSector
            : managementKind !== 'computer' || !['Frente de Loja', 'Escritório', 'Estoque'].includes(managementArea))) ||
          (destination === 'supplies' && (!supplyId || !Number.isSafeInteger(supplyQuantity) || supplyQuantity < 1 || supplyQuantity > 1000000 || item.sourceModule === 'inventory' || item.inventoryItemId))) {
        window.AldeckotMessage.show('Selecione um destino e os campos obrigatórios.');
        return;
      }
      const submit = form.querySelector('[type="submit"]');
      form.dataset.busy = 'true';
      submit.disabled = true;
      let finishSave = window.AldeckotLoading?.beginSave?.('Registrando destino da aquisição…');
      (async () => {
        if (destination === 'supplies') {
          await moduleApi().setSupplyAcquisitionIntent(itemId, supplyId, supplyVariantId, supplyQuantity);
        } else if (peripheral) {
          await moduleApi().setPeripheralAcquisitionIntent(itemId, tableId, peripheralKind, peripheralSector);
        } else {
          await moduleApi().setAcquisitionIntent(itemId, destination, tableId, managementArea, managementKind);
        }
        if (destination === 'none') {
          await finishSave?.();
          finishSave = null;
          closeModal(); details(item);
          window.AldeckotMessage.show('Movimentação preservada no Flux sem cadastro adicional.');
          return;
        }
        if (item.status !== 'Recebido') {
          await finishSave?.();
          finishSave = null;
          await fluxAcquisitionWizard(item);
          window.AldeckotMessage.show('Destino salvo. Nenhuma entrada foi criada antes do recebimento.');
          return;
        }
        const management = destination === 'management';
        const supplies = destination === 'supplies';
        const preview = supplies
          ? await moduleApi().previewSupplyAcquisition(itemId)
          : peripheral ? await moduleApi().previewPeripheralAcquisition(itemId)
            : management ? await moduleApi().previewManagementAcquisition(itemId)
              : await moduleApi().previewInventoryAcquisition(itemId);
        const moduleName = supplies ? 'Suprimentos' : management ? 'Gestão TI' : 'Inventário';
        if (supplies && preview?.state === 'awaiting-receipt') throw new Error('Registre a entrada física e a data de recebimento no Flux antes de creditar o estoque.');
        if (supplies && preview?.state === 'completed') {
          await finishSave?.();
          finishSave = null;
          await fluxAcquisitionWizard(item);
          return;
        }
        if (supplies && (preview?.state !== 'ready' || !preview.token)) throw new Error('A prévia de saldo exige a migração 126. Nenhuma entrada foi efetuada.');
        if (preview?.state === 'invalid-identity') throw new Error('Informe um número de série válido. A TAG pode ser vinculada depois.');
        if (preview?.state === 'conflict') throw new Error('Há conflito de TAG, série ou vínculo entre módulos. Confira a identidade antes de integrar.');
        if (preview?.state === 'invalid-type') throw new Error('A TAG informada não corresponde ao tipo de periférico escolhido.');
        if (preview?.state === 'awaiting-receipt') throw new Error('Registre a entrada física no Flux antes de cadastrar o periférico.');
        if (preview?.state === 'category-conflict') throw new Error(`Selecione a categoria “${preview.tableName || 'atual'}” para vincular ao patrimônio existente.`);
        if (preview?.state === 'area-conflict') throw new Error(`Este computador já existe na área “${preview.existingArea || 'não informada'}” da Gestão TI. Revise a área escolhida; nenhuma mudança de local será feita automaticamente.`);
        if (!supplies && !['new', 'existing'].includes(preview?.state)) throw new Error('Não foi possível confirmar a identidade do equipamento. Nenhum cadastro foi feito.');
        const action = supplies
          ? `Confirmar entrada em Suprimentos: ${preview.itemName} · ${preview.variantName} · ${preview.quantity} unidade(s)? Saldo ${preview.previousStock} → ${preview.predictedStock}. Se o saldo mudar, será necessário revisar novamente.`
          : peripheral
            ? preview.state === 'existing'
              ? `Vincular a série ao ${preview.peripheralKind} da categoria “${preview.tableName}”? A classificação será registrada e o status e o local existentes serão preservados.`
              : `Cadastrar ${preview.peripheralKind} em Reserva no Inventário, categoria “${preview.tableName}”, setor ${preview.sector}, na Sala CPD? A instalação será feita pela Conferência por PDV.`
            : preview.state === 'existing'
          ? `O equipamento já existe em “${management ? managementArea : preview.tableName || 'Inventário'}”. Vincular esta aquisição ao registro existente, sem criar cópia nem alterar status/local?`
          : management
            ? `Cadastrar este computador em Reserva na Gestão TI (${managementArea}), ainda sem instalação em terminal ou PDV?`
            : 'Confirmar o recebimento e cadastrar este equipamento em Reserva na tabela escolhida do Inventário?';
        await finishSave?.();
        finishSave = null;
        const confirmed = await window.AldeckotMessage.confirm(action, {
          title: 'Confirmar aquisição recebida', confirmText: supplies ? 'Creditar estoque' : preview.state === 'existing' ? 'Vincular existente' : 'Cadastrar em Reserva', danger: false
        });
        if (!confirmed) {
          form.querySelector('.flux-acquisition-note').textContent = 'Escolha salva; nenhuma entrada foi efetivada. Você pode confirmar depois.';
          return;
        }
        finishSave = window.AldeckotLoading?.beginSave?.('Concluindo aquisição…');
        const result = supplies
          ? await moduleApi().completeSupplyAcquisition(itemId, preview.token)
          : peripheral ? await moduleApi().completePeripheralAcquisition(itemId, preview.token)
            : management ? await moduleApi().completeManagementAcquisition(itemId)
              : await moduleApi().completeInventoryAcquisition(itemId);
        await reloadInventory();
        renderInventory();
        const updatedItem = activeTable()?.items.find(entry => entry.id === itemId);
        if (updatedItem && peripheral) await fluxAcquisitionWizard(updatedItem);
        else if (updatedItem) details(updatedItem);
        window.AldeckotMessage.show(result?.alreadyApplied ? 'Aquisição já integrada; nenhuma entrada foi repetida.' :
          supplies ? `Entrada registrada em Suprimentos: saldo ${result.previousStock} → ${result.newStock}.` :
          peripheral ? (result?.linkedExisting ? 'Recebimento vinculado ao periférico no Inventário.' : 'Periférico cadastrado no Inventário, em Reserva na Sala CPD.') :
          result?.linkedExisting ? `Aquisição vinculada ao equipamento existente na ${moduleName}.` :
            `Equipamento cadastrado em Reserva na ${moduleName}.`);
      })().catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(async () => {
          delete form.dataset.busy;
          if (submit.isConnected) submit.disabled = false;
          await finishSave?.();
        });
      return;
    }
    if (!canManage() && event.target.matches('[data-inv-table-form], [data-inv-item-form], [data-inv-log-form], [data-inv-replace-form], [data-inv-branch-form], [data-inv-transfer-form], [data-inv-promotion-form]')) { event.preventDefault(); return; }
    if (event.target.matches('[data-inv-promotion-form]')) {
      event.preventDefault();
      const form = event.target; const node = form.closest('.inv-modal');
      const reason = String(new FormData(form).get('reason') || '').trim();
      if (reason.length < 3 || form.dataset.busy) return;
      form.dataset.busy = 'true';
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      moduleApi().promoteVerification(node.dataset.itemId, reason, node.dataset.operationId)
        .then(async result => {
          await reloadInventory(); closeModal(); renderInventory();
          window.AldeckotMessage.show(result?.alreadyApplied
            ? 'Encaminhamento já registrado; nenhum chamado foi duplicado.'
            : 'Verificação encerrada e manutenção aberta com histórico vinculado.');
        }).catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(() => { delete form.dataset.busy; if (submit.isConnected) submit.disabled = false; });
      return;
    }
    if (event.target.matches('[data-inv-branch-form]')) {
      event.preventDefault();
      const form = event.target; const name = String(new FormData(form).get('name') || '').trim();
      const current = form.closest('.inv-modal')?.dataset.branchId;
      const table = activeTable();
      if (!name || !table) return;
      if (table.branches.some(branch => branch.id !== current && branchModel.normalize(branch.name) === branchModel.normalize(name))) {
        window.AldeckotMessage.show('Já existe uma ramificação com este nome na categoria.'); return;
      }
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      const request = current ? moduleApi().renameBranch(current, name) : moduleApi().createBranch(table.id, name);
      request.then(async () => { await reloadInventory(); closeModal(); renderInventory(); })
        .catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(() => { if (submit.isConnected) submit.disabled = false; });
      return;
    }
    if (event.target.matches('[data-inv-transfer-form]')) {
      event.preventDefault();
      const form = event.target; const node = form.closest('.inv-modal');
      const values = new FormData(form);
      const first = node?.dataset.itemId; const second = String(values.get('other') || '');
      const reason = String(values.get('reason') || '').trim();
      if (!first || !second || first === second || form.dataset.busy) return;
      if (reason.length < 5) {
        window.AldeckotMessage.show('Informe o motivo da permuta com pelo menos 5 caracteres.');
        form.querySelector('[name="reason"]')?.focus();
        return;
      }
      form.dataset.busy = 'true';
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      const expected = { first: { sector: node.dataset.firstSector, location: node.dataset.firstLocation },
        second: { sector: node.dataset.secondSector, location: node.dataset.secondLocation } };
      moduleApi().swapLocations(first, second, node.dataset.operationId, expected, reason).then(async result => {
        await reloadInventory(); closeModal(); renderInventory();
        const updated = activeTable()?.items.find(item => item.id === first);
        if (updated) details(updated);
        window.AldeckotMessage.show(result?.legacy
          ? 'Permuta concluída. O histórico físico do PDV exige a migração 090, ainda não aplicada.'
          : 'Setor e Local permutados nos dois equipamentos, com histórico físico correlacionado.');
      }).catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(() => { delete form.dataset.busy; if (submit.isConnected) submit.disabled = false; });
      return;
    }
    if (event.target.matches('[data-inv-table-form]')) {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.target)); const modalNode = document.querySelector('.inv-modal'); const id = modalNode.dataset.tableId;
      const request = id ? moduleApi().updateTable(id, values) : moduleApi().createTable(values);
      request.then(async table => { state.active = table.id; state.sidebarOpen = false; await reloadInventory(); closeModal(); renderInventory(); }).catch(error => window.AldeckotMessage.show(backendMessage(error)));
    }
    if (event.target.matches('[data-inv-item-form]')) { event.preventDefault(); saveItem(event.target); }
    if (event.target.matches('[data-inv-replace-form]')) {
      event.preventDefault();
      const form = event.target;
      const itemId = form.closest('.inv-modal')?.dataset.itemId;
      const values = new FormData(form);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      moduleApi().replaceEquipment({ p_removed_item_id: itemId, p_installed_item_id: values.get('installed'),
        p_removed_status: values.get('removed_status'), p_removed_location: values.get('removed_location'),
        p_reason: values.get('reason') }).then(async () => {
        await reloadInventory(); closeModal(); renderInventory();
        window.AldeckotMessage.show('Substituição registrada nos dois equipamentos.');
      }).catch(error => window.AldeckotMessage.show(backendMessage(error)))
        .finally(() => { if (submit.isConnected) submit.disabled = false; });
    }
    if (event.target.matches('[data-inv-log-form]')) {
      event.preventDefault();
      const modalNode = document.querySelector('.inv-modal'); const itemId = modalNode.dataset.itemId; const logId = modalNode.dataset.logId; const message = String(new FormData(event.target).get('message') || '').trim();
      if (!message) return;
      const request = logId ? moduleApi().updateLog(logId, message) : moduleApi().addLog(itemId, message);
      request.then(async () => {
        await reloadInventory(); closeModal(); const item = activeTable()?.items.find(entry => entry.id === itemId); if (item) details(item);
      }).catch(error => window.AldeckotMessage.show(backendMessage(error)));
    }
  });
})();
