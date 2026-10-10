(() => {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  const priority = { inventory: 0, management: 1, control: 2, flux: 3 };
  const sourceLabel = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', flux: 'Histórico do Flux' };

  function canonicalId(row) {
    if (row.module === 'inventory') return row.id;
    const metadata = row.metadata || {};
    return row.inventory_item_id || metadata.inventoryItemId || metadata.inventory_item_id ||
      (metadata.sourceModule === 'inventory' ? metadata.sourceItemId : '') || '';
  }

  function prepare(rows, term) {
    const query = normalize(term);
    const ordered = (Array.isArray(rows) ? rows : []).filter(row => row?.id && priority[row.module] !== undefined)
      .sort((left, right) => {
        const exactLeft = normalize(left.tag) === query || normalize(left.serial) === query;
        const exactRight = normalize(right.tag) === query || normalize(right.serial) === query;
        return Number(exactRight) - Number(exactLeft) || priority[left.module] - priority[right.module] ||
          String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
      });
    const groups = [];
    for (const row of ordered) {
      const inventoryId = canonicalId(row);
      const tag = normalize(row.tag);
      const serial = normalize(row.serial);
      const signature = tag && serial ? `${tag}:${serial}` : '';
      let matching = inventoryId ? groups.filter(group => group.inventoryId === inventoryId) : [];
      // Série + TAG só unem origens diferentes se houver uma única identidade possível.
      if (!matching.length && signature) {
        const candidates = groups.filter(group => group.signature === signature);
        if (candidates.length === 1 && !candidates[0].modules.has(row.module) &&
            (!inventoryId || !candidates[0].inventoryId || candidates[0].inventoryId === inventoryId)) matching = candidates;
      }
      if (matching.length === 1) {
        matching[0].modules.add(row.module);
        if (inventoryId) matching[0].inventoryId = inventoryId;
      } else groups.push({ signature, inventoryId, modules: new Set([row.module]), row: {
        ...row,
        inventoryItemId: inventoryId || null,
        sourceLabel: sourceLabel[row.module]
      } });
    }
    const results = groups.map(group => ({ ...group.row, inventoryItemId: group.inventoryId || null }));
    const tagCounts = new Map();
    for (const row of results) {
      const tag = normalize(row.tag);
      if (tag) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    return results.map(row => ({ ...row, duplicateTag: (tagCounts.get(normalize(row.tag)) || 0) > 1 }));
  }

  const api = Object.freeze({ normalize, prepare });
  if (typeof window !== 'undefined') window.AldeckotFluxSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
