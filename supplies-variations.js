/* Cálculos de leitura: o saldo operacional permanece nas tabelas de origem. */
((root, factory) => {
  const values = factory();
  if (typeof module === 'object' && module.exports) module.exports = values;
  if (root) root.AldeckotSupplyVariations = values;
})(typeof window !== 'undefined' ? window : null, () => {
  const available = units => units.filter(unit => unit.status === 'Em estoque' && !unit.exited_at).length;
  const exitEligible = (unit, variant) => unit?.status === 'Em estoque' && !unit.exited_at && !variant?.inactive;
  const counts = units => ({ total: units.length, reserve: available(units),
    active: units.filter(unit => unit.status === 'Instalado').length,
    maintenance: units.filter(unit => unit.status === 'Manutenção').length,
    defect: units.filter(unit => unit.status === 'Defeito').length,
    inactive: units.filter(unit => unit.status === 'Inativo').length });
  const latest = dates => dates.filter(Boolean).sort().at(-1) || '';
  const orderItems = items => [...items].sort((a, b) =>
    String(b.activity_at || b.updated_at || '').localeCompare(String(a.activity_at || a.updated_at || ''))
      || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  const unitsForVariant = (units, variant) => !variant ? units
    : units.filter(unit => variant.base ? !unit.variant_id : unit.variant_id === variant.id);
  function health(variant) {
    const stock = Math.max(0, Number(variant?.reserve || 0));
    const minimum = Math.max(0, Number(variant?.minimum_stock || 0));
    if (minimum === 0) return { tone: 'unconfigured', label: 'Mínimo não configurado' };
    if (stock < minimum) return { tone: 'below', label: `Faltam ${minimum - stock}` };
    if (stock === minimum) return { tone: 'at-minimum', label: 'No mínimo' };
    if (stock === minimum + 1) return { tone: 'one-above', label: 'Uma unidade acima do mínimo' };
    return { tone: 'healthy', label: 'Acima do mínimo' };
  }
  function localVariants(item, variants = [], units = []) {
    const bySupply = units.filter(unit => unit.supply_id === item.id);
    const rows = variants.filter(variant => variant.supply_id === item.id && !variant.inventory_variant_key)
      .map(variant => {
        const own = bySupply.filter(unit => unit.variant_id === variant.id);
        const stock = item.tracking_type === 'unit' ? available(own) : Number(variant.quantity_stock || 0);
        return { ...counts(own), ...variant, reserve: stock, total: item.tracking_type === 'unit' ? own.length : stock,
          minimum_stock: Number(variant.minimum_stock || 0), disabled: Boolean(variant.inactive), base: false,
          brand: variant.brand ?? item.brand ?? '', model: variant.model ?? variant.name };
      });
    const unassigned = bySupply.filter(unit => !unit.variant_id);
    const baseStock = item.tracking_type === 'unit' ? available(unassigned) : Number(item.quantity_stock || 0);
    const baseMinimum = Number(item.base_minimum_stock ?? item.minimum_stock ?? 0);
    if (baseStock || baseMinimum || unassigned.length || !rows.length) {
      rows.unshift({ ...counts(unassigned), id: `base:${item.id}`, supply_id: item.id,
        name: rows.length ? 'Sem variação' : item.model || item.name, model: item.model || '', brand: item.brand || '',
        image_path: null, minimum_stock: baseMinimum, reserve: baseStock,
        total: item.tracking_type === 'unit' ? unassigned.length : baseStock,
        disabled: Boolean(item.inactive), base: true });
    }
    return rows;
  }
  function decorateLocal(item, variants, units) {
    if (item.inventory_group_key) return item;
    const rows = localVariants(item, variants, units);
    const activity_at = latest([item.updated_at, ...rows.map(row => row.updated_at),
      ...units.filter(unit => unit.supply_id === item.id).map(unit => unit.updated_at)]);
    const minimum = rows.filter(row => !row.disabled).reduce((sum, row) => sum + row.minimum_stock, 0);
    const deficient = rows.some(row => !row.disabled && row.minimum_stock > 0 && row.reserve < row.minimum_stock);
    return { ...item, variation_rows: rows, activity_at, minimum_stock: minimum,
      stock_status: item.inactive ? 'Inativo' : deficient ? 'Estoque baixo'
        : Number(item.available_stock || 0) === 0 ? 'Sem estoque' : 'Normal' };
  }
  function alerts(items) {
    const result = [];
    for (const item of items.filter(row => !row.inactive)) {
      const variants = item.source === 'inventory' ? item.inventory_group.variants : item.variation_rows || [];
      for (const variant of variants) {
        const minimum = Number(variant.minimum_stock || 0);
        const stock = Number(variant.reserve || 0);
        if (!variant.disabled && minimum > 0 && stock < minimum)
          result.push({ itemId: item.id, itemName: item.name, variantId: variant.id,
            name: variant.name, brand: variant.brand || item.brand || '', model: variant.model || variant.name,
            stock, minimum, missing: minimum - stock });
      }
    }
    return result.sort((a, b) => Number(a.stock > 0) - Number(b.stock > 0)
      || b.missing - a.missing || a.itemName.localeCompare(b.itemName, 'pt-BR'));
  }
  return { localVariants, decorateLocal, alerts, health, orderItems, unitsForVariant, exitEligible };
});
