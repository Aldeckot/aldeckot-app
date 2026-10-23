/* Consultas direcionadas da Home com RLS, paginação e erro separado de zero. */
(() => {
  const PAGE = 500;
  const MAX_PAGES = 100;
  let cache = { health: {} };
  let pending = null;
  const check = response => { if (response.error) throw response.error; return response.data || []; };
  async function all(build) {
    const result = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const rows = check(await build().range(page * PAGE, (page + 1) * PAGE - 1));
      result.push(...rows);
      if (rows.length < PAGE) return result;
    }
    throw new Error('A consulta ultrapassou o limite de leitura da Home. A consolidação requer consulta agregada para esta base.');
  }
  const camel = row => {
    const aliases = { table_id: 'tableId', created_at: 'createdAt', updated_at: 'updatedAt',
      management_computer_id: 'computerId', inventory_item_id: 'inventoryItemId',
      management_record_id: 'managementRecordId', entry_date: 'entryDate', exit_date: 'exitDate',
      followup_kind: 'followUpKind', verification_inventory_item_id: 'verificationInventoryItemId',
      verification_computer_id: 'verificationComputerId', verification_started_at: 'verificationStartedAt', verification_completed_at: 'verificationCompletedAt',
      received_date: 'receivedDate', occurred_at: 'occurredAt', nfe_number: 'nfeNumber',
      source_id: 'sourceId', source_module: 'module', previous_status: 'previousStatus', new_status: 'newStatus',
      event_id: 'eventId', processed_at: 'processedAt', error_message: 'errorMessage' };
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [aliases[key] || key, value]));
  };
  async function read(selected) {
    const next = { ...cache, health: { ...cache.health } };
    const { client } = await window.AldeckotSupabase.init();
    const tables = await all(() => client.from('module_tables').select('id,name,module').order('id'));
    next.tables = tables;
    const tableMap = new Map(tables.map(table => [table.id, table]));
    const sourceRows = (rows, module) => rows.filter(row => tableMap.get(row.table_id)?.module === module)
      .map(row => ({ ...camel(row), module, tableName: tableMap.get(row.table_id)?.name || '' }));
    const date = window.AldeckotHomeModel.dateKey();
    const month = window.AldeckotHomeModel.previousMonth(date.slice(0, 7)) + '-01T00:00:00-03:00';
    const inventoryColumns = 'id,table_id,equipment,model,brand,serial,tag,location,status,situation,created_at,updated_at';
    const jobs = {
      inventory: async () => sourceRows(await all(() => client.from('inventory_items').select(inventoryColumns).order('id')), 'inventory'),
      management: async () => !tables.some(table => table.module === 'management') ? [] : sourceRows(await all(() => client.from('module_records').select([
        'id,table_id,management_computer_id,created_at,updated_at',
        'equipment:payload->>equipment', 'tag:payload->>tag', 'serial:payload->>serial',
        'brand:payload->>brand', 'model:payload->>model', 'status:payload->>status',
        'situation:payload->>situation', 'terminal:payload->>terminal', 'location:payload->>location',
        'registeredAt:payload->>registeredAt'
      ].join(',')).in('table_id', tables.filter(table => table.module === 'management').map(table => table.id)).order('id')), 'management')
        .map(row => ({ ...row, createdAt: row.registeredAt || '' })),
      control: async () => {
        const columns = 'id,table_id,inventory_item_id,management_record_id,equipment,model,brand,serial,tag,status,entry_date,exit_date,notes,created_at,updated_at';
        let result;
        try {
          result = await all(() => client.from('control_items').select(columns
            + ',followup_kind,verification_inventory_item_id,verification_computer_id,verification_started_at,verification_completed_at').order('id'));
          next.capabilities = { ...next.capabilities, technicalVerification: true };
        } catch (error) {
          if (!/42703|PGRST204/.test(String(error.code || '')) || !/followup_kind|verification_/.test(error.message || '')) throw error;
          result = await all(() => client.from('control_items').select(columns).order('id'));
          next.capabilities = { ...next.capabilities, technicalVerification: false };
        }
        return sourceRows(result, 'control').map(row => ({ ...row,
          priority: /^\[\[aldeckot:item-priority:alta\]\]/i.test(row.notes || '') ? 'Alta' : /^\[\[aldeckot:item-priority:media\]\]/i.test(row.notes || '') ? 'Média' : 'Estável' }));
      },
      controlLogs: async () => (await all(() => client.from('control_item_logs')
        .select('id,control_item_id,action,created_at').order('id'))).map(row => ({ ...camel(row), controlItemId: row.control_item_id })),
      flux: async () => sourceRows(await all(() => client.from('flux_items').select(
        'id,table_id,equipment,model,brand,serial,tag,status,received_date,created_at,updated_at'
      ).order('id')), 'flux'),
      nfe: async () => (await all(() => client.from('nfe_occurrences').select(
        'id,nfe_number,pdv,reason,occurred_at,created_at,updated_at'
      ).gte('occurred_at', month).order('id'))).map(row => ({ ...camel(row), module: 'nfe' })),
      nfeRecurring: async () => {
        if (!window.AldeckotSupabase.nfe?.recurringPdvAlerts) throw new Error('Consulta de recorrências fiscais indisponível.');
        return window.AldeckotSupabase.nfe.recurringPdvAlerts();
      },
      events: async () => (await all(() => client.from('equipment_events').select([
        'id,source_module,source_id,inventory_item_id,action,previous_status,new_status,created_at',
        'controlItemId:metadata->>controlItemId', 'computerId:metadata->>computerId',
        'incomingComputerId:metadata->incoming->>id', 'outgoingComputerId:metadata->outgoing->>id'
      ].join(',')).gte('created_at', month).order('id'))).map(camel),
      effects: async () => (await all(() => client.from('equipment_event_effects').select(
        'id,event_id,module,status,processed_at,created_at,error_message'
      ).or('status.in.(pending,failed),processed_at.gte.' + month).order('id'))).map(camel),
      backups: async () => {
        const sources = ['inventory', 'management', 'control', 'flux', 'nfe'];
        const parts = await Promise.all(sources.map(async module => {
          const rows = check(await client.from(module + '_backups').select('id,label,source,created_at')
            .eq('source', 'automatic').order('created_at', { ascending: false }).limit(10));
          return rows.map(row => ({ ...camel(row), module }));
        }));
        return parts.flat();
      }
    };
    const requested = selected || [...Object.keys(jobs), 'stock'];
    await Promise.all(Object.entries(jobs).filter(([key]) => requested.includes(key)).map(async ([key, load]) => {
      try {
        next[key] = await load();
        next.health[key] = { unavailable: false, stale: false, loadedAt: new Date().toISOString() };
      } catch (error) {
        next.health[key] = { ...next.health[key], unavailable: !Array.isArray(next[key]), stale: Array.isArray(next[key]),
          error: 'Não foi possível consultar ' + key + '.', code: error.code || '' };
        console.warn('Home: fonte indisponível (' + key + ').', error.message || error);
      }
    }));
    if (requested.includes('stock')) {
      try {
        if (!Array.isArray(next.inventory) || next.health.inventory?.stale) throw new Error('Inventário sem atualização confirmada.');
        const [manual, variants, units] = await Promise.all([
          all(() => client.from('supply_stock_summary').select('id,name,category,brand,model,tracking_type,minimum_stock,quantity_stock,available_stock,total_units,inactive,inventory_group_key,updated_at').order('id')),
          all(() => client.from('supply_variants').select('id,supply_id,name,brand,model,minimum_stock,quantity_stock,inactive,inventory_variant_key').order('id')),
          all(() => client.from('supply_units').select('id,supply_id,variant_id,status,exited_at').order('id'))
        ]);
        const inventory = next.inventory.map(row => ({ ...row, table_id: row.tableId, updated_at: row.updatedAt }));
        const local = manual.map(row => window.AldeckotSupplyVariations.decorateLocal(row, variants, units));
        const groups = window.AldeckotInventorySupplies.groupInventory(tables, inventory);
        const projected = window.AldeckotInventorySupplies.project(local, groups, variants);
        next.stock = window.AldeckotSupplyVariations.alerts(projected);
        next.health.stock = { unavailable: false, stale: false, loadedAt: new Date().toISOString() };
      } catch (error) {
        next.health.stock = { unavailable: !Array.isArray(next.stock), stale: Array.isArray(next.stock),
          error: 'Não foi possível atualizar os saldos de Suprimentos.' };
        console.warn('Home: estoque indisponível.', error.message || error);
      }
    }
    next.loadedAt = new Date().toISOString();
    cache = next;
    return cache;
  }
  window.AldeckotHomeQueries = {
    async calendarMonth(month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) throw new Error('Mês inválido.');
      if (pending) await pending;
      const { client } = await window.AldeckotSupabase.init();
      const tables = cache.tables || await all(() => client.from('module_tables').select('id,name,module').order('id'));
      const names = new Map(tables.map(row => [row.id,row]));
      const start = month + '-01';
      const [year,number] = month.split('-').map(Number);
      const end = new Date(Date.UTC(year,number,1)).toISOString().slice(0,10);
      const readControl = extra => all(() => client.from('control_items')
        .select('id,table_id,equipment,model,brand,tag,serial,status,entry_date,updated_at' + extra)
        .gte('entry_date',start).lt('entry_date',end).order('id'));
      const controlRequest = readControl(',followup_kind').catch(error => {
        if (!/42703|PGRST204/.test(String(error.code || '')) || !/followup_kind/.test(error.message || '')) throw error;
        return readControl('');
      });
      const results = await Promise.allSettled([
        controlRequest,
        all(() => client.from('flux_items').select('id,table_id,equipment,brand,model,tag,serial,status,received_date,updated_at')
          .in('status',['Entregue','Recebido']).gte('received_date',start).lt('received_date',end).order('id')),
        all(() => client.from('nfe_occurrences').select('id,nfe_number,pdv,reason,occurred_at,updated_at')
          .gte('occurred_at',start + 'T00:00:00-03:00').lt('occurred_at',end + 'T00:00:00-03:00').order('id'))
      ]);
      const rowsFor = (index,module) => results[index].status === 'fulfilled'
        ? results[index].value.filter(row => module === 'nfe' || names.get(row.table_id)?.module === module)
          .map(row => ({ ...camel(row),module,tableName:names.get(row.table_id)?.name || '',
            ...(module === 'nfe' ? { equipment:'NF-e ' + row.nfe_number,detail:row.reason + ' · PDV ' + row.pdv } : {}) }))
        : null;
      const control = rowsFor(0,'control');
      return {
        maintenance: control?.filter(row => row.followUpKind !== 'verification') ?? null,
        technical: control?.filter(row => row.followUpKind === 'verification') ?? null,
        transfers: rowsFor(1,'flux'), fiscal: rowsFor(2,'nfe')
      };
    },
    async operationsPeriod(from, to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) || from > to)
        throw new Error('Informe um intervalo de datas válido para a Central de Operações.');
      const endDate = new Date(to + 'T12:00:00-03:00');
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      const end = window.AldeckotHomeModel.dateKey(endDate);
      const { client } = await window.AldeckotSupabase.init();
      const eventColumns = [
        'id,source_module,source_id,inventory_item_id,action,previous_status,new_status,created_at',
        'controlItemId:metadata->>controlItemId', 'computerId:metadata->>computerId',
        'incomingComputerId:metadata->incoming->>id', 'outgoingComputerId:metadata->outgoing->>id'
      ].join(',');
      const [events, nfe] = await Promise.all([
        all(() => client.from('equipment_events').select(eventColumns)
          .gte('created_at', from + 'T00:00:00-03:00').lt('created_at', end + 'T00:00:00-03:00').order('id')),
        all(() => client.from('nfe_occurrences').select('id,nfe_number,pdv,reason,occurred_at,created_at,updated_at')
          .gte('occurred_at', from + 'T00:00:00-03:00').lt('occurred_at', end + 'T00:00:00-03:00').order('id'))
      ]);
      return { from, to, events: events.map(camel), nfe: nfe.map(row => ({ ...camel(row), module:'nfe' })) };
    },
    load(selected) {
      if (pending) return pending;
      pending = read(selected).catch(error => {
        const keys = selected || ['inventory', 'management', 'control', 'controlLogs', 'flux', 'nfe', 'events', 'effects', 'backups', 'stock', 'nfeRecurring'];
        cache = { ...cache, health: { ...cache.health } };
        keys.forEach(key => { cache.health[key] = { unavailable: !Array.isArray(cache[key]), stale: Array.isArray(cache[key]),
          error: 'Conexão indisponível. Tente atualizar novamente.' }; });
        console.warn('Home: atualização não confirmada.', error.message || error);
        return cache;
      }).finally(() => { pending = null; });
      return pending;
    }
  };
})();
