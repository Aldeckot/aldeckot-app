import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('a seleção do Flux preserva a entrada manual e limpa vínculos obsoletos', () => {
  const source = read('inventory.js');
  assert.match(source, /setupFluxEquipmentSearch\(node, entry\)/);
  assert.match(source, /if \(selected\) \{\s*clearSelection\(\)/);
  assert.match(source, /valuesToSave\.sourceModule = modalNode\.dataset\.sourceModule \|\| null/);
  assert.match(source, /\['equipment', 'brand', 'model', 'tag', 'serial'\]/);
  assert.match(source, /data-flux-clear/);
});

test('vínculo só é enviado quando a migração está presente; sem ela, cadastro manual permanece', () => {
  const api = read('supabase-client.js');
  assert.match(api, /missingFluxSourceColumns\(response\.error\)/);
  assert.match(api, /if \(values\.sourceModule && !fluxSourceAvailable\) fail/);
  assert.match(api, /if \(fluxSourceAvailable && hasOwn\(values, 'sourceModule'\)\)/);
});

test('068 não inventa vínculos legados e valida a identidade no banco', () => {
  const sql = read('supabase/068_flux_source_identity.sql');
  assert.match(sql, /add column if not exists source_module text/);
  assert.match(sql, /source_record_id uuid/);
  assert.match(sql, /inventory_item_id uuid references public\.inventory_items\(id\) on delete restrict/);
  assert.match(sql, /validate_flux_source_identity/);
  assert.match(sql, /TAG ou série difere da origem selecionada/);
  assert.doesNotMatch(sql, /update public\.flux_items set source_/i);
});
