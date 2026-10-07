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
  const list = async () => {
    const db = await client();
    const [rows, variants] = await Promise.all([
      allPages((from, to) => db.from('supply_stock_summary').select('*').order('updated_at', { ascending: false }).range(from, to)),
      allPages((from, to) => db.from('supply_variants').select('id,supply_id').order('id').range(from, to))
    ]);
    const counts = new Map();
    for (const variant of variants) counts.set(variant.supply_id, (counts.get(variant.supply_id) || 0) + 1);
    return rows.map(row => ({ ...row, variant_count: counts.get(row.id) || 0 }));
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
  const detail = async id => {
    const db = await client();
    const [variants, units, movements, logs] = await Promise.all([
      db.from('supply_variants').select('*').eq('supply_id', id).order('created_at'),
      db.from('supply_units').select('*').eq('supply_id', id).order('code'),
      db.from('supply_movements').select('*').eq('supply_id', id).order('created_at', { ascending: false }).limit(200),
      db.from('supply_logs').select('*').eq('supply_id', id).order('created_at', { ascending: false }).limit(200)
    ]);
    const unitRows = check(units);
    const maintenance = unitRows.length
      ? await db.from('supply_maintenance_links').select('*,control_items(id,table_id,equipment,status,entry_date,exit_date)')
        .in('supply_unit_id', unitRows.map(row => row.id)).order('opened_at', { ascending: false })
      : { data: [], error: null };
    return {
      variants: check(variants), units: unitRows, movements: check(movements),
      logs: check(logs), maintenance: check(maintenance)
    };
  };
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
    return allPages((from,to) => db.from('supply_units')
      .select('id,code,supply_id,supplies!inner(name,category)')
      .eq('status','Em estoque').eq('supplies.category',category).range(from,to));
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
      const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const webp = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
      return webp?.type === 'image/webp' && webp.size < file.size ? webp : file;
    } catch { return file; }
    finally { bitmap?.close?.(); }
  };
  const uploadImage = async (target, id, file, previousPath) => {
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5242880)
      throw new Error('Selecione PNG, JPG ou WebP de até 5 MB.');
    const db = await client();
    const optimized = await optimizedImage(file);
    const extension = optimized.type === 'image/png' ? 'png' : optimized.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${id}/${crypto.randomUUID()}.${extension}`;
    check(await db.storage.from('supply-images').upload(path, optimized, { upsert: false, contentType: optimized.type }));
    try {
      await rpc('supply_set_image', { p_target: target, p_id: id, p_path: path });
    } catch (error) {
      await db.storage.from('supply-images').remove([path]);
      throw error;
    }
    if (previousPath) await db.storage.from('supply-images').remove([previousPath]);
    return path;
  };
  const removeImage = async (target, id, previousPath) => {
    await rpc('supply_set_image', { p_target: target, p_id: id, p_path: null });
    if (previousPath) await (await client()).storage.from('supply-images').remove([previousPath]);
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
    list, detail, inventorySnapshot, inventoryHistory, inventoryReplacements, ensureInventoryCatalog,
    equipment, availableReplacements, maintenanceAlerts, imageUrl, uploadImage, removeImage, installedFor, relatedFor, maintenanceFor, subscribe, integrationReady,
    backup,
    saveItem: row => rpc('supply_save_item', row),
    saveVariant: row => rpc('supply_save_variant', row),
    setVariantActive: row => rpc('supply_set_variant_active', row),
    deleteItem: row => rpc('supply_delete_item', row),
    adjustQuantity: row => rpc('supply_adjust_quantity', row),
    createUnit: row => rpc('supply_create_unit', row),
    editUnit: row => rpc('supply_edit_unit', row),
    transitionUnit: row => rpc('supply_transition_unit', row),
    replaceUnit: row => rpc('supply_replace_unit', row),
    setActive: row => rpc('supply_set_active', row),
    setMaintenanceStatus: row => rpc('supply_set_maintenance_status', row),
    completeMaintenance: row => rpc('supply_complete_maintenance', row)
  };
})();
