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
  const normalizedItemValue = value => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const meaningfulItemIdentity = value => {
    const normalized = normalizedItemValue(value);
    return ['', 'nao informado', 'sem tag', 'n/a', '-', '—'].includes(normalized) ? '' : normalized;
  };
  const withoutDuplicateItems = (items, fields) => {
    const seen = new Set();
    return items.filter(item => {
      const tag = meaningfulItemIdentity(item.tag);
      const serial = meaningfulItemIdentity(item.serial);
      const key = tag
        ? `tag:${tag}`
        : serial
          ? `serial:${serial}`
          : `record:${fields.map(field => normalizedItemValue(item[field])).join('\u001f')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const dateLabel = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const activityPage = module => ({ inventory: 'inventory.html', management: 'management.html', control: 'control.html', flux: 'flux.html' })[module] || '';
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
      .map(log => ({ id: log.id, at: dateLabel(log.created_at), createdAt: log.created_at, text: log.message }))
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
      const rows = check(await client
        .from('module_tables')
        .select('id, name, icon, position, created_at, inventory_items(id, equipment, model, brand, serial, tag, sector, location, status, situation, cleaning_type, notes, position, created_at, updated_at, inventory_item_logs(id, message, created_at))')
        .eq('module', 'inventory')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }));
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
        serial: values.serial || '',
        tag: values.tag || '',
        sector: values.sector || '',
        location: values.location || '',
        status: values.status,
        situation: values.situation,
        cleaning_type: values.cleaning || 'Não realizada',
        notes: storeItemPriority(values.notes, values.priority),
        position: 0
      };
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
      check(await client.from('inventory_item_logs').delete().eq('id', id));
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
        serial: values.serial || '',
        tag: values.tag || '',
        sector: values.sector || '',
        entry_date: values.entryDate || null,
        exit_date: values.exitDate || null,
        status: values.status,
        cleaning_type: values.situation,
        notes: storeItemPriority(values.notes, values.priority),
        position: 0
      };
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
      check(await client.from('control_item_logs').delete().eq('id', id));
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
        text: log.text || log.action || 'Registro atualizado.'
      })).sort((first, second) => String(second.at).localeCompare(String(first.at)))
    };
  };

  const managementRecordPayload = (item = {}, activityDescription = '') => ({
    equipment: String(item.equipment || '').trim(), tag: String(item.tag || '').trim(), brand: String(item.brand || '').trim(), model: String(item.model || '').trim(), serial: String(item.serial || '').trim(),
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
          ['equipment', 'model', 'brand', 'ip', 'hostname', 'area', 'sector', 'status', 'situation', 'cleaning', 'notes']
        )
      };
    },

    async save(item, existingId, activityDescription) {
      const table = await this.ensureTable();
      const payload = managementRecordPayload(item, activityDescription);
      const result = existingId
        ? await client.from('module_records').update({ payload, position: 0 }).eq('id', existingId).select('id, table_id, payload, position, created_at, updated_at').single()
        : await client.from('module_records').insert({ table_id: table.id, payload, position: 0 }).select('id, table_id, payload, position, created_at, updated_at').single();
      const saved = check(result);
      return managementItemFromRow(saved);
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
        serial: values.serial.trim(),
        tag: values.tag.trim(),
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
      check(await client.from('flux_item_logs').delete().eq('id', id));
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
      let response = await client.from('agenda_entries')
        .select('id, kind, title, due_date, due_time, reminder_minutes, priority, notes')
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true });
      if (missingPriorityColumn(response.error)) {
        response = await client.from('agenda_entries')
          .select('id, kind, title, due_date, due_time, reminder_minutes, notes')
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
        notes: splitLegacyPriority(row.notes).notes
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
      const profile = check(await client.from('profiles')
        .select('id, full_name, email, role, status, created_at, updated_at, last_sign_in_at')
        .eq('id', session.user.id).maybeSingle());
      return { session, user: session.user, profile, isAdmin: profile?.role === 'admin' && profile?.status === 'active' };
    },

    async signIn(email, password) {
      await init();
      const { data, error } = await client.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
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
      ['profiles', 'module_tables', 'inventory_items', 'inventory_item_logs', 'agenda_entries', 'module_records', 'control_items', 'control_item_logs', 'flux_items', 'flux_item_logs', 'sync_events', 'inventory_backups', 'inventory_backup_settings', 'control_backups', 'control_backup_settings', 'flux_backups', 'flux_backup_settings', 'management_backups', 'management_backup_settings'].forEach(table => {
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

  window.AldeckotSupabase = { configured, init, auth, realtime, inventory, management, control, flux, agenda, backups, managementBackups, controlBackups, fluxBackups, events, central };
})();
