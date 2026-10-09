(() => {
  const check = result => {
    if (result?.error) throw result.error;
    return result?.data;
  };
  const client = async () => (await window.AldeckotSupabase.init()).client;
  const rpc = async (name, args) => check(await (await client()).rpc(name, args));
  const allPages = async build => {
    const results = [];
    for (let offset = 0; ; offset += 500) {
      const rows = check(await build(offset, offset + 499));
      results.push(...rows);
      if (rows.length < 500) return results;
    }
  };
  const unitSummaries = async db => {
    const query = (from, to, columns) => db.from('supply_units').select(columns).order('id').range(from, to);
    try { return await allPages((from, to) => query(from, to, 'id,supply_id,variant_id,status,updated_at,exited_at')); }
    catch (error) {
      if (!/42703|PGRST204|exited_at/i.test(`${error.code || ''} ${error.message || ''}`)) throw error;
      return allPages((from, to) => query(from, to, 'id,supply_id,variant_id,status,updated_at'));
    }
  };
  const list = async () => {
    const db = await client();
    const [rows, variants, units] = await Promise.all([
      allPages((from, to) => db.from('supply_stock_summary').select('*').order('updated_at', { ascending: false }).range(from, to)),
      allPages((from, to) => db.from('supply_variants').select('*').order('id').range(from, to)),
      unitSummaries(db)
    ]);
    const counts = new Map();
    for (const variant of variants) counts.set(variant.supply_id, (counts.get(variant.supply_id) || 0) + 1);
    return rows.map(row => window.AldeckotSupplyVariations.decorateLocal(
      { ...row, variant_count: counts.get(row.id) || 0 }, variants, units));
  };
  const inventorySnapshot = async () => {
    const db = await client();
    const tables = await allPages((from, to) => db.from('module_tables')
      .select('id,name,module').eq('module', 'inventory').range(from, to));
    if (!tables.length) return { tables, items: [] };
    const tableIds = tables.map(table => table.id);
    const items = await allPages((from, to) => db.from('inventory_items')
      .select('id,table_id,equipment,model,brand,serial,tag,sector,location,status,situation,notes,created_at,updated_at')
      .in('table_id', tableIds).order('id').range(from, to));
    return { tables, items };
  };
  const integrationReady = async () => {
    const result = await (await client()).from('equipment_sync_events').select('id').limit(1);
    if (result.error && /equipment_sync_events|42P01|PGRST205/i.test(`${result.error.code || ''} ${result.error.message || ''}`)) return false;
    check(result);
    return Array.isArray(result.data);
  };
  const inventoryHistory = async id => {
    const db = await client();
    return check(await db.from('inventory_item_logs').select('id,action,message,created_at')
      .eq('inventory_item_id', id).order('created_at', { ascending: false }).limit(200));
  };
  const inventoryGroupHistory = async ids => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return [];
    const db = await client();
    const requests = [];
    for (let offset = 0; offset < unique.length; offset += 80) {
      requests.push(db.from('inventory_item_logs')
        .select('id,inventory_item_id,action,message,created_at')
        .in('inventory_item_id', unique.slice(offset, offset + 80))
        .order('created_at', { ascending: false }).limit(200));
    }
    return (await Promise.all(requests)).flatMap(check)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200);
  };
  const inventoryReplacements = async id => {
    const db = await client();
    const result = await db.from('inventory_replacements')
      .select('id,removed_item_id,installed_item_id,removed_identity,installed_identity,removed_tag,installed_tag,previous_location,removed_location,removed_status,reason,created_at')
      .or(`removed_identity.eq.${id},installed_identity.eq.${id}`)
      .order('created_at', { ascending: false }).limit(100);
    if (result.error && (result.error.code === '42P01' || /inventory_replacements/i.test(result.error.message || '')))
      return { rows: [], unavailable: true };
    return { rows: check(result), unavailable: false };
  };
  const ensureInventoryCatalog = async groups => {
    const db = await client();
    const result = await db.rpc('supply_ensure_inventory_catalog_batch', { p_groups: groups });
    if (result.error && (result.error.code === 'PGRST202' || /supply_ensure_inventory_catalog_batch/i.test(result.error.message || '')))
      return false;
    check(result);
    return true;
  };
  const inventoryVariantMetadata = async () => {
    const db = await client();
    const result = await db.from('supply_variants')
      .select('id,supply_id,inventory_variant_key,minimum_stock,image_path,inactive,updated_at').not('inventory_variant_key', 'is', null).limit(1);
    if (result.error && /inventory_variant_key|42703|PGRST204/i.test(`${result.error.code || ''} ${result.error.message || ''}`))
      return { available: false, rows: [] };
    check(result);
    return { available: true, rows: await allPages((from, to) => db.from('supply_variants')
      .select('id,supply_id,inventory_variant_key,minimum_stock,image_path,inactive,updated_at')
      .not('inventory_variant_key', 'is', null).order('id').range(from, to)) };
  };
  const ensureInventoryVariants = async variants => {
    if (!variants.length) return true;
    const result = await (await client()).rpc('supply_ensure_inventory_variants_batch', { p_variants: variants });
    if (result.error && /supply_ensure_inventory_variants_batch|PGRST202/i.test(`${result.error.code || ''} ${result.error.message || ''}`)) return false;
    check(result);
    return true;
  };
  const detail = async id => {
    const db = await client();
    const [variants, units, movements, logs] = await Promise.all([
      db.from('supply_variants').select('*').eq('supply_id', id).order('created_at'),
      allPages((from, to) => db.from('supply_units').select('*').eq('supply_id', id)
        .order('updated_at', { ascending: false }).order('id').range(from, to)),
      db.from('supply_movements').select('*').eq('supply_id', id).order('created_at', { ascending: false }).limit(200),
      db.from('supply_logs').select('*').eq('supply_id', id).order('created_at', { ascending: false }).limit(200)
    ]);
    const unitRows = units;
    const maintenanceChunks = [];
    for (let start = 0; start < unitRows.length; start += 100) {
      const ids = unitRows.slice(start, start + 100).map(row => row.id);
      maintenanceChunks.push(allPages((from, to) => db.from('supply_maintenance_links')
        .select('*,control_items(id,table_id,equipment,status,entry_date,exit_date)')
        .in('supply_unit_id', ids).order('opened_at', { ascending: false }).range(from, to)));
    }
    const maintenance = (await Promise.all(maintenanceChunks)).flat()
      .sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')));
    return {
      variants: check(variants), units: unitRows, movements: check(movements),
      logs: check(logs), maintenance
    };
  };
  const logs = async id => check(await (await client()).from('supply_logs').select('*')
    .eq('supply_id', id).order('created_at', { ascending: false }).limit(200));
  const equipment = async () => {
    const db = await client();
    const [inventory, management] = await Promise.all([
      allPages((from,to) => db.from('inventory_items').select('id,table_id,equipment,tag,serial,model,location,sector').range(from,to)),
      allPages((from,to) => db.from('module_records').select('id,payload,module_tables!inner(module)').eq('module_tables.module','management').range(from,to))
    ]);
    return [
      ...inventory.map(row => ({ source: 'inventory', id: row.id, tableId: row.table_id, name: row.equipment, tag: row.tag, serial: row.serial, model: row.model, location: row.location || row.sector })),
      ...management.map(row => ({ source: 'management', id: row.id, name: row.payload?.equipment || row.payload?.name || 'Computador',
        tag: row.payload?.tag || '', serial: row.payload?.serial || '', model: row.payload?.model || '',
        location: row.payload?.location || row.payload?.area || '' }))
    ];
  };
  const availableReplacements = async category => {
    const db = await client();
    const query = (from, to, exitFilter) => {
      let request = db.from('supply_units')
      .select('id,code,supply_id,supplies!inner(name,category)')
      .eq('status','Em estoque').eq('supplies.category',category);
      if (exitFilter) request = request.is('exited_at', null);
      return request.range(from, to);
    };
    try { return await allPages((from, to) => query(from, to, true)); }
    catch (error) {
      if (!/42703|PGRST204|exited_at/i.test(`${error.code || ''} ${error.message || ''}`)) throw error;
      return allPages((from, to) => query(from, to, false));
    }
  };
  const maintenanceAlerts = async () => {
    const db = await client();
    return allPages((from,to) => db.from('supply_units')
      .select('id,code,supply_id,updated_at,supplies(name)')
      .eq('status','Manutenção').range(from,to));
  };
  const imageUrl = async path => {
    if (!path) return '';
    const db = await client();
    return check(await db.storage.from('supply-images').createSignedUrl(path, 3600))?.signedUrl || '';
  };
  const optimizedImage = async file => {
    if (typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 32000000)
        throw new Error('Dimensões da imagem inválidas ou excessivas.');
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Não foi possível preparar a imagem para envio.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const webp = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
      return webp?.type === 'image/webp' && webp.size < file.size ? webp : file;
    } catch { throw new Error('Não foi possível ler a imagem. Escolha um PNG, JPG ou WebP válido de até 5 MB.'); }
    finally { bitmap?.close?.(); }
  };
  const imageStillReferenced = async (db, path) => {
    const [supply, variant] = await Promise.all([
      db.from('supplies').select('id').eq('image_path', path).limit(1),
      db.from('supply_variants').select('id').eq('image_path', path).limit(1)
    ]);
    if (supply.error || variant.error) {
      console.warn('Não foi possível confirmar se a imagem ainda é utilizada; o arquivo foi preservado.');
      return true;
    }
    return Boolean(supply.data?.length || variant.data?.length);
  };
  const cleanupImage = async (db, path) => {
    if (!path) return true;
    if (await imageStillReferenced(db, path)) return false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await db.storage.from('supply-images').remove([path]);
      if (!result.error) return true;
    }
    console.warn('Imagem anterior permaneceu no Storage após duas tentativas de limpeza.');
    return false;
  };
  const uploadImage = async (target, id, file, previousPath) => {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 5242880)
      throw new Error('Selecione PNG, JPG ou WebP de até 5 MB.');
    const db = await client();
    const optimized = await optimizedImage(file);
    const extension = optimized.type === 'image/png' ? 'png' : optimized.type === 'image/webp' ? 'webp' : 'jpg';
    const digest = await crypto.subtle.digest('SHA-256', await optimized.arrayBuffer());
    const hash = [...new Uint8Array(digest)].slice(0, 16).map(value => value.toString(16).padStart(2, '0')).join('');
    const path = `${id}/${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}.${extension}`;
    if (path === previousPath) return path;
    const uploaded = await db.storage.from('supply-images').upload(path, optimized, { upsert: false, contentType: optimized.type });
    const reused = uploaded.error && (uploaded.error.statusCode === '409' || /already exists|duplicate/i.test(uploaded.error.message || ''));
    if (uploaded.error && !reused) throw uploaded.error;
    try {
      await rpc('supply_set_image', { p_target: target, p_id: id, p_path: path });
    } catch (error) {
      if (!reused) await cleanupImage(db, path);
      throw error;
    }
    if (previousPath && previousPath !== path) await cleanupImage(db, previousPath);
    return path;
  };
  const removeImage = async (target, id, previousPath) => {
    await rpc('supply_set_image', { p_target: target, p_id: id, p_path: null });
    if (previousPath) await cleanupImage(await client(), previousPath);
  };
  const installedFor = async (source, id) => {
    const db = await client();
    const field = source === 'inventory' ? 'installed_inventory_item_id' : 'installed_management_record_id';
    const query = await db.from('supply_units').select('id,code,status,supply_id,supplies(name,category,model)').eq(field, id).eq('status','Instalado');
    return check(query);
  };
  const relatedFor = async (source, id) => {
    const db = await client();
    const installedField = source === 'inventory' ? 'installed_inventory_item_id' : 'installed_management_record_id';
    const originField = source === 'inventory' ? 'origin_inventory_item_id' : 'origin_management_record_id';
    const [installed, maintenance] = await Promise.all([
      db.from('supply_units').select('id,code,status,supply_id,supplies(name,category,model)').eq(installedField,id).eq('status','Instalado'),
      db.from('supply_units').select('id,code,status,supply_id,supplies(name,category,model)').eq(originField,id).eq('status','Manutenção')
    ]);
    return { installed: check(installed), maintenance: check(maintenance) };
  };
  const maintenanceFor = async controlId => {
    const db = await client();
    const result = await db.from('supply_maintenance_links')
      .select('*,supply_units(id,code,status,supply_id,supplies(name,category,model))')
      .eq('control_item_id', controlId).maybeSingle();
    return check(result);
  };
  const subscribe = async onChange => {
    const db = await client();
    const channel = db.channel(`supplies-${crypto.randomUUID()}`);
    for (const table of ['supplies','supply_variants','supply_units','supply_movements','supply_logs','supply_maintenance_links','inventory_items','module_tables','inventory_item_logs']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
    }
    channel.subscribe();
    return () => db.removeChannel(channel);
  };
  const backup = {
    snapshot: () => rpc('supply_backup_snapshot', {}),
    async list() {
      return check(await (await client()).from('supply_backups')
        .select('id,label,source,created_at').order('created_at', { ascending: false }).limit(3));
    },
    async get(id) {
      return check(await (await client()).from('supply_backups')
        .select('id,label,source,created_at,snapshot').eq('id', id).single());
    },
    async create(snapshot, source = 'network') {
      const db = await client();
      const row = check(await db.from('supply_backups').insert({
        label: `Backup ${source === 'automatic' ? 'automático' : 'manual'} de Suprimentos`,
        source, snapshot
      }).select('id,label,source,created_at').single());
      const outdated = check(await db.from('supply_backups').select('id').order('created_at', { ascending: false }).range(3, 1000));
      if (outdated.length) check(await db.from('supply_backups').delete().in('id', outdated.map(item => item.id)));
      return row;
    },
    async settings() {
      return check(await (await client()).from('supply_backup_settings')
        .select('automatic,frequency_days,updated_at').eq('setting_key', 'global').maybeSingle())
        || { automatic: false, frequency_days: 7 };
    },
    async setAutomatic(automatic) {
      return check(await (await client()).from('supply_backup_settings')
        .upsert({ setting_key: 'global', automatic: Boolean(automatic), updated_at: new Date().toISOString() }).select().single());
    },
    async setFrequency(value) {
      const days = Number(value);
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Informe uma frequência entre 1 e 90 dias.');
      return check(await (await client()).from('supply_backup_settings')
        .upsert({ setting_key: 'global', frequency_days: days, updated_at: new Date().toISOString() }).select().single());
    }
  };
  window.AldeckotSupplies = {
    list, detail, logs, inventorySnapshot, inventoryHistory, inventoryGroupHistory, inventoryReplacements, ensureInventoryCatalog,
    inventoryVariantMetadata, ensureInventoryVariants,
    equipment, availableReplacements, maintenanceAlerts, imageUrl, uploadImage, removeImage, installedFor, relatedFor, maintenanceFor, subscribe, integrationReady,
    backup,
    saveItem: row => rpc('supply_save_item', row),
    saveVariant: row => rpc('supply_save_variant', row),
    saveLocalVariant: row => rpc('supply_save_local_variant', row),
    setInventoryVariantMinimum: (id, minimum) => rpc('supply_set_inventory_variant_minimum', { p_variant_id: id, p_minimum_stock: minimum }),
    setVariantActive: row => rpc('supply_set_variant_active', row),
    deleteItem: row => rpc('supply_delete_item', row),
    adjustQuantity: row => rpc('supply_adjust_quantity', row),
    createUnit: row => rpc('supply_create_unit', row),
    createUnits: async row => {
      try { return await rpc('supply_create_units_batch', row); }
      catch (error) {
        if (error.code === 'PGRST202') {
          if (row.p_units.length === 1) {
            const unit = row.p_units[0];
            const id = await rpc('supply_create_unit', {
              p_supply_id: row.p_supply_id, p_variant_id: row.p_variant_id,
              p_code: unit.code || `UN-${crypto.randomUUID().replaceAll('-', '')}`,
              p_serial_number: unit.serialNumber, p_location: unit.location
            });
            return { ids: [id], legacy: true };
          }
          throw new Error('A entrada de várias unidades requer a migração 065 no banco de dados. Nenhuma unidade foi criada.');
        }
        throw error;
      }
    },
    exitUnits: async row => {
      try { return await rpc('supply_exit_units_batch', row); }
      catch (error) {
        if (error.code === 'PGRST202')
          throw new Error('A saída rastreável requer a migração 066 no banco de dados. Nenhuma unidade foi retirada.');
        throw error;
      }
    },
    editUnit: row => rpc('supply_edit_unit', row),
    transitionUnit: row => rpc('supply_transition_unit', row),
    replaceUnit: row => rpc('supply_replace_unit', row),
    setActive: row => rpc('supply_set_active', row),
    setMaintenanceStatus: row => rpc('supply_set_maintenance_status', row),
    completeMaintenance: row => rpc('supply_complete_maintenance', row)
  };
})();
