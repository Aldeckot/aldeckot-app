import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = name => readFileSync(resolve(root, name), 'utf8');
const images = require(resolve(root, 'equipment-images.js'));
const home = require(resolve(root, 'module-home.js'));

test('imagem segue o vínculo real e dá prioridade ao PC no terminal', () => {
  assert.deepEqual(images.sourceOf({ managementRecordId: 'pc-1', inventoryItemId: 'inv-1' }, 'control'),
    { kind: 'management', id: 'pc-1' });
  assert.deepEqual(images.sourceOf({ inventoryItemId: 'inv-1', supplyUnitId: 'unit-1' }, 'control'),
    { kind: 'inventory', id: 'inv-1' });
  assert.deepEqual(images.sourceOf({ supplyUnitId: 'unit-1' }, 'control'),
    { kind: 'supply', id: 'unit-1' });
  assert.deepEqual(images.sourceOf({ sourceModule: 'management', sourceRecordId: 'pc-2', inventoryItemId: 'inv-2' }, 'flux'),
    { kind: 'management', id: 'pc-2' });
  assert.deepEqual(images.sourceOf({ sourceModule: 'control', sourceRecordId: 'maintenance-1' }, 'flux'),
    { kind: 'control', id: 'maintenance-1' });
  assert.equal(images.sourceOf({ equipment: 'PC sem vínculo', tag: 'TAG123' }, 'control'), null);
});

test('Controle TI e Flux resolvem a mesma foto do PC pela cadeia de IDs', async () => {
  const imagePath = 'management/12345678-1234-1234-1234-123456789abc.webp';
  const rows = {
    module_records: { pc: { payload: { equipment: 'PC instalado', imagePath } } },
    control_items: { maintenance: { management_record_id: 'pc', inventory_item_id: null, supply_unit_id: null } },
    flux_items: { transfer: { source_module: 'control', source_record_id: 'maintenance', inventory_item_id: null } },
    inventory_items: { monitor: { table_id: 'monitors', brand: 'Dell', model: 'E1916Hf' } },
    module_tables: { monitors: { name: 'MONITORES' } },
    supply_units: { unit: { supply_id: 'supply', variant_id: 'variant' } },
    supplies: { supply: { id: 'supply', name: 'MONITORES', category: 'MONITORES',
      inventory_group_key: 'MONITORES', brand: '', model: '', image_path: 'parent.webp' } },
    supply_variants: { variant: { id: 'variant', supply_id: 'supply', inventory_brand: 'Dell',
      inventory_model: 'E1916Hf', inventory_variant_key: 'dell\u001fE1916Hf', image_path: 'monitor.webp' } }
  };
  const db = {
    from(table) {
      return { select() { return this; }, eq(_field, id) { this.id = id; return this; },
        not() { return this; }, order() { return this; },
        async range(start, end) { return { data: Object.values(rows[table] || {}).slice(start, end + 1), error: null }; },
        async maybeSingle() { return { data: rows[table]?.[this.id] || null, error: null }; } };
    },
    storage: { from() { return { async createSignedUrl(path) { return { data: { signedUrl: `signed:${path}` }, error: null }; } }; } }
  };
  const window = { AldeckotSupabase: { async init() { return { client: db }; } },
    AldeckotInventoryImages: require(resolve(root, 'inventory-images.js')) };
  runInNewContext(source('equipment-images.js'), { window });
  const path = await window.AldeckotEquipmentImages.pathForSource(db, { kind: 'management', id: 'pc' });
  assert.equal(path, imagePath);
  const controlUrl = await window.AldeckotEquipmentImages.urlForItem({ managementRecordId: 'pc' }, 'control');
  const fluxUrl = await window.AldeckotEquipmentImages.urlForItem({ sourceModule: 'flux', sourceRecordId: 'transfer' }, 'flux');
  assert.equal(controlUrl, `signed:${imagePath}`);
  assert.equal(fluxUrl, controlUrl);
  assert.equal(await window.AldeckotEquipmentImages.urlForItem({ supplyUnitId: 'unit' }, 'control'), 'signed:monitor.webp');
  assert.equal(await window.AldeckotEquipmentImages.urlForItem({ inventoryItemId: 'monitor' }, 'control'), 'signed:monitor.webp');
});

test('foto do PC permanece no payload do computador e não no terminal fixo', () => {
  const api = source('supabase-client.js');
  const transfer = source('supabase/049_fix_management_terminal_transfer_identity.sql');
  assert.match(api, /imagePath: payload\.imagePath \|\| ''/);
  assert.match(api, /imagePath: String\(item\.imagePath \|\| ''\)\.trim\(\)/);
  assert.match(api, /async setComputerImage\(id, file, expected = \{\}\)/);
  assert.match(api, /\.eq\('updated_at', record\.updated_at\)/);
  assert.match(transfer, /source_computer := source_row\.payload - array\['terminal', 'area', 'sector', 'location', 'isFixed', 'logs', 'lastActivity'\]/);
  assert.doesNotMatch(transfer, /source_computer :=[^;]*'imagePath'/);
  assert.match(source('management.js'), /if \(state\.modal\?\.type === 'details'\) mountComputerPhoto\(activeItem\(\)\)/);
  assert.ok(source('management.html').indexOf('equipment-images.js') < source('management.html').indexOf('management.js'));
});

test('Homes de Controle TI e Flux buscam e paginam em todas as tabelas', () => {
  const tables = [
    { id: 'a', name: 'Manutenção', items: [{ id: '1', equipment: 'Computador', tag: 'PC001', date: '2026-10-16' }] },
    { id: 'b', name: 'Devoluções', items: [{ id: '2', equipment: 'Monitor', tag: 'MON001', date: '2026-10-15' }] }
  ];
  assert.deepEqual(home.listing(tables, { query: '', view: 'recent', page: 1, pageSize: 1 }).rows.map(row => row.id), ['1', '2']);
  assert.deepEqual(home.listing(tables, { query: 'mon001', view: 'recent', page: 1, pageSize: 1 }).rows.map(row => row.id), ['2']);
  assert.deepEqual(home.listing(tables, { query: '', view: 'all', page: 2, pageSize: 1 }).rows.map(row => row.id), ['2']);
  assert.match(home.markup(tables, { query: '', view: 'recent', page: 1, pageSize: 25 }, 'flux', 'Flux'), /data-inv-module-search/);
  for (const module of ['flux', 'control']) {
    assert.doesNotMatch(home.markup(tables, { query: '', view: 'recent', page: 1, pageSize: 25 }, module, module), /inventory-global-view-button|Ver todos|Ver recentes/);
  }
  assert.match(source('inventory.js'), /data-inv-module-home/);
});
