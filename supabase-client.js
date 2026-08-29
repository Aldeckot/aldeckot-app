/* global supabase */
(() => {
  let client;
  let user;
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
  const dateLabel = value => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
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
    notes: row.notes,
    date: row.updated_at ? row.updated_at.slice(0, 10) : '',
    updatedAt: row.updated_at || row.created_at || '',
    logs: (row.inventory_item_logs || [])
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map(log => ({ id: log.id, at: dateLabel(log.created_at), text: log.message }))
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
      const current = check(await client.auth.getSession());
      let session = current.session;
      if (!session) {
        const signed = check(await client.auth.signInAnonymously());
        session = signed.session;
      }
      if (!session?.user) fail('Não foi possível iniciar uma sessão segura no Supabase. Ative Anonymous Sign-Ins em Authentication > Providers.');
      user = session.user;
      return { client, user };
    })();
    try { return await bootPromise; }
    catch (error) { bootPromise = null; throw error; }
  }

  const inventory = {
    async load() {
      await init();
      const rows = check(await client
        .from('module_tables')
        .select('id, name, icon, position, created_at, inventory_items(id, equipment, model, brand, serial, tag, sector, location, status, situation, notes, position, created_at, updated_at, inventory_item_logs(id, message, created_at))')
        .eq('module', 'inventory')
        .order('position', { ascending: true })
        .order('created_at', { ascending: false }));
      return {
        tables: rows.map(table => ({
          id: table.id,
          name: table.name,
          icon: table.icon,
          items: (table.inventory_items || [])
            .sort((a, b) => (a.position - b.position) || String(b.updated_at).localeCompare(String(a.updated_at)))
            .map(itemFromRow)
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
        notes: values.notes || '',
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
      return saved;
    },

    async addLog(itemId, message) {
      await init();
      return check(await client.from('inventory_item_logs').insert({
        inventory_item_id: itemId,
        action: 'update',
        message: message.trim()
      }).select().single());
    },

    async updateLog(id, message) {
      await init();
      return check(await client.from('inventory_item_logs').update({
        message: message.trim()
      }).eq('id', id).select().single());
    },

    async deleteLog(id) {
      await init();
      check(await client.from('inventory_item_logs').delete().eq('id', id));
    },

    async deleteItem(id) {
      await init();
      check(await client.from('inventory_items').delete().eq('id', id));
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
            notes: sourceItem.notes || '',
            position: 0
          }).select().single());
          const logs = sourceItem.logs?.length ? sourceItem.logs : [{ text: 'Equipamento restaurado a partir de backup.' }];
          check(await client.from('inventory_item_logs').insert(logs.map(log => ({
            inventory_item_id: restored.id,
            action: 'restore',
            message: log.at && log.at !== 'Backup antigo' ? `${log.at} — ${log.text || 'Histórico restaurado.'}` : (log.text || 'Histórico restaurado.')
          }))));
        }
      }
      return this.load();
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
    async list(limit = 12) {
      await init();
      return check(await client.from('inventory_backups')
        .select('id, label, snapshot, source, created_at')
        .order('created_at', { ascending: false }).limit(limit));
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
      return check(await client.from('inventory_backup_settings').upsert({ owner_id: user.id, automatic: Boolean(automatic) }).select().single());
    }
  };

  const events = {
    async record(module, operation, details = {}) {
      await init();
      // A falha do histórico não pode impedir a operação principal.
      await client.from('sync_events').insert({ module, operation, details });
    }
  };

  window.AldeckotSupabase = { configured, init, inventory, agenda, backups, events };
})();
