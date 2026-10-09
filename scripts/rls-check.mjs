export const protectedTables = [
  'profiles', 'module_tables', 'inventory_items', 'control_items', 'flux_items',
  'sync_events', 'nfe_occurrences', 'supplies', 'supply_variants', 'supply_units',
  'supply_movements', 'supply_logs', 'supply_maintenance_links', 'supply_stock_summary'
];

export const anonymousReadBlocked = (status, payload) =>
  (status >= 200 && status < 300 && Array.isArray(payload) && payload.length === 0)
  || ([401, 403].includes(status) && payload?.code === '42501');
