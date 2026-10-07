/* A projeção é somente leitura: cada unidade continua sendo um inventory_items.id. */
((root, factory) => {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  if (root) root.AldeckotInventorySupplies = catalog;
})(typeof window !== 'undefined' ? window : null, () => {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  const typeName = value => String(value || '').replace(/[^\p{L}\p{N}\s/-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const alias = value => {
    const name = normalize(typeName(value));
    return name.endsWith('s') && name.length > 3 ? name.slice(0, -1) : name;
  };
  const variantKey = item => `${normalize(item.brand)}\u001f${normalize(item.model)}`;
  const countStatus = (units, status) => units.filter(unit => unit.status === status).length;

  function groupInventory(tables, inventory) {
    const groups = new Map();
    const tableById = new Map(tables.filter(table => table.module === 'inventory').map(table => [table.id, table]));
    const seen = new Set();
    for (const item of inventory) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      const table = tableById.get(item.table_id);
      if (!table) continue;
      const name = typeName(table.name) || typeName(item.equipment) || 'Equipamentos';
      const key = normalize(name);
      if (!groups.has(key)) groups.set(key, { key, name, units: [], variants: [], tableIds: new Set() });
      const group = groups.get(key);
      group.tableIds.add(table.id);
      group.units.push({ ...item, status: item.status === 'Troca' ? 'Inativo' : item.status, source: 'inventory', code: item.tag || item.serial || item.equipment,
        serial_number: item.serial || '', physical_location: item.location || item.sector || '', table_id: table.id });
    }
    for (const group of groups.values()) {
      const variants = new Map();
      for (const unit of group.units) {
        const key = variantKey(unit);
        if (!variants.has(key)) variants.set(key, { id: `inventory:${group.key}:${encodeURIComponent(key)}`, name: unit.model?.trim() || 'Modelo não informado',
          model: unit.model || '', brand: unit.brand || '', image_path: null, units: [] });
        const variant = variants.get(key);
        variant.units.push(unit);
        unit.variant_id = variant.id;
      }
      group.variants = [...variants.values()].map(variant => ({ ...variant, total: variant.units.length,
        active: countStatus(variant.units, 'Ativo'), reserve: countStatus(variant.units, 'Reserva'),
        maintenance: countStatus(variant.units, 'Manutenção'), inactive: countStatus(variant.units, 'Inativo'),
        defect: countStatus(variant.units, 'Defeito') })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      group.total = group.units.length;
      group.active = countStatus(group.units, 'Ativo');
      group.reserve = countStatus(group.units, 'Reserva');
      group.maintenance = countStatus(group.units, 'Manutenção');
      group.inactive = countStatus(group.units, 'Inativo');
      group.defect = countStatus(group.units, 'Defeito');
      group.units.sort((a, b) => String(a.code).localeCompare(String(b.code), 'pt-BR'));
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function project(manualRows, groups) {
    const manual = [...manualRows];
    const used = new Set();
    const projected = groups.map(group => {
      const linked = manual.filter(row => !used.has(row.id) && row.inventory_group_key === group.key);
      const matches = linked.length ? linked : manual.filter(row => !used.has(row.id) && !row.inventory_group_key
        && Number(row.total_units || 0) === 0 && Number(row.available_stock || 0) === 0
        && Number(row.variant_count || 0) === 0
        && alias(row.name) === alias(group.name));
      const metadata = matches.length === 1 ? matches[0] : null;
      if (metadata) used.add(metadata.id);
      const minimum = Number(metadata?.minimum_stock || 0);
      const stockStatus = group.reserve === 0 ? 'Sem estoque'
        : group.reserve <= minimum ? 'Estoque baixo' : 'Normal';
      return { id: metadata?.id || `inventory:${group.key}`, inventory_group: group,
        source: 'inventory', name: group.name, category: 'Inventário',
        brand: '', model: '', description: metadata?.description || '',
        image_path: metadata?.image_path || null, tracking_type: 'inventory', minimum_stock: minimum,
        available_stock: group.reserve, active_count: group.active, total_units: group.total,
        default_location: '', inactive: false, stock_status: stockStatus,
        manual_id: metadata?.id || null, notes: metadata?.notes || '' };
    });
    return [...projected, ...manual.filter(row => !used.has(row.id))];
  }
  return { normalize, typeName, alias, groupInventory, project };
});
