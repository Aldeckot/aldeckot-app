/* Organizational branches never change an equipment's identity or physical location. */
(() => {
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
  const defaults = Object.freeze({
    balancas: ['Balanças de Checkout', 'Balanças de Setor'],
    impressoras: ['Impressoras de Checkout', 'Impressoras de Setor'],
    'maquinas de cartao': ['Pin Pads de PDV', 'Maquininhas de Cartão']
  });
  const namesFor = category => defaults[normalize(category)] || [];
  const proposal = (category, equipment) => {
    const names = namesFor(category);
    const name = normalize(equipment);
    if (!names.length || !name) return null;
    if (normalize(category) === 'balancas') return name.includes('balanca pdv') ? names[0] : names[1];
    if (normalize(category) === 'impressoras') return name === 'impressora termica' ? names[0] : names[1];
    return name === 'pin pad' ? names[0] : names[1];
  };
  const categoryForTable = table => {
    if (namesFor(table?.name).length) return table.name;
    for (const [category, names] of Object.entries(defaults)) {
      if ((table?.branches || []).some(branch => names.some(name => normalize(name) === normalize(branch.classificationKey)))) return category;
    }
    return table?.name;
  };
  const proposalForTable = (table, item) => proposal(categoryForTable(table), item?.equipment);
  const branchFor = (table, item) => {
    const branches = table?.branches || [];
    if (item?.branchId) return branches.find(branch => branch.id === item.branchId) || null;
    const suggested = proposalForTable(table, item);
    return suggested ? branches.find(branch => normalize(branch.classificationKey || branch.name) === normalize(suggested)) || null : null;
  };
  const branchesFor = (table, item) => {
    const primary = branchFor(table, item);
    const ids = new Set([primary?.id, ...(item?.sharedBranchIds || [])].filter(Boolean));
    return (table?.branches || []).filter(branch => ids.has(branch.id));
  };
  const inBranch = (table, item, branchId) => branchesFor(table, item).some(branch => branch.id === branchId);
  const lastChangedAt = item => {
    const times = [item?.updatedAt, ...(item?.logs || []).map(entry => entry.createdAt)]
      .map(value => Date.parse(value || '')).filter(Number.isFinite);
    return times.length ? Math.max(...times) : 0;
  };
  const latestEquipment = (items, limit = 5) => {
    const seen = new Set();
    return [...(items || [])]
      .sort((a, b) => lastChangedAt(b) - lastChangedAt(a) || String(a.id).localeCompare(String(b.id)))
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, limit);
  };
  const simulation = tables => {
    const rows = [];
    for (const table of tables || []) {
      for (const item of table.items || []) {
        const current = (table.branches || []).find(branch => branch.id === item.branchId)?.name || null;
        const proposed = proposalForTable(table, item);
        rows.push({ category: table.name, equipment: item.equipment, tag: item.tag,
          id: item.id, current, proposed, review: namesFor(categoryForTable(table)).length > 0 && !current && !proposed });
      }
    }
    const counts = {};
    for (const row of rows) {
      const key = `${row.category} / ${row.current || row.proposed || 'Sem ramificação'}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    return { total: rows.length, counts, pending: rows.filter(row => row.review), rows };
  };
  const api = { normalize, namesFor, categoryForTable, proposal, proposalForTable, branchFor, branchesFor, inBranch, lastChangedAt, latestEquipment, simulation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AldeckotInventoryBranches = api;
})();
