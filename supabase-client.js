/* global supabase */
(() => {
  let client;
  let bootPromise;

  const configured = configuration => Boolean(
    configuration?.url && configuration?.publishableKey &&
    !configuration.url.includes('SEU-PROJETO') &&
    !configuration.publishableKey.includes('COLE_AQUI')
  );

  const fail = message => { throw new Error(message); };
  const check = ({ error, data }) => {
    if (error) fail(error.message);
    return data;
  };
  const priorityMarker = /^\[\[aldeckot:priority:(urgent|periodic|normal)\]\]\r?\n?/;
  const missingPriorityColumn = error => /(?:priority.*(?:column|schema cache)|column.*priority)/i.test(error?.message || '');
  const missingAgendaCompletionColumn = error => /(?:is_completed|completed_at).*?(?:column|schema cache)|(?:column|schema cache).*?(?:is_completed|completed_at)/i.test(error?.message || '');
  const missingAgendaCompletionFunction = error => /(?:set_agenda_(?:task|entry)_completion|function.*does not exist|schema cache)/i.test(error?.message || '');
  const missingAgendaRetentionFunction = error => /(?:purge_expired_agenda_entries|function.*does not exist|schema cache)/i.test(error?.message || '');
  const splitLegacyPriority = notes => {
    const match = String(notes || '').match(priorityMarker);
    return { priority: match?.[1] || null, notes: String(notes || '').replace(priorityMarker, '') };
  };
  const storeLegacyPriority = (notes, priority) => `[[aldeckot:priority:${priority}]]\n${notes || ''}`;
  const itemPriorityMarker = /^\[\[aldeckot:item-priority:(alta|media|estavel)\]\]\r?\n?/i;
  const itemPriorityKey = value => ({ Alta: 'alta', 'Média': 'media', 'Estável': 'estavel' })[value] || 'estavel';
  const itemPriorityValue = value => ({ alta: 'Alta', media: 'Média', estavel: 'Estável' })[String(value || '').toLowerCase()] || 'Estável';
  const splitItemPriority = notes => {
    const text = String(notes || '');
    const match = text.match(itemPriorityMarker);
    return { priority: itemPriorityValue(match?.[1]), notes: text.replace(itemPriorityMarker, '') };
  };
  const storeItemPriority = (notes, priority) => `[[aldeckot:item-priority:${itemPriorityKey(priority)}]]\n${splitItemPriority(notes).notes}`;
  const hasOwn = (source, key) => Object.prototype.hasOwnProperty.call(source || {}, key);
  const withoutDuplicateItems = items => {
    const seen = new Set();
    return items.filter((item, index) => {
      const key = String(item?.id || `record:${index}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const normalizedText = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const managementPeripheralRules = [
    { type: 'Impressora', pattern: /^IMPR[0-9]+$/ },
    { type: 'Leitor', pattern: /^EAN[0-9]+$/ },
    { type: 'Gaveta', pattern: /^GVT[0-9]+$/ },
    { type: 'Pin Pad', pattern: /^PP[0-9]+$/ },
    { type: 'Balança', pattern: /^BAL[0-9]+$/ },
    { type: 'Monitor', pattern: /^MON[0-9]+$/ },
    { type: 'Teclado', pattern: /^TEC[0-9]+$/ }
  ];
  const inventoryPeripheralAssignment = item => {
    const tag = String(item?.tag || '').trim().toUpperCase();
    const location = String(item?.location || '').trim();
    if (!tag || ['-', '***'].includes(tag)) return { state: 'no-tag' };
    const rule = managementPeripheralRules.find(entry => entry.pattern.test(tag));
    if (!rule) return { state: 'unsupported-tag', tag, location };
    if (!location) return { state: 'no-location', type: rule.type, tag };
    return { state: 'ready', type: rule.type, tag, location };
  };
  const samePeripheralType = (peripheral, type) => normalizedText(peripheral?.type || peripheral?.tipo) === normalizedText(type);
  const syncDescription = (assignment, action) => action === 'removed'
    ? `Sincronização do Inventário — ${assignment.type} removido: ${assignment.tag}.`
    : `Sincronização do Inventário — ${assignment.type} atualizado com a TAG ${assignment.tag}.`;
  const appendPeripheralSyncLog = (payload, assignment, itemId, action) => {
    const at = new Date().toISOString();
    const text = syncDescription(assignment, action);
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    return {
      ...payload,
      logs: [{ id: `inventory-peripheral-${itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at, text, sourceModule: 'inventory', sourceItemId: String(itemId) }, ...logs],
      lastActivity: text
    };
  };
  const assignManagementPeripheral = (payload, assignment, itemId) => {
    const current = Array.isArray(payload?.peripherals) ? payload.peripherals : [];
    let changed = false;
    let found = false;
    const peripherals = current.map(peripheral => {
      if (!samePeripheralType(peripheral, assignment.type)) return peripheral;
      found = true;
      const next = { ...peripheral, type: peripheral.type || peripheral.tipo || assignment.type, status: assignment.tag, sourceModule: 'inventory', sourceItemId: String(itemId) };
      if (String(peripheral.status || '').trim() !== assignment.tag || peripheral.sourceModule !== 'inventory' || String(peripheral.sourceItemId || '') !== String(itemId) || !peripheral.type) changed = true;
      return next;
    });
    if (!found) {
      peripherals.push({ id: `inventory-peripheral-${itemId}-${normalizedText(assignment.type).replace(/\s+/g, '-')}`, type: assignment.type, status: assignment.tag, sourceModule: 'inventory', sourceItemId: String(itemId) });
      changed = true;
    }
    return changed ? appendPeripheralSyncLog({ ...(payload || {}), peripherals }, assignment, itemId, 'updated') : null;
  };
  const clearManagementPeripheral = (payload, assignment, itemId) => {
    const current = Array.isArray(payload?.peripherals) ? payload.peripherals : [];
    const peripherals = current.filter(peripheral => {
      const linkedSource = String(peripheral?.sourceItemId || '') === String(itemId);
      const matchingTag = String(peripheral?.status || '').trim().toUpperCase() === assignment.tag;
      return !(samePeripheralType(peripheral, assignment.type) && (linkedSource || matchingTag));
    });
    if (peripherals.length === current.length) return null;
    return appendPeripheralSyncLog({ ...(payload || {}), peripherals }, assignment, itemId, 'removed');
  };
  const dateLabel = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const activityPage = module => ({ inventory: 'inventory.html', management: 'management.html', control: 'control.html', flux: 'flux.html', nfe: 'nfe.html' })[module] || '';
  const activityTarget = (module, tableId, itemId, operation) => {
    const page = activityPage(module);
    if (!page || !tableId) return '';
    const query = new URLSearchParams({ table: tableId });
    if (itemId && operation !== 'delete') query.set('item', itemId);
    return `${page}?${query.toString()}`;
  };
  const itemActivityContext = async (module, itemId) => {
    const source = ({ inventory: 'inventory_items', control: 'control_items', flux: 'flux_items' })[module] || 'inventory_items';
    const row = check(await client.from(source)
      .select('id, table_id, equipment, brand, serial, tag, status, module_tables(name)')
      .eq('id', itemId).single());
    const table = Array.isArray(row.module_tables) ? row.module_tables[0] : row.module_tables;
    return { ...row, tableName: table?.name || 'Tabela sem nome' };
  };
  const recordItemActivity = async ({ module, itemId, operation, description, context }) => {
    try {
      const item = context || await itemActivityContext(module, itemId);
      await events.record(module, operation, {
        itemId: item.id,
        tableId: item.table_id,
        tableName: item.tableName,
        equipment: item.equipment,
        brand: item.brand || '',
        serial: item.serial || '',
        tag: item.tag || '',
        status: item.status || '',
        description: description || 'Registro atualizado.',
        targetUrl: activityTarget(module, item.table_id, item.id, operation)
      });
    } catch (error) {
      console.warn('Não foi possível registrar a atividade recente.', error);
    }
  };
  const itemFromRow = row => ({
    id: row.id,
    equipment: row.equipment,
    model: row.model,
    brand: row.brand,
    serial: row.serial,
    tag: row.tag,
    sector: row.sector,
    location: row.location,
    status: row.status,
    situation: row.situation,
    cleaning: row.cleaning_type || 'Não realizada',
    priority: splitItemPriority(row.notes).priority,
    notes: splitItemPriority(row.notes).notes,
    date: row.updated_at ? row.updated_at.slice(0, 10) : '',
    updatedAt: row.updated_at || row.created_at || '',
    logs: (row.inventory_item_logs || [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(log => ({ id: log.id, at: dateLabel(log.created_at), createdAt: log.created_at, text: log.message, sourceModule: log.source_module || '', sourceLogId: log.source_log_id || '' }))
  });

  async function init() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      await (window.ALDECKOT_SUPABASE_CONFIG_READY || Promise.resolve());
      const configuration = window.ALDECKOT_SUPABASE_CONFIG || {};
      if (!configured(configuration)) {
        const reason = window.ALDECKOT_SUPABASE_CONFIG_ERROR;
        fail(reason ? `Supabase não configurado. ${reason}` : 'Supabase não configurado. Verifique as variáveis públicas do Supabase no Vercel.');
      }
      if (!window.supabase?.createClient) fail('Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão com a internet.');

      client = window.supabase.createClient(configuration.url, configuration.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
      return { client };
    })();
    try { return await bootPromise; }
    catch (error) { bootPromise = null; throw error; }
  }

  const inventory = {
    async load() {
      await init();
      let response = await client
        .from('module_tables')
        .select('id, name, icon, position, created_at, inventory_items(id, equipment, model, brand, serial, tag, sector, location, status, situation, cleaning_type, notes, position, created_at, updated_at, inventory_item_logs(id, message, created_at, source_module, source_log_id))')
        .eq('module', 'inventory')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false });
      if (response.error && /source_module|source_log_id/i.test(response.error.message || '')) {
        response = await client
          .from('module_tables')
          .select('id, name, icon, position, created_at, inventory_items(id, equipment, model, brand, serial, tag, sector, location, status, situation, cleaning_type, notes, position, created_at, updated_at, inventory_item_logs(id, message, created_at))')
          .eq('module', 'inventory')
          .order('position', { ascending: true })
          .order('created_at', { ascending: false });
      }
      const rows = check(response);
      return {
        tables: rows.map(table => ({
          id: table.id,
          name: table.name,
          icon: table.icon,
          items: withoutDuplicateItems(
            (table.inventory_items || [])
              .sort((a, b) => (a.position - b.position) || String(b.updated_at).localeCompare(String(a.updated_at)))
              .map(itemFromRow),
            ['equipment', 'model', 'brand', 'sector', 'location', 'status', 'situation', 'cleaning', 'notes']
          )
        }))
      };
    },

    async createTable(values) {
      await init();
      return check(await client.from('module_tables').insert({
        module: 'inventory', name: values.name.trim(), icon: values.icon || '📁', position: 0
      }).select().single());
    },

    async updateTable(id, values) {
      await init();
      return check(await client.from('module_tables').update({
        name: values.name.trim()
      }).eq('id', id).select().single());
    },

    async deleteTable(id) {
      await init();
      check(await client.from('module_tables').delete().eq('id', id));
    },

    async moveTableToTop(id) {
      await init();
      const tables = check(await client
        .from('module_tables')
        .select('id')
        .eq('module', 'inventory')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }));
      const selected = tables.find(table => table.id === id);
      if (!selected) return;

      const ordered = [selected, ...tables.filter(table => table.id !== id)];
      await Promise.all(ordered.map((table, position) =>
        client.from('module_tables').update({ position }).eq('id', table.id).then(check)
      ));
    },

    async saveItem(tableId, values, existingId, logMessage) {
      await init();
      const payload = {
        table_id: tableId,
        equipment: values.equipment.trim(),
        model: values.model.trim(),
        brand: values.brand || '',
        sector: values.sector || '',
        location: values.location || '',
        status: values.status,
        situation: values.situation,
        cleaning_type: values.cleaning || 'Não realizada',
        notes: storeItemPriority(values.notes, values.priority),
        position: 0
      };
      if (!existingId || hasOwn(values, 'serial')) payload.serial = values.serial || '';
      if (!existingId || hasOwn(values, 'tag')) payload.tag = values.tag || '';
      const result = existingId
        ? await client.from('inventory_items').update(payload).eq('id', existingId).select().single()
        : await client.from('inventory_items').insert(payload).select().single();
      const saved = check(result);
      check(await client.from('inventory_item_logs').insert({
        inventory_item_id: saved.id,
        action: existingId ? 'update' : 'create',
        message: logMessage || (existingId ? 'Equipamento atualizado.' : 'Equipamento adicionado ao inventário.')
      }));
      await this.moveTableToTop(tableId);
      await recordItemActivity({
        module: 'inventory',
        itemId: saved.id,
        operation: existingId ? 'update' : 'create',
        description: logMessage || (existingId ? 'Equipamento atualizado.' : 'Equipamento adicionado ao Inventário.')
      });
      return saved;
    },

    async syncManagementPeripheral(item, previous = null) {
      await init();
      const nextAssignment = inventoryPeripheralAssignment(item);
      const previousAssignment = previous ? inventoryPeripheralAssignment(previous) : null;
      const shouldClearPrevious = previousAssignment?.state === 'ready' && (
        nextAssignment.state !== 'ready' ||
        normalizedText(previousAssignment.location) !== normalizedText(nextAssignment.location) ||
        previousAssignment.type !== nextAssignment.type
      );
      if (nextAssignment.state !== 'ready' && !shouldClearPrevious) return nextAssignment;

      const managementTables = check(await client.from('module_tables').select('id').eq('module', 'management'));
      if (!managementTables.length) return { ...nextAssignment, state: 'target-not-found', matched: 0, updated: 0 };
      const records = check(await client.from('module_records').select('id, payload').in('table_id', managementTables.map(table => table.id)));
      let matched = 0;
      let updated = 0;
      for (const record of records) {
        const computerName = String(record.payload?.equipment || '').trim();
        const matchesPrevious = shouldClearPrevious && normalizedText(computerName) === normalizedText(previousAssignment.location);
        const matchesNext = nextAssignment.state === 'ready' && normalizedText(computerName) === normalizedText(nextAssignment.location);
        if (!matchesPrevious && !matchesNext) continue;
        matched += 1;
        let nextPayload = record.payload || {};
        if (matchesPrevious) nextPayload = clearManagementPeripheral(nextPayload, previousAssignment, item.id) || nextPayload;
        if (matchesNext) nextPayload = assignManagementPeripheral(nextPayload, nextAssignment, item.id) || nextPayload;
        if (nextPayload === record.payload) continue;
        check(await client.from('module_records').update({ payload: nextPayload }).eq('id', record.id).select('id'));
        updated += 1;
      }
      if (nextAssignment.state !== 'ready') return { ...nextAssignment, state: shouldClearPrevious ? 'cleared' : nextAssignment.state, matched, updated };
      return { ...nextAssignment, state: matched ? (updated ? 'updated' : 'already-synced') : 'target-not-found', matched, updated };
    },

    async addLog(itemId, message) {
      await init();
      const saved = check(await client.from('inventory_item_logs').insert({
        inventory_item_id: itemId,
        action: 'update',
        message: message.trim()
      }).select().single());
      await recordItemActivity({ module: 'inventory', itemId, operation: 'log', description: message.trim() });
      return saved;
    },

    async updateLog(id, message) {
      await init();
      const saved = check(await client.from('inventory_item_logs').update({
        message: message.trim()
      }).eq('id', id).select('id, inventory_item_id').single());
      await recordItemActivity({ module: 'inventory', itemId: saved.inventory_item_id, operation: 'log', description: `Log editado: ${message.trim()}` });
      return saved;
    },

    async deleteLog(id) {
      await init();
      const log = check(await client.from('inventory_item_logs').select('inventory_item_id').eq('id', id).single());
      const deleted = check(await client.from('inventory_item_logs').delete().eq('id', id).select('id'));
      if (!deleted?.length) fail('O registro não foi excluído. Atualize a página e tente novamente.');
      await recordItemActivity({ module: 'inventory', itemId: log.inventory_item_id, operation: 'log', description: 'Log excluído.' });
    },

    async deleteItem(id) {
      await init();
      let context;
      try { context = await itemActivityContext('inventory', id); }
      catch (error) { console.warn('Não foi possível preparar o histórico da exclusão.', error); }
      check(await client.from('inventory_items').delete().eq('id', id));
      if (context) await recordItemActivity({ module: 'inventory', itemId: id, operation: 'delete', description: 'Equipamento excluído do Inventário.', context });
    },

    async replace(snapshot) {
      await init();
      const existing = check(await client.from('module_tables').select('id').eq('module', 'inventory'));
      if (existing.length) check(await client.from('module_tables').delete().in('id', existing.map(table => table.id)));
      for (const sourceTable of snapshot.tables || []) {
        const table = await this.createTable(sourceTable);
        for (const sourceItem of sourceTable.items || []) {
          const restored = check(await client.from('inventory_items').insert({
            table_id: table.id,
            equipment: sourceItem.equipment,
            model: sourceItem.model,
            brand: sourceItem.brand || '',
            serial: sourceItem.serial || '',
            tag: sourceItem.tag || '',
            sector: sourceItem.sector || '',
            location: sourceItem.location || '',
            status: sourceItem.status || 'Ativo',
            situation: sourceItem.situation || 'Normal',
            cleaning_type: sourceItem.cleaning || 'Não realizada',
            notes: storeItemPriority(sourceItem.notes, sourceItem.priority),
            position: 0
          }).select().single());
          const logs = sourceItem.logs?.length ? sourceItem.logs : [{ text: 'Equipamento restaurado a partir de backup.' }];
          check(await client.from('inventory_item_logs').insert(logs.map(log => ({
            inventory_item_id: restored.id,
            action: 'restore',
            message: log.at && log.at !== 'Backup antigo' ? `${log.at} — ${log.text || 'Histórico restaurado.'}` : (log.text || 'Histórico restaurado.')
          }))));
          await recordItemActivity({
            module: 'inventory',
            itemId: restored.id,
            operation: 'update',
            description: 'Equipamento restaurado a partir de backup.'
          });
        }
      }
      return this.load();
    }
  };

  const controlItemFromRow = row => ({
    id: row.id,
    equipment: row.equipment,
    model: row.model,
    brand: row.brand,
    serial: row.serial,
    tag: row.tag,
    sector: row.sector,
    entryDate: row.entry_date || '',
    exitDate: row.exit_date || '',
    status: row.status,
    situation: row.cleaning_type,
    priority: splitItemPriority(row.notes).priority,
    notes: splitItemPriority(row.notes).notes,
    date: row.updated_at ? row.updated_at.slice(0, 10) : '',
    updatedAt: row.updated_at || row.created_at || '',
    logs: (row.control_item_logs || [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(log => ({ id: log.id, at: dateLabel(log.created_at), createdAt: log.created_at, text: log.message }))
  });

  const control = {
    async load() {
      await init();
      const rows = check(await client
        .from('module_tables')
        .select('id, name, icon, position, created_at, control_items(id, equipment, model, brand, serial, tag, sector, entry_date, exit_date, status, cleaning_type, notes, position, created_at, updated_at, control_item_logs(id, message, created_at))')
        .eq('module', 'control')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }));
      return {
        tables: rows.map(table => ({
          id: table.id,
          name: table.name,
          icon: table.icon,
          items: withoutDuplicateItems(
            (table.control_items || [])
              .sort((a, b) => (a.position - b.position) || String(b.updated_at).localeCompare(String(a.updated_at)))
              .map(controlItemFromRow),
            ['equipment', 'model', 'brand', 'sector', 'entryDate', 'exitDate', 'status', 'situation', 'notes']
          )
        }))
      };
    },

    async createTable(values) {
      await init();
      const table = check(await client.from('module_tables').insert({
        module: 'control', name: values.name.trim(), icon: values.icon || '📁', position: 0
      }).select().single());
      await this.moveTableToTop(table.id);
      return table;
    },

    async updateTable(id, values) {
      await init();
      const table = check(await client.from('module_tables').update({ name: values.name.trim() }).eq('id', id).select().single());
      await this.moveTableToTop(id);
      return table;
    },

    async deleteTable(id) {
      await init();
      check(await client.from('module_tables').delete().eq('id', id));
    },

    async moveTableToTop(id) {
      await init();
      const tables = check(await client.from('module_tables').select('id').eq('module', 'control').order('position', { ascending: true }).order('created_at', { ascending: false }));
      const selected = tables.find(table => table.id === id);
      if (!selected) return;
      const ordered = [selected, ...tables.filter(table => table.id !== id)];
      await Promise.all(ordered.map((table, position) => client.from('module_tables').update({ position }).eq('id', table.id).then(check)));
    },

    async saveItem(tableId, values, existingId, logMessage) {
      await init();
      const payload = {
        table_id: tableId,
        equipment: values.equipment.trim(),
        model: values.model.trim(),
        brand: values.brand || '',
        sector: values.sector || '',
        entry_date: values.entryDate || null,
        exit_date: values.exitDate || null,
        status: values.status,
        cleaning_type: values.situation,
        notes: storeItemPriority(values.notes, values.priority),
        position: 0
      };
      if (!existingId || hasOwn(values, 'serial')) payload.serial = values.serial || '';
      if (!existingId || hasOwn(values, 'tag')) payload.tag = values.tag || '';
      const result = existingId
        ? await client.from('control_items').update(payload).eq('id', existingId).select().single()
        : await client.from('control_items').insert(payload).select().single();
      const saved = check(result);
      check(await client.from('control_item_logs').insert({
        control_item_id: saved.id,
        action: existingId ? 'update' : 'create',
        message: logMessage || (existingId ? 'Equipamento atualizado.' : 'Equipamento adicionado ao Controle TI.')
      }));
      await this.moveTableToTop(tableId);
      await recordItemActivity({
        module: 'control',
        itemId: saved.id,
        operation: existingId ? 'update' : 'create',
        description: logMessage || (existingId ? 'Equipamento atualizado.' : 'Equipamento adicionado ao Controle TI.')
      });
      return saved;
    },

    async addLog(itemId, message) {
      await init();
      const saved = check(await client.from('control_item_logs').insert({ control_item_id: itemId, action: 'update', message: message.trim() }).select().single());
      const context = await itemActivityContext('control', itemId);
      await this.moveTableToTop(context.table_id);
      await recordItemActivity({ module: 'control', itemId, operation: 'log', description: message.trim(), context });
      return saved;
    },

    async updateLog(id, message) {
      await init();
      const saved = check(await client.from('control_item_logs').update({ message: message.trim() }).eq('id', id).select('id, control_item_id').single());
      const context = await itemActivityContext('control', saved.control_item_id);
      await this.moveTableToTop(context.table_id);
      await recordItemActivity({ module: 'control', itemId: saved.control_item_id, operation: 'log', description: `Log editado: ${message.trim()}`, context });
      return saved;
    },

    async deleteLog(id) {
      await init();
      const log = check(await client.from('control_item_logs').select('control_item_id').eq('id', id).single());
      const deleted = check(await client.from('control_item_logs').delete().eq('id', id).select('id'));
      if (!deleted?.length) fail('O registro não foi excluído. Atualize a página e tente novamente.');
      const context = await itemActivityContext('control', log.control_item_id);
      await this.moveTableToTop(context.table_id);
      await recordItemActivity({ module: 'control', itemId: log.control_item_id, operation: 'log', description: 'Log excluído.', context });
    },

    async deleteItem(id) {
      await init();
      let context;
      try { context = await itemActivityContext('control', id); }
      catch (error) { console.warn('Não foi possível preparar o histórico da exclusão.', error); }
      check(await client.from('control_items').delete().eq('id', id));
      if (context) {
        await this.moveTableToTop(context.table_id);
        await recordItemActivity({ module: 'control', itemId: id, operation: 'delete', description: 'Equipamento excluído do Controle TI.', context });
      }
    },

    async replace(snapshot) {
      await init();
      const existing = check(await client.from('module_tables').select('id').eq('module', 'control'));
      if (existing.length) check(await client.from('module_tables').delete().in('id', existing.map(table => table.id)));
      const restoredTables = [];
      for (const sourceTable of snapshot.tables || []) {
        const table = await this.createTable(sourceTable);
        restoredTables.push(table.id);
        const restoredItems = [];
        for (const sourceItem of sourceTable.items || []) {
          const restored = check(await client.from('control_items').insert({
            table_id: table.id,
            equipment: sourceItem.equipment,
            model: sourceItem.model,
            brand: sourceItem.brand || '',
            serial: sourceItem.serial || '',
            tag: sourceItem.tag || '',
            sector: sourceItem.sector || '',
            entry_date: sourceItem.entryDate || null,
            exit_date: sourceItem.exitDate || null,
            status: sourceItem.status || 'Em manutenção',
            cleaning_type: sourceItem.situation || 'Não realizada',
            notes: storeItemPriority(sourceItem.notes, sourceItem.priority),
            position: 0
          }).select().single());
          restoredItems.push(restored.id);
          const logs = sourceItem.logs?.length ? sourceItem.logs : [{ text: 'Equipamento restaurado a partir de backup.' }];
          check(await client.from('control_item_logs').insert(logs.map(log => ({
            control_item_id: restored.id,
            action: 'restore',
            message: log.at && log.at !== 'Backup antigo' ? `${log.at} — ${log.text || 'Histórico restaurado.'}` : (log.text || 'Histórico restaurado.')
          }))));
          await recordItemActivity({
            module: 'control',
            itemId: restored.id,
            operation: 'update',
            description: 'Equipamento restaurado a partir de backup.'
          });
        }
        await Promise.all(restoredItems.map((id, position) => client.from('control_items').update({ position }).eq('id', id).then(check)));
      }
      await Promise.all(restoredTables.map((id, position) => client.from('module_tables').update({ position }).eq('id', id).then(check)));
      return this.load();
    }
  };

  const fluxItemFromRow = row => ({
    id: row.id,
    movement: row.movement,
    equipment: row.equipment,
    model: row.model,
    brand: row.brand,
    serial: row.serial,
    tag: row.tag,
    senderCompany: row.sender_company,
    destinationCompany: row.destination_company,
    senderResponsible: row.sender_responsible,
    receiverResponsible: row.receiver_responsible,
    sendDate: row.send_date || '',
    receivedDate: row.received_date || '',
    shippingType: row.shipping_type,
    situation: row.reason,
    status: row.status,
    priority: splitItemPriority(row.notes).priority,
    notes: splitItemPriority(row.notes).notes,
    date: row.updated_at ? row.updated_at.slice(0, 10) : '',
    updatedAt: row.updated_at || row.created_at || '',
    logs: (row.flux_item_logs || [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(log => ({ id: log.id, at: dateLabel(log.created_at), createdAt: log.created_at, text: log.message }))
  });

  const managementItemFromRow = row => {
    const payload = row.payload || {};
    const logs = Array.isArray(payload.logs) ? payload.logs : [];
    const peripherals = Array.isArray(payload.peripherals) ? payload.peripherals : [];
    const metrics = payload.monitoring && typeof payload.monitoring === 'object' ? payload.monitoring : {};
    return {
      id: row.id,
      tableId: row.table_id,
      terminal: payload.terminal || '',
      equipment: payload.equipment || payload.name || '',
      tag: payload.tag || '', brand: payload.brand || '', model: payload.model || '', serial: payload.serial || '',
      ip: payload.ip || '', gateway: payload.gateway || payload.gatway || '', subnetMask: payload.subnetMask || payload.mask || payload.mascara || '', hostname: payload.hostname || '', operatingSystem: payload.operatingSystem || '', osVersion: payload.osVersion || '',
      processor: payload.processor || '', memory: payload.memory || '', storage: payload.storage || '',
      type: payload.type || 'Escritório', company: payload.company || '', sector: payload.sector || '', location: payload.location || '',
      responsible: payload.responsible || '', user: payload.user || '', notes: payload.notes || '', status: payload.status || 'Ativo', priority: payload.priority || 'Estável',
      situation: payload.situation || 'Em Uso', cleaning: payload.cleaning || 'Preventiva', area: payload.area || 'Escritório',
      isFixed: Boolean(payload.isFixed), peripherals, monitoring: {
        cpu: Number(metrics.cpu) || 0, ram: Number(metrics.ram) || 0, disk: Number(metrics.disk) || 0,
        network: Number(metrics.network) || 0, temperature: Number(metrics.temperature) || 0, ping: Number(metrics.ping) || 0
      },
      registeredAt: payload.registeredAt || row.created_at?.slice(0, 10) || '', updatedAt: row.updated_at || row.created_at || '',
      logs: logs.map((log, index) => ({
        id: log.id || `${row.id}-${index}`,
        at: log.at || log.createdAt || log.timestamp || row.updated_at || row.created_at,
        text: log.text || log.action || 'Registro atualizado.',
        sourceModule: log.sourceModule || (log.controlLogId ? 'control' : ''),
        sourceLogId: log.sourceLogId || log.controlLogId || ''
      })).sort((first, second) => String(second.at).localeCompare(String(first.at)))
    };
  };

  const managementRecordPayload = (item = {}, activityDescription = '') => ({
    terminal: String(item.terminal || '').trim(), equipment: String(item.equipment || '').trim(), tag: String(item.tag || '').trim(), brand: String(item.brand || '').trim(), model: String(item.model || '').trim(), serial: String(item.serial || '').trim(),
    ip: String(item.ip || '').trim(), gateway: String(item.gateway || '').trim(), subnetMask: String(item.subnetMask || '').trim(), hostname: String(item.hostname || '').trim(), operatingSystem: String(item.operatingSystem || '').trim(), osVersion: String(item.osVersion || '').trim(),
    processor: String(item.processor || '').trim(), memory: String(item.memory || '').trim(), storage: String(item.storage || '').trim(),
    type: item.type || 'Escritório', company: String(item.company || '').trim(), sector: String(item.sector || '').trim(), location: String(item.location || '').trim(),
    responsible: String(item.responsible || '').trim(), user: String(item.user || '').trim(), notes: String(item.notes || '').trim(), status: item.status || 'Ativo', priority: item.priority || 'Estável',
    situation: item.situation || 'Em Uso', cleaning: item.cleaning || 'Preventiva', area: item.area || 'Escritório', isFixed: Boolean(item.isFixed),
    peripherals: Array.isArray(item.peripherals) ? item.peripherals : [], monitoring: item.monitoring || {}, registeredAt: item.registeredAt || new Date().toISOString().slice(0, 10),
    logs: Array.isArray(item.logs) ? item.logs : [], lastActivity: String(activityDescription || '').trim()
  });

  const management = {
    async ensureTable() {
      await init();
      const existing = check(await client.from('module_tables').select('id, name').eq('module', 'management').order('created_at', { ascending: true }).limit(1));
      if (existing[0]) return existing[0];
      const created = await client.from('module_tables').insert({ module: 'management', name: 'Infraestrutura ALDECKOT', icon: '🖥️', position: 0 }).select('id, name').single();
      if (!created.error) return created.data;
      const concurrent = check(await client.from('module_tables').select('id, name').eq('module', 'management').order('created_at', { ascending: true }).limit(1));
      if (concurrent[0]) return concurrent[0];
      fail(created.error.message);
    },

    async load() {
      const table = await this.ensureTable();
      const rows = check(await client.from('module_records').select('id, table_id, payload, position, created_at, updated_at').eq('table_id', table.id).order('position', { ascending: true }).order('updated_at', { ascending: false }));
      return {
        table,
        items: withoutDuplicateItems(
          rows.map(managementItemFromRow),
          ['terminal', 'equipment', 'model', 'brand', 'ip', 'hostname', 'area', 'sector', 'status', 'situation', 'cleaning', 'notes']
        )
      };
    },

    async save(item, existingId, activityDescription) {
      const table = await this.ensureTable();
      const payload = managementRecordPayload(item, activityDescription);
      let result;
      if (existingId) {
        // Um terminal fixo nunca muda de posição ao receber manutenção ou uma edição.
        result = await client.from('module_records').update({ payload }).eq('id', existingId).select('id, table_id, payload, position, created_at, updated_at').single();
      } else {
        const rows = check(await client.from('module_records').select('position').eq('table_id', table.id).order('position', { ascending: false }).limit(1));
        const position = Number(rows[0]?.position || 0) + 1;
        result = await client.from('module_records').insert({ table_id: table.id, payload, position }).select('id, table_id, payload, position, created_at, updated_at').single();
      }
      const saved = check(result);
      return managementItemFromRow(saved);
    },

    async transfer(sourceId, destinationId) {
      await init();
      if (!sourceId || !destinationId || sourceId === destinationId) fail('Selecione um terminal de destino diferente.');
      check(await client.rpc('management_transfer_terminal', {
        p_source_id: sourceId,
        p_destination_id: destinationId
      }));
      return this.load();
    },

    async replaceAll(items) {
      const table = await this.ensureTable();
      const current = check(await client.from('module_records').select('id').eq('table_id', table.id));
      if (current.length) check(await client.from('module_records').delete().in('id', current.map(row => row.id)));
      const normalized = (Array.isArray(items) ? items : []).map((item, position) => ({
        table_id: table.id,
        position,
        payload: managementRecordPayload(item, 'Equipamento restaurado a partir de backup da Gestão TI.')
      }));
      if (normalized.length) check(await client.from('module_records').insert(normalized));
      await events.record('management', 'restore', { tableId: table.id, tableName: table.name, description: 'Backup da Gestão TI restaurado.' });
      return this.load();
    },

    async remove(id) {
      await init();
      const row = check(await client.from('module_records').select('id, table_id, payload, module_tables(name)').eq('id', id).single());
      const payload = row.payload || {};
      if (Boolean(payload.isFixed)) fail('Terminais fixos não podem ser excluídos.');
      check(await client.from('module_records').delete().eq('id', id));
      const table = Array.isArray(row.module_tables) ? row.module_tables[0] : row.module_tables;
      await events.record('management', 'delete', {
        itemId: id, tableId: row.table_id, tableName: table?.name || 'Infraestrutura ALDECKOT', equipment: payload.equipment || payload.name || 'Equipamento', brand: payload.brand || '', serial: payload.serial || '', tag: payload.tag || '',
        status: payload.status || '', description: 'Equipamento excluído da Gestão TI.', targetUrl: activityTarget('management', row.table_id, id, 'delete')
      });
    }
  };

  const managementBackups = {
    async list(limit = 3) {
      await init();
      return check(await client.from('management_backups').select('id, label, snapshot, source, created_at').order('created_at', { ascending: false }).limit(Math.min(limit, 3)));
    },
    async create(snapshot, label = 'Backup da Gestão TI', source = 'network') {
      await init();
      const row = check(await client.from('management_backups').insert({ label, snapshot, source }).select().single());
      const outdated = check(await client.from('management_backups').select('id').order('created_at', { ascending: false }).range(3, 1000));
      if (outdated.length) check(await client.from('management_backups').delete().in('id', outdated.map(backup => backup.id)));
      await events.record('management', 'backup', { backup_id: row.id });
      return row;
    },
    async settings() {
      await init();
      const setting = check(await client.from('management_backup_settings').select('automatic, updated_at').maybeSingle());
      return setting || { automatic: false, updated_at: null };
    },
    async setAutomatic(automatic) {
      await init();
      return check(await client.from('management_backup_settings').upsert({ setting_key: 'global', automatic: Boolean(automatic) }).select().single());
    }
  };

  const flux = {
    async load() {
      await init();
      const rows = check(await client
        .from('module_tables')
        .select('id, name, icon, position, created_at, flux_items(id, movement, equipment, model, brand, serial, tag, sender_company, destination_company, sender_responsible, receiver_responsible, send_date, received_date, shipping_type, reason, status, notes, position, created_at, updated_at, flux_item_logs(id, message, created_at))')
        .eq('module', 'flux')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }));
      return {
        tables: rows.map(table => ({
          id: table.id,
          name: table.name,
          icon: table.icon,
          items: withoutDuplicateItems(
            (table.flux_items || [])
              .sort((a, b) => (a.position - b.position) || String(b.updated_at).localeCompare(String(a.updated_at)))
              .map(fluxItemFromRow),
            ['movement', 'equipment', 'model', 'brand', 'senderCompany', 'destinationCompany', 'senderResponsible', 'receiverResponsible', 'sendDate', 'receivedDate', 'shippingType', 'situation', 'status', 'notes']
          )
        }))
      };
    },

    async createTable(values) {
      await init();
      const table = check(await client.from('module_tables').insert({
        module: 'flux', name: values.name.trim(), icon: values.icon || '📁', position: 0
      }).select().single());
      await this.moveTableToTop(table.id);
      return table;
    },

    async updateTable(id, values) {
      await init();
      const table = check(await client.from('module_tables').update({ name: values.name.trim() }).eq('id', id).select().single());
      await this.moveTableToTop(id);
      return table;
    },

    async deleteTable(id) {
      await init();
      check(await client.from('module_tables').delete().eq('id', id));
    },

    async moveTableToTop(id) {
      await init();
      const tables = check(await client.from('module_tables').select('id').eq('module', 'flux').order('position', { ascending: true }).order('created_at', { ascending: false }));
      const selected = tables.find(table => table.id === id);
      if (!selected) return;
      const ordered = [selected, ...tables.filter(table => table.id !== id)];
      await Promise.all(ordered.map((table, position) => client.from('module_tables').update({ position }).eq('id', table.id).then(check)));
    },

    async saveItem(tableId, values, existingId, logMessage) {
      await init();
      const payload = {
        table_id: tableId,
        movement: values.movement,
        equipment: values.equipment.trim(),
        model: values.model.trim(),
        brand: values.brand.trim(),
        sender_company: values.senderCompany.trim(),
        destination_company: values.destinationCompany.trim(),
        sender_responsible: values.senderResponsible.trim(),
        receiver_responsible: values.receiverResponsible.trim(),
        send_date: values.sendDate,
        received_date: values.receivedDate,
        shipping_type: values.shippingType,
        reason: values.situation,
        status: values.status,
        notes: storeItemPriority(values.notes, values.priority),
        position: 0
      };
      if (!existingId || hasOwn(values, 'serial')) payload.serial = String(values.serial || '').trim();
      if (!existingId || hasOwn(values, 'tag')) payload.tag = String(values.tag || '').trim();
      const result = existingId
        ? await client.from('flux_items').update(payload).eq('id', existingId).select().single()
        : await client.from('flux_items').insert(payload).select().single();
      const saved = check(result);
      check(await client.from('flux_item_logs').insert({
        flux_item_id: saved.id,
        action: existingId ? 'update' : 'create',
        message: logMessage || (existingId ? 'Movimentação atualizada.' : 'Movimentação adicionada ao Flux.')
      }));
      await this.moveTableToTop(tableId);
      await recordItemActivity({
        module: 'flux',
        itemId: saved.id,
        operation: existingId ? 'update' : 'create',
        description: logMessage || (existingId ? 'Movimentação atualizada.' : 'Movimentação adicionada ao Flux.')
      });
      return saved;
    },

    async addLog(itemId, message) {
      await init();
      const saved = check(await client.from('flux_item_logs').insert({ flux_item_id: itemId, action: 'update', message: message.trim() }).select().single());
      const context = await itemActivityContext('flux', itemId);
      await this.moveTableToTop(context.table_id);
      await recordItemActivity({ module: 'flux', itemId, operation: 'log', description: message.trim(), context });
      return saved;
    },

    async updateLog(id, message) {
      await init();
      const saved = check(await client.from('flux_item_logs').update({ message: message.trim() }).eq('id', id).select('id, flux_item_id').single());
      const context = await itemActivityContext('flux', saved.flux_item_id);
      await this.moveTableToTop(context.table_id);
      await recordItemActivity({ module: 'flux', itemId: saved.flux_item_id, operation: 'log', description: `Log editado: ${message.trim()}`, context });
      return saved;
    },

    async deleteLog(id) {
      await init();
      const log = check(await client.from('flux_item_logs').select('flux_item_id').eq('id', id).single());
      const deleted = check(await client.from('flux_item_logs').delete().eq('id', id).select('id'));
      if (!deleted?.length) fail('O registro não foi excluído. Atualize a página e tente novamente.');
      const context = await itemActivityContext('flux', log.flux_item_id);
      await this.moveTableToTop(context.table_id);
      await recordItemActivity({ module: 'flux', itemId: log.flux_item_id, operation: 'log', description: 'Log excluído.', context });
    },

    async deleteItem(id) {
      await init();
      let context;
      try { context = await itemActivityContext('flux', id); }
      catch (error) { console.warn('Não foi possível preparar o histórico da exclusão.', error); }
      check(await client.from('flux_items').delete().eq('id', id));
      if (context) {
        await this.moveTableToTop(context.table_id);
        await recordItemActivity({ module: 'flux', itemId: id, operation: 'delete', description: 'Movimentação excluída do Flux.', context });
      }
    },

    async replace(snapshot) {
      await init();
      const existing = check(await client.from('module_tables').select('id').eq('module', 'flux'));
      if (existing.length) check(await client.from('module_tables').delete().in('id', existing.map(table => table.id)));
      const restoredTables = [];
      for (const sourceTable of snapshot.tables || []) {
        const table = await this.createTable(sourceTable);
        restoredTables.push(table.id);
        const restoredItems = [];
        for (const sourceItem of sourceTable.items || []) {
          const restored = check(await client.from('flux_items').insert({
            table_id: table.id,
            movement: sourceItem.movement || 'Envio',
            equipment: sourceItem.equipment,
            model: sourceItem.model,
            brand: sourceItem.brand,
            serial: sourceItem.serial,
            tag: sourceItem.tag,
            sender_company: sourceItem.senderCompany,
            destination_company: sourceItem.destinationCompany,
            sender_responsible: sourceItem.senderResponsible,
            receiver_responsible: sourceItem.receiverResponsible,
            send_date: sourceItem.sendDate,
            received_date: sourceItem.receivedDate,
            shipping_type: sourceItem.shippingType || 'Motoboy',
            reason: sourceItem.situation || 'Manutenção',
            status: sourceItem.status || 'Pendente',
            notes: storeItemPriority(sourceItem.notes, sourceItem.priority),
            position: 0
          }).select().single());
          restoredItems.push(restored.id);
          const logs = sourceItem.logs?.length ? sourceItem.logs : [{ text: 'Movimentação restaurada a partir de backup.' }];
          check(await client.from('flux_item_logs').insert(logs.map(log => ({
            flux_item_id: restored.id,
            action: 'restore',
            message: log.at && log.at !== 'Backup antigo' ? `${log.at} — ${log.text || 'Histórico restaurado.'}` : (log.text || 'Histórico restaurado.')
          }))));
          await recordItemActivity({ module: 'flux', itemId: restored.id, operation: 'update', description: 'Movimentação restaurada a partir de backup.' });
        }
        await Promise.all(restoredItems.map((id, position) => client.from('flux_items').update({ position }).eq('id', id).then(check)));
      }
      await Promise.all(restoredTables.map((id, position) => client.from('module_tables').update({ position }).eq('id', id).then(check)));
      return this.load();
    }
  };

  const controlBackups = {
    async list(limit = 3) {
      await init();
      return check(await client.from('control_backups').select('id, label, snapshot, source, created_at').order('created_at', { ascending: false }).limit(Math.min(limit, 3)));
    },
    async latest() {
      await init();
      const rows = check(await client.from('control_backups').select('id, label, snapshot, source, created_at').order('created_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    async create(snapshot, label = 'Backup do Controle TI', source = 'network') {
      await init();
      const row = check(await client.from('control_backups').insert({ label, snapshot, source }).select().single());
      const outdated = check(await client.from('control_backups').select('id').order('created_at', { ascending: false }).range(3, 1000));
      if (outdated.length) check(await client.from('control_backups').delete().in('id', outdated.map(backup => backup.id)));
      await events.record('control', 'backup', { backup_id: row.id });
      return row;
    },
    async settings() {
      await init();
      const setting = check(await client.from('control_backup_settings').select('automatic, updated_at').maybeSingle());
      return setting || { automatic: false, updated_at: null };
    },
    async setAutomatic(automatic) {
      await init();
      return check(await client.from('control_backup_settings').upsert({ setting_key: 'global', automatic: Boolean(automatic) }).select().single());
    }
  };

  const fluxBackups = {
    async list(limit = 3) {
      await init();
      return check(await client.from('flux_backups').select('id, label, snapshot, source, created_at').order('created_at', { ascending: false }).limit(Math.min(limit, 3)));
    },
    async latest() {
      await init();
      const rows = check(await client.from('flux_backups').select('id, label, snapshot, source, created_at').order('created_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    async create(snapshot, label = 'Backup do Flux', source = 'network') {
      await init();
      const row = check(await client.from('flux_backups').insert({ label, snapshot, source }).select().single());
      const outdated = check(await client.from('flux_backups').select('id').order('created_at', { ascending: false }).range(3, 1000));
      if (outdated.length) check(await client.from('flux_backups').delete().in('id', outdated.map(backup => backup.id)));
      await events.record('flux', 'backup', { backup_id: row.id });
      return row;
    },
    async settings() {
      await init();
      const setting = check(await client.from('flux_backup_settings').select('automatic, updated_at').maybeSingle());
      return setting || { automatic: false, updated_at: null };
    },
    async setAutomatic(automatic) {
      await init();
      return check(await client.from('flux_backup_settings').upsert({ setting_key: 'global', automatic: Boolean(automatic) }).select().single());
    }
  };

  const agenda = {
    async load() {
      await init();
      const cleanup = await client.rpc('purge_expired_agenda_entries');
      if (cleanup.error && !missingAgendaRetentionFunction(cleanup.error)) {
        console.warn('Não foi possível remover os agendamentos expirados.', cleanup.error);
      }
      let response = await client.from('agenda_entries')
        .select('id, kind, title, due_date, due_time, reminder_minutes, priority, notes, is_completed, completed_at')
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true });
      const priorityUnavailable = missingPriorityColumn(response.error);
      const completionUnavailable = missingAgendaCompletionColumn(response.error);
      if (priorityUnavailable || completionUnavailable) {
        const columns = ['id', 'kind', 'title', 'due_date', 'due_time', 'reminder_minutes', 'notes'];
        if (!priorityUnavailable) columns.push('priority');
        if (!completionUnavailable) columns.push('is_completed', 'completed_at');
        response = await client.from('agenda_entries')
          .select(columns.join(', '))
          .order('due_date', { ascending: true })
          .order('due_time', { ascending: true });
      }
      const rows = check(response);
      return rows.map(row => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        date: row.due_date,
        time: row.due_time ? row.due_time.slice(0, 5) : '',
        reminder: row.reminder_minutes,
        priority: splitLegacyPriority(row.notes).priority || row.priority || 'normal',
        notes: splitLegacyPriority(row.notes).notes,
        completed: Boolean(row.is_completed),
        completedAt: row.completed_at || null
      }));
    },

    async save(entry) {
      await init();
      const payload = {
        kind: entry.kind,
        title: entry.title.trim(),
        due_date: entry.date,
        due_time: entry.time || null,
        reminder_minutes: Number(entry.reminder || 0),
        priority: entry.priority || 'normal',
        notes: entry.notes || ''
      };
      let result = entry.id
        ? await client.from('agenda_entries').update(payload).eq('id', entry.id).select().single()
        : await client.from('agenda_entries').insert(payload).select().single();
      if (missingPriorityColumn(result.error)) {
        const legacyPayload = { ...payload, notes: storeLegacyPriority(payload.notes, payload.priority) };
        delete legacyPayload.priority;
        result = entry.id
          ? await client.from('agenda_entries').update(legacyPayload).eq('id', entry.id).select().single()
          : await client.from('agenda_entries').insert(legacyPayload).select().single();
      }
      const row = check(result);
      return { ...entry, id: row.id, priority: entry.priority || 'normal' };
    },

    async remove(id) {
      await init();
      check(await client.from('agenda_entries').delete().eq('id', id));
    },

    async setCompleted(id, completed) {
      await init();
      const result = await client.rpc('set_agenda_entry_completion', {
        p_entry_id: id,
        p_completed: Boolean(completed)
      }).single();
      if (missingAgendaCompletionFunction(result.error)) {
        fail('A conclusão de tarefas e eventos precisa das migrações 028 e 029 no banco de dados.');
      }
      const row = check(result);
      return { id: row.id, completed: Boolean(row.is_completed), completedAt: row.completed_at || null };
    }
  };

  const backups = {
    async list(limit = 3) {
      await init();
      return check(await client.from('inventory_backups')
        .select('id, label, snapshot, source, created_at')
        .order('created_at', { ascending: false }).limit(Math.min(limit, 3)));
    },
    async latest() {
      await init();
      const rows = check(await client.from('inventory_backups')
        .select('id, label, snapshot, source, created_at')
        .order('created_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    async create(snapshot, label = 'Backup do Inventário', source = 'network') {
      await init();
      const row = check(await client.from('inventory_backups').insert({ label, snapshot, source }).select().single());
      const outdated = check(await client.from('inventory_backups').select('id').order('created_at', { ascending: false }).range(3, 1000));
      if (outdated.length) check(await client.from('inventory_backups').delete().in('id', outdated.map(backup => backup.id)));
      await events.record('inventory', 'backup', { backup_id: row.id });
      return row;
    },
    async settings() {
      await init();
      const setting = check(await client.from('inventory_backup_settings').select('automatic, updated_at').maybeSingle());
      return setting || { automatic: false, updated_at: null };
    },
    async setAutomatic(automatic) {
      await init();
      return check(await client.from('inventory_backup_settings').upsert({ setting_key: 'global', automatic: Boolean(automatic) }).select().single());
    }
  };

  const nfeReasonValues = ['Erro no SASII', 'Erro no Pin Pad', 'Travamento do PC', 'Erro no cartão'];
  const nfeRow = row => ({
    id: row.id,
    operator: row.operator || '',
    operatorCode: row.operator_code || '',
    fiscal: row.fiscal || '',
    occurredAt: row.occurred_at || '',
    pdv: row.pdv || '',
    nfeNumber: row.nfe_number || '',
    reason: row.reason || '',
    notes: row.notes || '',
    pdfPath: row.pdf_path || '',
    pdfName: row.pdf_name || '',
    pdfSize: Number(row.pdf_size || 0),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || row.created_at || ''
  });
  const nfePayload = values => ({
    operator: String(values.operator || '').trim(),
    operator_code: String(values.operatorCode || '').trim(),
    fiscal: String(values.fiscal || '').trim(),
    occurred_at: String(values.occurredAt || ''),
    pdv: String(values.pdv || '').trim(),
    nfe_number: String(values.nfeNumber || '').trim(),
    reason: String(values.reason || '').trim(),
    notes: String(values.notes || '').trim(),
    pdf_path: String(values.pdfPath || '').trim(),
    pdf_name: String(values.pdfName || '').trim(),
    pdf_size: Number(values.pdfSize || 0)
  });
  const nfeSafeFileName = name => String(name || 'documento.pdf').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'documento.pdf';
  const nfeCurrentUser = async () => {
    const { data, error } = await client.auth.getUser();
    if (error) fail(error.message);
    if (!data?.user?.id) fail('Sua sessão expirou. Entre novamente.');
    return data.user;
  };

  const nfe = {
    reasons: nfeReasonValues,
    async load(filters = {}) {
      await init();
      const page = Math.max(1, Number(filters.page || 1));
      const pageSize = Math.min(50, Math.max(10, Number(filters.pageSize || 15)));
      let request = client.from('nfe_occurrences')
        .select('id, operator, operator_code, fiscal, occurred_at, pdv, nfe_number, reason, notes, pdf_path, pdf_name, pdf_size, created_at, updated_at', { count: 'exact' })
        .order('occurred_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);
      const term = String(filters.query || '').trim().replace(/[(),]/g, ' ').slice(0, 80);
      if (term) {
        const match = `%${term}%`;
        request = request.or(`operator.ilike.${match},operator_code.ilike.${match},fiscal.ilike.${match},pdv.ilike.${match},nfe_number.ilike.${match},reason.ilike.${match}`);
      }
      if (filters.reason) request = request.eq('reason', filters.reason);
      if (filters.pdv) request = request.ilike('pdv', `%${String(filters.pdv).trim()}%`);
      if (filters.operator) request = request.ilike('operator', `%${String(filters.operator).trim()}%`);
      if (filters.dateFrom) request = request.gte('occurred_at', `${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) request = request.lte('occurred_at', `${filters.dateTo}T23:59:59`);
      const { data, error, count } = await request;
      if (error) fail(error.message);
      return { items: (data || []).map(nfeRow), count: Number(count || 0), page, pageSize };
    },

    async all(filters = {}) {
      await init();
      let request = client.from('nfe_occurrences')
        .select('id, operator, operator_code, fiscal, occurred_at, pdv, nfe_number, reason, notes, pdf_path, pdf_name, pdf_size, created_at, updated_at')
        .order('occurred_at', { ascending: false })
        .limit(5000);
      const term = String(filters.query || '').trim().replace(/[(),]/g, ' ').slice(0, 80);
      if (term) {
        const match = `%${term}%`;
        request = request.or(`operator.ilike.${match},operator_code.ilike.${match},fiscal.ilike.${match},pdv.ilike.${match},nfe_number.ilike.${match},reason.ilike.${match}`);
      }
      if (filters.reason) request = request.eq('reason', filters.reason);
      if (filters.pdv) request = request.ilike('pdv', `%${String(filters.pdv).trim()}%`);
      if (filters.operator) request = request.ilike('operator', `%${String(filters.operator).trim()}%`);
      if (filters.dateFrom) request = request.gte('occurred_at', `${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) request = request.lte('occurred_at', `${filters.dateTo}T23:59:59`);
      return check(await request).map(nfeRow);
    },

    async dashboard() {
      await init();
      const { data, error } = await client.rpc('nfe_dashboard_metrics');
      if (error) fail(error.message);
      return data || { total: 0, today: 0, month: 0, reasons: {} };
    },

    async recurringPdvAlerts() {
      await init();
      const { data, error } = await client.rpc('nfe_recurring_pdv_alerts');
      if (error) fail(error.message);
      return (data || []).map(row => ({ id: row.occurrence_id, pdv: row.pdv, occurrences: Number(row.occurrences || 0), latestAt: row.latest_at }));
    },

    async get(id) {
      await init();
      const row = check(await client.from('nfe_occurrences')
        .select('id, operator, operator_code, fiscal, occurred_at, pdv, nfe_number, reason, notes, pdf_path, pdf_name, pdf_size, created_at, updated_at')
        .eq('id', id).single());
      const logs = check(await client.from('nfe_occurrence_logs')
        .select('id, action, details, created_at')
        .eq('occurrence_id', id).order('created_at', { ascending: false }).limit(100));
      return { item: nfeRow(row), logs };
    },

    async investigationHistory(filters = {}) {
      await init();
      const [items, alerts] = await Promise.all([this.all(filters), this.recurringPdvAlerts()]);
      const occurrenceIds = items.map(item => item.id);
      let resolutions = [];
      if (occurrenceIds.length) {
        resolutions = check(await client.from('nfe_investigation_resolutions')
          .select('id, occurrence_id, solution, pc_replacement, nfe_paid_pos, resolved_at, created_at, updated_at')
          .in('occurrence_id', occurrenceIds));
      }
      const byOccurrence = new Map(resolutions.map(row => [row.occurrence_id, {
        id: row.id,
        solution: row.solution || '',
        pcReplacement: Boolean(row.pc_replacement),
        nfePaidPos: Boolean(row.nfe_paid_pos),
        resolvedAt: row.resolved_at || row.updated_at || row.created_at || ''
      }]));
      const investigatePdvs = new Set(alerts.map(alert => String(alert.pdv || '').trim().toLocaleLowerCase('pt-BR')));
      return items.map(item => ({
        item,
        resolution: byOccurrence.get(item.id) || null,
        requiresInvestigation: investigatePdvs.has(String(item.pdv || '').trim().toLocaleLowerCase('pt-BR'))
      })).filter(entry => entry.requiresInvestigation || entry.resolution);
    },

    async saveInvestigationResolution(occurrenceId, values) {
      await init();
      const user = await nfeCurrentUser();
      const solution = String(values.solution || '').trim();
      if (solution.length < 3) fail('Informe a solução encontrada antes de salvar.');
      if (!['true', 'false'].includes(String(values.pcReplacement)) || !['true', 'false'].includes(String(values.nfePaidPos))) fail('Informe se houve troca do PC e pagamento em POS.');
      const row = check(await client.from('nfe_investigation_resolutions').upsert({
        occurrence_id: occurrenceId,
        solution,
        pc_replacement: String(values.pcReplacement) === 'true',
        nfe_paid_pos: String(values.nfePaidPos) === 'true',
        resolved_by: user.id,
        resolved_at: new Date().toISOString()
      }, { onConflict: 'occurrence_id' }).select().single());
      await events.record('nfe', 'resolve', { occurrenceId, pcReplacement: row.pc_replacement, nfePaidPos: row.nfe_paid_pos });
      return row;
    },

    async uploadPdf(file) {
      await init();
      if (!(file instanceof File)) fail('Anexe o PDF da NF-e para continuar.');
      if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) fail('Envie apenas um arquivo PDF.');
      if (!file.size || file.size > 10485760) fail('O PDF deve ter até 10 MB.');
      const id = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const path = `occurrences/${id}-${nfeSafeFileName(file.name)}`;
      const { error } = await client.storage.from('nfe-pdfs').upload(path, file, { contentType: 'application/pdf', upsert: false });
      if (error) fail(error.message);
      return { path, name: file.name, size: file.size };
    },

    async signedPdfUrl(path) {
      await init();
      if (!path) fail('O PDF desta ocorrência não está disponível.');
      const { data, error } = await client.storage.from('nfe-pdfs').createSignedUrl(path, 1800, { download: false });
      if (error) fail(error.message);
      return data.signedUrl;
    },

    async discardPdf(path) {
      await init();
      if (!path) return;
      const { error } = await client.storage.from('nfe-pdfs').remove([path]);
      if (error) console.warn('Não foi possível remover o PDF temporário da NF-e.', error);
    },

    async create(values) {
      await init();
      const user = await nfeCurrentUser();
      const row = check(await client.from('nfe_occurrences').insert({ ...nfePayload(values), created_by: user.id }).select().single());
      await events.record('nfe', 'create', { occurrenceId: row.id, pdv: row.pdv, nfeNumber: row.nfe_number, reason: row.reason });
      return nfeRow(row);
    },

    async update(id, values) {
      await init();
      const row = check(await client.from('nfe_occurrences').update(nfePayload(values)).eq('id', id).select().single());
      await events.record('nfe', 'update', { occurrenceId: row.id, pdv: row.pdv, nfeNumber: row.nfe_number, reason: row.reason });
      return nfeRow(row);
    },

    async remove(item) {
      await init();
      check(await client.from('nfe_occurrences').delete().eq('id', item.id));
      await events.record('nfe', 'delete', { occurrenceId: item.id, pdv: item.pdv, nfeNumber: item.nfeNumber, reason: item.reason });
    },

    async backups(limit = 3) {
      await init();
      return check(await client.from('nfe_backups').select('id, label, snapshot, source, created_at').order('created_at', { ascending: false }).limit(Math.min(limit, 3)));
    },

    async backupSnapshot() {
      await init();
      const [occurrences, resolutionResult] = await Promise.all([
        this.all(),
        client.from('nfe_investigation_resolutions').select('id, occurrence_id, solution, pc_replacement, nfe_paid_pos, resolved_by, resolved_at, created_at, updated_at')
      ]);
      const investigationResolutions = check(resolutionResult);
      return { occurrences, investigationResolutions };
    },

    async backupSettings() {
      await init();
      const setting = check(await client.from('nfe_backup_settings').select('automatic, frequency_days, updated_at').maybeSingle());
      return setting || { automatic: false, frequency_days: 7, updated_at: null };
    },

    async setBackupAutomatic(automatic) {
      await init();
      return check(await client.from('nfe_backup_settings').upsert({ setting_key: 'global', automatic: Boolean(automatic) }).select().single());
    },

    async createAutomaticBackupIfDue(settings = {}, latest = null) {
      if (!settings.automatic) return null;
      const frequencyDays = Math.max(1, Number(settings.frequency_days || 7));
      const latestTime = latest?.created_at ? new Date(latest.created_at).getTime() : 0;
      if (latestTime && Date.now() - latestTime < frequencyDays * 86400000) return null;
      return this.createBackup('Backup automático Fiscal NF-e', 'automatic');
    },

    async createBackup(label = 'Backup Fiscal NF-e', source = 'manual') {
      await init();
      const snapshot = await this.backupSnapshot();
      const row = check(await client.from('nfe_backups').insert({ label, source, snapshot }).select().single());
      const outdated = check(await client.from('nfe_backups').select('id').order('created_at', { ascending: false }).range(3, 1000));
      if (outdated.length) check(await client.from('nfe_backups').delete().in('id', outdated.map(backup => backup.id)));
      await events.record('nfe', 'backup', { backupId: row.id, source });
      return row;
    },

    async restoreBackup(backup) {
      await init();
      const rows = Array.isArray(backup?.snapshot?.occurrences) ? backup.snapshot.occurrences : null;
      if (!rows) fail('Este backup Fiscal NF-e é inválido.');
      const investigationResolutions = Array.isArray(backup?.snapshot?.investigationResolutions) ? backup.snapshot.investigationResolutions : [];
      check(await client.from('nfe_occurrences').delete().neq('id', '00000000-0000-0000-0000-000000000000'));
      if (rows.length) {
        const payload = rows.map(item => ({
          id: item.id, operator: item.operator, operator_code: item.operatorCode, fiscal: item.fiscal,
          occurred_at: item.occurredAt, pdv: item.pdv, nfe_number: item.nfeNumber, reason: item.reason,
          notes: item.notes || '', pdf_path: item.pdfPath, pdf_name: item.pdfName, pdf_size: item.pdfSize,
          created_at: item.createdAt || undefined, updated_at: item.updatedAt || undefined
        }));
        check(await client.from('nfe_occurrences').insert(payload));
      }
      if (investigationResolutions.length) {
        check(await client.from('nfe_investigation_resolutions').insert(investigationResolutions.map(resolution => ({
          id: resolution.id,
          occurrence_id: resolution.occurrence_id,
          solution: resolution.solution,
          pc_replacement: Boolean(resolution.pc_replacement),
          nfe_paid_pos: Boolean(resolution.nfe_paid_pos),
          resolved_by: resolution.resolved_by || null,
          resolved_at: resolution.resolved_at || undefined,
          created_at: resolution.created_at || undefined,
          updated_at: resolution.updated_at || undefined
        }))));
      }
      await events.record('nfe', 'restore', { backupId: backup.id });
    }
  };

  const events = {
    async record(module, operation, details = {}) {
      await init();
      // A falha do histórico não pode impedir a operação principal.
      const { error } = await client.from('sync_events').insert({ module, operation, details });
      if (error) console.warn('Não foi possível salvar o histórico de atividade.', error);
    },
    async recentActivity(limit = 12) {
      await init();
      return check(await client.from('sync_events')
        .select('id, module, operation, details, created_at')
        .in('operation', ['create', 'update', 'delete', 'log'])
        .order('created_at', { ascending: false })
        .limit(limit));
    }
  };

  const auditReports = {
    async activity({ period, cutoff } = {}) {
      await init();
      const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
      if (!match) fail('Informe um mês válido para a auditoria.');
      const year = Number(match[1]); const month = Number(match[2]);
      if (month < 1 || month > 12) fail('Informe um mês válido para a auditoria.');
      const periodStart = `${match[1]}-${match[2]}-01`;
      const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const safeCutoff = /^\d{4}-\d{2}-\d{2}$/.test(String(cutoff || '')) ? String(cutoff) : nextMonth;
      const exclusiveEnd = new Date(`${safeCutoff}T00:00:00Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      const rangeEnd = exclusiveEnd.toISOString();
      const rangeStart = `${periodStart}T00:00:00.000Z`;
      if (safeCutoff < periodStart || safeCutoff >= nextMonth) fail('A data de corte precisa pertencer ao mês selecionado.');
      const fetchAll = async createRequest => {
        const rows = []; const batchSize = 1000;
        for (let from = 0; ; from += batchSize) {
          const page = check(await createRequest().range(from, from + batchSize - 1));
          rows.push(...page);
          if (page.length < batchSize) return rows;
        }
      };
      const [agendaRows, activityRows] = await Promise.all([
        fetchAll(() => client.from('agenda_entries')
          .select('id, kind, title, due_date, due_time, priority, notes, completed_at')
          .eq('is_completed', true)
          .gte('completed_at', rangeStart)
          .lt('completed_at', rangeEnd)
          .order('completed_at', { ascending: false })),
        fetchAll(() => client.from('sync_events')
          .select('id, module, operation, details, created_at')
          .in('operation', ['create', 'update', 'delete', 'log'])
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd)
          .order('created_at', { ascending: false }))
      ]);
      const agendaEntries = agendaRows.map(row => ({
        id: row.id, kind: row.kind, title: row.title, dueDate: row.due_date, dueTime: row.due_time,
        priority: row.priority || splitLegacyPriority(row.notes).priority || 'normal', completedAt: row.completed_at
      }));
      const activities = activityRows.map(row => ({
        id: row.id, module: row.module, operation: row.operation, details: row.details || {}, occurredAt: row.created_at
      }));
      return { periodStart, cutoff: safeCutoff, agendaEntries, activities };
    },

    async list() {
      await init();
      return check(await client.from('monthly_audit_reports')
        .select('id, period_start, cutoff_date, status, summary, pdf_path, pdf_name, pdf_size, generated_at, finalized_at')
        .order('period_start', { ascending: false })
        .order('cutoff_date', { ascending: false }));
    },

    async save({ periodStart, cutoff, finalized, summary, pdf }) {
      await init();
      if (!(pdf instanceof Blob) || !pdf.size) fail('Não foi possível preparar o PDF da auditoria.');
      const month = String(periodStart || '').slice(0, 7);
      const fileName = `auditoria-${month}-${cutoff}.pdf`;
      const path = `${month.slice(0, 4)}/${month.slice(5, 7)}/${fileName}`;
      const { error: uploadError } = await client.storage.from('audit-reports').upload(path, pdf, {
        contentType: 'application/pdf', upsert: true
      });
      if (uploadError) fail(uploadError.message);
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) fail(userError.message);
      return check(await client.from('monthly_audit_reports').upsert({
        period_start: periodStart,
        cutoff_date: cutoff,
        status: finalized ? 'finalized' : 'draft',
        summary: summary || {},
        pdf_path: path,
        pdf_name: fileName,
        pdf_size: pdf.size,
        generated_by: userData.user?.id || null
      }, { onConflict: 'period_start,cutoff_date' }).select().single());
    },

    async download(report, download = true) {
      await init();
      const options = download ? { download: report.pdf_name || true } : {};
      const { data, error } = await client.storage.from('audit-reports').createSignedUrl(report.pdf_path, 120, options);
      if (error) fail(error.message);
      return data?.signedUrl || '';
    }
  };

  const notificationAcknowledgements = {
    async list() {
      await init();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) fail(sessionError.message);
      const userId = sessionData.session?.user?.id;
      if (!userId) return [];
      return check(await client.from('notification_acknowledgements')
        .select('state_key')
        .eq('user_id', userId));
    },

    async acknowledge({ module, itemId, stateKey }) {
      await init();
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) fail(sessionError.message);
      const userId = sessionData.session?.user?.id;
      if (!userId) fail('Sua sessão expirou. Entre novamente.');
      const { error } = await client.from('notification_acknowledgements').insert({
        user_id: userId,
        module: String(module || ''),
        item_id: itemId,
        state_key: String(stateKey || '')
      });
      // A mesma confirmação pode chegar em duas abas quase ao mesmo tempo.
      if (error && error.code !== '23505') fail(error.message);
    }
  };

  const auth = {
    async session() {
      await init();
      const { data, error } = await client.auth.getSession();
      if (error) fail(error.message);
      return data.session || null;
    },

    async state() {
      const session = await this.session();
      if (!session?.user) return { session: null, user: null, profile: null, isAdmin: false };
      let response = await client.from('profiles')
        .select('id, full_name, user_code, role, status, module_permissions, created_at, updated_at, last_sign_in_at')
        .eq('id', session.user.id).maybeSingle();
      if (response.error && /module_permissions/i.test(response.error.message || '')) {
        response = await client.from('profiles')
          .select('id, full_name, user_code, role, status, created_at, updated_at, last_sign_in_at')
          .eq('id', session.user.id).maybeSingle();
      }
      const profile = check(response);
      if (profile && !profile.module_permissions) profile.module_permissions = {};
      return { session, user: session.user, profile, isAdmin: profile?.role === 'admin' && profile?.status === 'active' };
    },

    async signIn(userCode, password) {
      await init();
      const response = await fetch('/api/auth-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userCode, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload.accountState === 'pending') return { accountState: 'pending' };
        fail(payload.error || 'Não foi possível entrar.');
      }
      const { data, error } = await client.auth.setSession(payload.session || {});
      if (error) fail(error.message);
      return data;
    },

    async signOut() {
      await init();
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) fail(error.message);
    },

    async api(path, options = {}) {
      const session = await this.session();
      if (!session?.access_token) fail('Sua sessão expirou. Entre novamente.');
      const response = await fetch(path, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) fail(payload.error || 'Não foi possível concluir esta operação.');
      return payload;
    },

    async register(values) {
      const response = await fetch('/api/auth-register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) fail(payload.error || 'Não foi possível enviar a solicitação.');
      return payload;
    },

    async bootstrapAdministrator() {
      const response = await fetch('/api/auth-bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) fail(payload.error || 'Administrador inicial não configurado.');
      return payload;
    },

    async updateOwnAccount(values) {
      return this.api('/api/account', { method: 'PATCH', body: values });
    },

    async listUsers() {
      return this.api('/api/admin-users');
    },

    async manageUser(values) {
      return this.api('/api/admin-users', { method: values.action === 'delete' ? 'DELETE' : 'PATCH', body: values });
    }
  };

  const realtime = {
    async subscribe(onChange) {
      await init();
      let channel = client.channel(`aldeckot-live-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      ['profiles', 'module_tables', 'inventory_items', 'inventory_item_logs', 'agenda_entries', 'module_records', 'control_items', 'control_item_logs', 'flux_items', 'flux_item_logs', 'nfe_occurrences', 'nfe_occurrence_logs', 'nfe_investigation_resolutions', 'nfe_backups', 'nfe_backup_settings', 'sync_events', 'monthly_audit_reports', 'notification_acknowledgements', 'equipment_identity_conflict_resolutions', 'inventory_backups', 'inventory_backup_settings', 'control_backups', 'control_backup_settings', 'flux_backups', 'flux_backup_settings', 'management_backups', 'management_backup_settings'].forEach(table => {
        channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
          try { onChange?.(payload); }
          catch (error) { console.warn('Falha ao processar uma atualização em tempo real.', error); }
        });
      });
      channel.subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Canal de atualizações em tempo real indisponível:', status);
      });
      return () => client.removeChannel(channel);
    }
  };

  const operations = {
    identityConflictKey(conflict = {}) {
      return ['identity', conflict.identity_kind, conflict.identity_value, conflict.conflict_type]
        .map(value => String(value || '').trim().toLocaleLowerCase('pt-BR'))
        .join(':');
    },

    async dashboard() {
      await init();
      const response = await client.rpc('operational_dashboard');
      if (response.error && /operational_dashboard|does not exist/i.test(response.error.message || '')) return null;
      return check(response) || null;
    },

    async identityConflicts() {
      await init();
      const response = await client.rpc('equipment_identity_conflicts');
      if (response.error && /equipment_identity_conflicts|does not exist/i.test(response.error.message || '')) return [];
      return check(response) || [];
    },

    async resolveIdentityConflict(conflict = {}) {
      await init();
      const conflictKey = this.identityConflictKey(conflict);
      if (!conflictKey || conflictKey === 'identity:::') fail('Conflito de conciliação inválido.');
      const response = await client.from('equipment_identity_conflict_resolutions').insert({
        conflict_key: conflictKey,
        identity_kind: String(conflict.identity_kind || ''),
        identity_value: String(conflict.identity_value || ''),
        conflict_type: String(conflict.conflict_type || '')
      });
      if (response.error && response.error.code !== '23505') fail(response.error.message);
    },

    async backupHealth() {
      const sources = [
        ['inventory', backups], ['management', managementBackups], ['control', controlBackups], ['flux', fluxBackups]
      ];
      const results = await Promise.all(sources.map(async ([module, source]) => {
        try {
          const [latest, settings] = await Promise.all([source.latest?.() || source.list?.(1).then(rows => rows[0] || null), source.settings?.() || Promise.resolve({ automatic: false })]);
          return { module, latest, automatic: Boolean(settings?.automatic), updatedAt: settings?.updated_at || null, ok: true };
        } catch (error) { return { module, latest: null, automatic: false, updatedAt: null, ok: false, error: error.message || 'Indisponível' }; }
      }));
      return results;
    }
  };

  const central = {
    async search(searchTerm) {
      await init();
      const term = String(searchTerm || '').trim().slice(0, 120);
      if (!term) return [];
      return check(await client.rpc('central_equipment_search', { search_term: term }));
    },

    async timeline(selection, matches = []) {
      await init();
      const rows = check(await client.rpc('central_equipment_timeline', {
        p_tag: String(selection?.tag || ''),
        p_serial: String(selection?.serial || ''),
        p_item_ids: matches.map(match => match.id).filter(Boolean)
      }));
      return rows.map(row => ({
        id: row.id,
        module: row.module,
        operation: row.operation,
        description: row.description,
        actor: row.actor || 'Equipe ALDECKOT',
        occurredAt: row.occurred_at,
        details: row.details || {}
      }));
    },

    async technicalHistory(matches = []) {
      await init();
      const inventoryIds = matches.filter(match => match.module === 'inventory').map(match => match.id).filter(Boolean);
      const managementIds = matches.filter(match => match.module === 'management').map(match => match.id).filter(Boolean);
      const controlIds = matches.filter(match => match.module === 'control').map(match => match.id).filter(Boolean);
      const fluxIds = matches.filter(match => match.module === 'flux').map(match => match.id).filter(Boolean);
      const [inventoryLogs, managementRecords, controlLogs, fluxLogs] = await Promise.all([
        inventoryIds.length
          ? client.from('inventory_item_logs').select('id, inventory_item_id, action, message, created_at').in('inventory_item_id', inventoryIds).order('created_at', { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        managementIds.length
          ? client.from('module_records').select('id, payload, updated_at, created_at').in('id', managementIds)
          : Promise.resolve({ data: [], error: null }),
        controlIds.length
          ? client.from('control_item_logs').select('id, control_item_id, action, message, created_at').in('control_item_id', controlIds).order('created_at', { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        fluxIds.length
          ? client.from('flux_item_logs').select('id, flux_item_id, action, message, created_at').in('flux_item_id', fluxIds).order('created_at', { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null })
      ]);
      return [
        ...check(inventoryLogs).map(row => ({ id: row.id, module: 'inventory', operation: row.action, description: row.message, occurredAt: row.created_at })),
        ...check(managementRecords).flatMap(row => (Array.isArray(row.payload?.logs) ? row.payload.logs : []).map((log, index) => ({
          id: log.id || `${row.id}-${index}`, module: 'management', operation: 'update', description: log.text || log.action || 'Equipamento atualizado na Gestão TI.',
          occurredAt: log.at || log.createdAt || log.timestamp || row.updated_at || row.created_at
        }))),
        ...check(controlLogs).map(row => ({ id: row.id, module: 'control', operation: row.action, description: row.message, occurredAt: row.created_at })),
        ...check(fluxLogs).map(row => ({ id: row.id, module: 'flux', operation: row.action, description: row.message, occurredAt: row.created_at }))
      ].sort((first, second) => String(second.occurredAt).localeCompare(String(first.occurredAt)));
    },

    async subscribe(onChange) {
      return realtime.subscribe(onChange);
    }
  };

  window.AldeckotSupabase = { configured, init, auth, realtime, inventory, management, control, flux, nfe, agenda, backups, managementBackups, controlBackups, fluxBackups, events, auditReports, notificationAcknowledgements, operations, central };
})();
