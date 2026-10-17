/* Imagens por identidade de origem; nunca associa registros apenas por nome ou TAG. */
((root, factory) => {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AldeckotEquipmentImages = api;
})(typeof window !== 'undefined' ? window : null, root => {
  const managementPath = /^management\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;
  const signedUrls = new Map();
  let catalogPromise = null;
  let catalogLoadedAt = 0;

  const sourceOf = (item, module) => {
    if (!item) return null;
    if (module === 'control') {
      if (item.managementRecordId) return { kind: 'management', id: item.managementRecordId };
      if (item.inventoryItemId) return { kind: 'inventory', id: item.inventoryItemId };
      if (item.supplyUnitId) return { kind: 'supply', id: item.supplyUnitId };
      return null;
    }
    if (module === 'flux') {
      const kind = item.sourceModule;
      if (['management', 'inventory', 'control', 'flux', 'supplies'].includes(kind) && item.sourceRecordId)
        return { kind: kind === 'supplies' ? 'supply' : kind, id: item.sourceRecordId };
      if (item.inventoryItemId) return { kind: 'inventory', id: item.inventoryItemId };
    }
    return null;
  };
  const required = result => {
    if (result.error) throw result.error;
    return result.data;
  };
  const client = async () => (await root.AldeckotSupabase.init()).client;
  const pages = async query => {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const chunk = required(await query(offset, offset + 499)) || [];
      rows.push(...chunk);
      if (chunk.length < 500) return rows;
    }
  };
  async function inventoryCatalog(db) {
    if (!root.AldeckotInventoryImages) return null;
    if (!catalogPromise || Date.now() - catalogLoadedAt > 60000) {
      catalogPromise = Promise.all([
        pages((from, to) => db.from('supplies')
          .select('id,name,category,brand,model,inventory_group_key,image_path').order('id').range(from, to)),
        pages((from, to) => db.from('supply_variants')
          .select('id,supply_id,inventory_brand,inventory_model,inventory_variant_key,image_path')
          .not('image_path', 'is', null).order('id').range(from, to))
      ]).then(([supplies, variants]) => {
        catalogLoadedAt = Date.now();
        return root.AldeckotInventoryImages.build(supplies, variants);
      }).catch(error => { catalogPromise = null; throw error; });
    }
    return catalogPromise;
  }
  async function pathForSource(db, source, seen = new Set()) {
    if (!source?.id || seen.has(`${source.kind}:${source.id}`)) return null;
    seen.add(`${source.kind}:${source.id}`);
    if (source.kind === 'management') {
      const record = required(await db.from('module_records').select('payload').eq('id', source.id).maybeSingle());
      const path = record?.payload?.imagePath;
      return String(record?.payload?.equipment || '').trim() && managementPath.test(path || '') ? path : null;
    }
    if (source.kind === 'inventory') {
      const item = required(await db.from('inventory_items')
        .select('table_id,brand,model').eq('id', source.id).maybeSingle());
      if (!item) return null;
      const table = required(await db.from('module_tables').select('name').eq('id', item.table_id).maybeSingle());
      const catalog = await inventoryCatalog(db);
      return root.AldeckotInventoryImages?.pathFor(catalog, table?.name, item.brand, item.model) || null;
    }
    if (source.kind === 'supply') {
      const unit = required(await db.from('supply_units')
        .select('supply_id,variant_id').eq('id', source.id).maybeSingle());
      if (!unit) return null;
      const [variant, supply] = await Promise.all([
        unit.variant_id ? db.from('supply_variants').select('image_path').eq('id', unit.variant_id).maybeSingle().then(required) : null,
        db.from('supplies').select('image_path').eq('id', unit.supply_id).maybeSingle().then(required)
      ]);
      return variant?.image_path || supply?.image_path || null;
    }
    if (source.kind === 'control') {
      const item = required(await db.from('control_items')
        .select('management_record_id,inventory_item_id,supply_unit_id').eq('id', source.id).maybeSingle());
      return pathForSource(db, sourceOf({ managementRecordId: item?.management_record_id,
        inventoryItemId: item?.inventory_item_id, supplyUnitId: item?.supply_unit_id }, 'control'), seen);
    }
    if (source.kind === 'flux') {
      const item = required(await db.from('flux_items')
        .select('source_module,source_record_id,inventory_item_id').eq('id', source.id).maybeSingle());
      return pathForSource(db, sourceOf({ sourceModule: item?.source_module,
        sourceRecordId: item?.source_record_id, inventoryItemId: item?.inventory_item_id }, 'flux'), seen);
    }
    return null;
  }
  async function urlForPath(path) {
    if (!path) return '';
    const cached = signedUrls.get(path);
    if (cached && cached.expires > Date.now()) return cached.promise;
    const promise = client().then(async db => required(await db.storage.from('supply-images').createSignedUrl(path, 3600))?.signedUrl || '');
    signedUrls.set(path, { promise, expires: Date.now() + 55 * 60 * 1000 });
    promise.catch(() => { if (signedUrls.get(path)?.promise === promise) signedUrls.delete(path); });
    return promise;
  }
  async function urlForItem(item, module) {
    const source = sourceOf(item, module);
    if (!source) return '';
    const path = await pathForSource(await client(), source);
    return urlForPath(path);
  }
  return { sourceOf, pathForSource, urlForPath, urlForItem };
});
