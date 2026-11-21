(() => {
  const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  const priority = { inventory: 0, management: 1, control: 2, flux: 3 };
  const sourceLabel = { inventory: 'Inventário', management: 'Gestão TI', control: 'Controle TI', flux: 'Histórico do Flux' };

  function inventoryIdFor(row) {
    if (row.module === 'inventory') return row.id;
    const metadata = row.metadata || {};
    return row.inventory_item_id || metadata.inventoryItemId || metadata.inventory_item_id ||
      (metadata.sourceModule === 'inventory' ? metadata.sourceItemId : '') || '';
  }

  function identityFor(row) {
    const inventoryId = inventoryIdFor(row);
    if (inventoryId) return { key: `inventory:${inventoryId}`, inventoryId };
    if (row.metadata?.computerId && ['management', 'control'].includes(row.module))
      return { key: `computer:${row.metadata.computerId}`, inventoryId: '' };
    if (row.module === 'flux' && row.metadata?.equipmentUid)
      return { key: `flux:${row.metadata.equipmentUid}`, inventoryId: '' };
    return { key: '', inventoryId: '' };
  }

  const unknown = new Set(['', '-', '—', '***', 'N/A', 'S/N', 'SEM TAG', 'SEM SÉRIE', 'NÃO INFORMADO', 'NÃO INFORMADA']);
  function legacySignature(row) {
    const tag = normalize(row.tag);
    const serial = normalize(row.serial);
    return unknown.has(tag) || unknown.has(serial) ? '' : JSON.stringify([tag, serial]);
  }

  function prepare(rows, term, { allowLegacyPair = true } = {}) {
    const query = normalize(term);
    const exact = row => normalize(row.tag) === query || normalize(row.serial) === query;
    const ordered = (Array.isArray(rows) ? rows : []).filter(row => row?.id && priority[row.module] !== undefined)
      .sort((left, right) => priority[left.module] - priority[right.module] ||
        Number(exact(right)) - Number(exact(left)) ||
        String(right.updated_at || '').localeCompare(String(left.updated_at || '')));
    const groups = [];
    const byIdentity = new Map();
    const legacy = [];
    function add(group, row) {
      group.rows.push(row);
      const signature = legacySignature(row);
      if (signature) group.signatures.add(signature);
    }
    function create(row, inventoryId) {
      const group = { rows: [], signatures: new Set(), inventoryId };
      add(group, row);
      groups.push(group);
      return group;
    }
    for (const row of ordered) {
      const { key, inventoryId } = identityFor(row);
      if (!key) { legacy.push(row); continue; }
      if (byIdentity.has(key)) add(byIdentity.get(key), row);
      else byIdentity.set(key, create(row, inventoryId));
    }
    // A fallback is only possible when one identity and one row per module share the pair.
    for (const row of legacy) {
      const signature = legacySignature(row);
      const matching = signature ? groups.filter(group => group.signatures.has(signature)) : [];
      const sameSource = signature && legacy.some(other =>
        other !== row && other.module === row.module && legacySignature(other) === signature);
      if (allowLegacyPair && !sameSource && matching.length === 1 && !matching[0].rows.some(other => other.module === row.module))
        add(matching[0], row);
      else create(row, '');
    }
    groups.sort((left, right) => Number(right.rows.some(exact)) - Number(left.rows.some(exact))
      || priority[left.rows[0].module] - priority[right.rows[0].module]);
    const results = groups.map(group => {
      const row = group.rows[0];
      return { ...row, inventoryItemId: group.inventoryId || null, sourceLabel: sourceLabel[row.module],
        modules: [...new Set(group.rows.map(member => member.module))], members: group.rows };
    });
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
