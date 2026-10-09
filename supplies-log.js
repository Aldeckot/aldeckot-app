/* Histórico de Suprimentos: apresenta eventos legíveis sem expor snapshots técnicos. */
((root, factory) => {
  const history = factory();
  if (typeof module === 'object' && module.exports) module.exports = history;
  if (root) root.AldeckotSupplyHistory = history;
})(typeof window !== 'undefined' ? window : null, () => {
  const fields = {
    name: 'Nome', category: 'Categoria', brand: 'Marca', model: 'Modelo',
    description: 'Descrição', tracking_type: 'Controle', minimum_stock: 'Estoque mínimo',
    quantity_stock: 'Quantidade', default_location: 'Local padrão', inactive: 'Situação', notes: 'Observações'
  };
  const parseSnapshot = value => {
    if (typeof value !== 'string' || !value.trim().startsWith('{')) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  };
  const readable = value => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
    return String(value).trim().slice(0, 100) || '—';
  };
  const plainValue = value => {
    const text = String(value || '').trim();
    if (!text || /^[{\[]/.test(text) || /(?:^|[\\/])[^\\/]+\.(?:png|jpe?g|webp|gif|avif)(?:\?.*)?$/i.test(text)) return '';
    return text.slice(0, 180);
  };
  const supplyEntry = (row, unit = null) => {
    const previous = parseSnapshot(row.old_value);
    const current = parseSnapshot(row.new_value);
    let message = '';
    if (previous && current) {
      const changes = Object.entries(fields)
        .filter(([key]) => JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null))
        .map(([key, label]) => `${label}: ${readable(previous[key])} → ${readable(current[key])}`);
      if (!changes.length) return null; // imagem e timestamps já têm eventos próprios
      message = changes.join(' · ');
    } else if (current) {
      message = current.name ? `Cadastro de ${readable(current.name)}.` : 'Cadastro criado.';
    } else if (previous) {
      message = previous.name ? `Cadastro de ${readable(previous.name)} removido.` : 'Cadastro removido.';
    } else {
      const oldValue = plainValue(row.old_value);
      const newValue = plainValue(row.new_value);
      message = oldValue && newValue ? `${oldValue} → ${newValue}` : newValue || oldValue;
      if (!message && /^[{\[]/.test(String(row.old_value || row.new_value || '').trim()))
        message = 'Dados do cadastro atualizados.';
    }
    return {
      id: row.id, source: 'Suprimentos', created_at: row.created_at,
      variant_id: row.variant_id || unit?.variant_id || null, supply_unit_id: row.supply_unit_id || null,
      title: row.action || 'Alteração registrada', message,
      context: plainValue(row.details), actor: row.actor_name || ''
    };
  };
  const inventoryEntry = (row, unit) => ({
    id: row.id, source: 'Inventário', created_at: row.created_at, variant_id: unit.variant_id || null,
    title: unit.tag || unit.serial || unit.equipment || 'Equipamento',
    message: String(row.message || '').trim() || 'Registro atualizado no Inventário.',
    context: [unit.brand, unit.model].filter(Boolean).join(' · '), actor: ''
  });
  const movementEntry = row => ({
    id: `movement:${row.id}`, source: 'Suprimentos', created_at: row.created_at,
    variant_id: row.variant_id || null, supply_unit_id: row.supply_unit_id || null,
    title: row.type === 'Entrada' ? 'Entrada de estoque' : row.type === 'Saída' ? 'Saída de estoque' : 'Estoque movimentado',
    message: `${Number(row.quantity || 0)} unidade(s) · ${Number(row.previous_stock || 0)} → ${Number(row.new_stock || 0)} disponíveis`,
    context: plainValue(row.reason), actor: row.actor_name || ''
  });
  const timeline = (supplyLogs, inventoryLogs = [], units = []) => {
    const byId = new Map(units.map(unit => [unit.id, unit]));
    return [
      ...supplyLogs.map(row => supplyEntry(row, byId.get(row.supply_unit_id))).filter(Boolean),
      ...inventoryLogs.filter(row => byId.has(row.inventory_item_id))
        .map(row => inventoryEntry(row, byId.get(row.inventory_item_id)))
    ].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  };
  return { timeline, supplyEntry, movementEntry };
});
