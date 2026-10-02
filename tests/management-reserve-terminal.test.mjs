import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('RES 03 é acrescentado como terminal fixo na Frente de Loja sem substituir registros', () => {
  const sql = readFileSync(resolve(root, 'supabase/055_management_res_03_terminal.sql'), 'utf8');

  assert.match(sql, /upper\(btrim\(coalesce\(payload ->> 'terminal', ''\)\)\) = 'RES 03'/);
  assert.match(sql, /'terminal', 'RES 03'/);
  assert.match(sql, /'area', 'Frente de Loja'/);
  assert.match(sql, /'sector', 'Frente de Loja'/);
  assert.match(sql, /'isFixed', true/);
  assert.doesNotMatch(sql, /\b(?:delete|truncate|update)\s+(?:from\s+)?public\.module_records\b/i);
});

test('reservas gerais e transferências entre Escritório e Estoque respeitam os setores', () => {
  const sql = readFileSync(resolve(root, 'supabase/056_management_shared_office_stock_transfers.sql'), 'utf8');
  const management = readFileSync(resolve(root, 'management.js'), 'utf8');

  for (const name of ['RES GERAL 01', 'RES GERAL 02', 'RES GERAL 03']) {
    assert.match(sql, new RegExp(`'${name}'`));
  }
  assert.match(sql, /'Escritório', 'RES GERAL 01'/);
  assert.match(sql, /'Escritório', 'RES GERAL 02'/);
  assert.match(sql, /'Estoque', 'RES GERAL 03'/);
  assert.match(sql, /'isFixed', true/);
  assert.match(sql, /where not exists \(/);
  assert.match(sql, /source_area in \('escritório', 'estoque'\) and destination_area in \('escritório', 'estoque'\)/);
  assert.match(sql, /perform app\.sync_management_record_to_control\(destination_row\.id, destination_next\)/);
  assert.match(management, /const sharedTransferAreas = new Set\(\['Escritório', 'Estoque'\]\)/);
  assert.match(management, /canTransferBetweenAreas\(item\.area, candidate\.area\)/);
  assert.match(management, /canTransferBetweenAreas\(source\.area, destination\.area\)/);
});
