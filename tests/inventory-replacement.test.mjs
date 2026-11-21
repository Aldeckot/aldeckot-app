import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [ui, migration, fixture] = await Promise.all([
  readFile(new URL('../inventory.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/107_inventory_replacement_sector_transfer.sql', import.meta.url), 'utf8'),
  readFile(new URL('./sql/inventory-replacement-cross-sector.sql', import.meta.url), 'utf8'),
]);

test('replacement UI compares full equipment identity and offers all same-table reserve rows', () => {
  assert.match(ui, /activeTable\(\)\?\.items\.filter\(row => row\.id !== item\.id && row\.status === 'Reserva'\)/);
  assert.match(ui, /TAG \$\{row\.tag[^\n]+Série \$\{row\.serial[^\n]+Setor \$\{row\.sector[^\n]+Local \$\{row\.location/);
  assert.match(ui, /data-inv-replacement-preview/);
  assert.match(ui, /\['TAG',row\.tag\].*\['Setor',row\.sector\].*\['Local',row\.location\].*\['Status',row\.status\]/);
  assert.match(ui, /ensureFullActiveTable\(\)/);
  assert.match(ui, /field\('Modelo', item\.model, '', replacementAction\)/);
  assert.match(ui, /\['Manutenção','Defeito','Inativo'\]/);
});

test('replacement migration transfers sector atomically without changing physical identities', () => {
  assert.match(migration, /add column if not exists removed_sector/);
  assert.match(migration, /add column if not exists installed_previous_sector/);
  assert.match(migration, /set status='Ativo',location=outgoing\.location,sector=outgoing\.sector/);
  assert.match(migration, /outgoing\.table_id<>incoming\.table_id/);
  assert.match(migration, /outgoing\.status<>'Ativo' or incoming\.status<>'Reserva'/);
  assert.match(migration, /removed_sector,installed_previous_sector,installed_sector/);
  assert.doesNotMatch(migration, /set\s+(?:id|tag|serial)\s*=/i);
  assert.match(migration, /inventory_item_logs/);
  assert.match(migration, /begin;/i);
  assert.match(migration, /commit;/i);
});

test('local SQL fixture verifies cross-sector success and rollback after injected failure', () => {
  assert.match(fixture, /'Frente de Loja'.*'Guichê 1'/s);
  assert.match(fixture, /'Escritório'.*'Armário 2'/s);
  assert.match(fixture, /installed_previous_sector='Escritório'/);
  assert.match(fixture, /falha simulada na instalação/);
  assert.match(fixture, /status='Ativo' and location='Guichê 2'/);
  assert.match(fixture, /status='Reserva' and location='Armário 3'/);
  assert.match(fixture, /rollback;/i);
});
