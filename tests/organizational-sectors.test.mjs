import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [catalog, migration, fluxMigration, fixture, inventory, management, client] = await Promise.all([
  readFile(new URL('../organizational-sectors.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/108_organizational_sectors.sql', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/109_flux_sector_catalog.sql', import.meta.url), 'utf8'),
  readFile(new URL('./sql/inventory-sector-catalog.sql', import.meta.url), 'utf8'),
  readFile(new URL('../inventory.js', import.meta.url), 'utf8'),
  readFile(new URL('../management.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase-client.js', import.meta.url), 'utf8'),
]);

test('one catalog exposes the nine official sectors and retains unmatched historic values', () => {
  for (const name of ['Frente de Loja','Doca','Escritório','Informática','Monitoramento','Tesouraria','Padaria','Açougue','Refeitório']) assert.ok(catalog.includes(`'${name}'`));
  assert.match(catalog, /optionsFor = current/);
  assert.match(catalog, /!names\.some\(name => normalize\(name\) === normalize\(value\)\) \? \[value\] : \[\]/);
});

test('migration maps exact sector identities without rewriting legacy labels or branch links', () => {
  assert.match(migration, /create table if not exists public\.organizational_sectors/);
  assert.match(migration, /update public\.inventory_items set sector_code=app\.organizational_sector_code\(sector\)/);
  assert.match(migration, /-- Backfill only exact catalog matches[^\n]*never rewrite sector text/);
  assert.match(migration, /foreign key \(sector_code\) references public\.organizational_sectors/);
  assert.match(migration, /tg_op='UPDATE' and new\.sector is distinct from old\.sector/);
  assert.doesNotMatch(migration, /update public\.inventory_items\s+set\s+sector\s*=/i);
  assert.doesNotMatch(migration, /update public\.inventory_branches|delete from public\.inventory_branch_memberships/i);
  assert.match(migration, /enable row level security/);
});

test('inventory and management forms use shared sector options', () => {
  assert.match(inventory, /AldeckotSectors\?\.optionsFor\(current\)/);
  assert.match(inventory, /select\.dataset\.invSectorChoice/);
  assert.match(inventory, /item\.inventoryItemId\|\|item\.managementRecordId\|\|item\.supplyUnitId/);
  assert.match(inventory, /field\.disabled = true/);
  assert.match(inventory, /Corrija esses dados na fonte oficial/);
  assert.match(inventory, /Setor \$\{row\.sector \|\| 'não informado'\} · Local \$\{row\.location \|\| 'não informado'\}/);
  assert.match(management, /AldeckotSectors\?\.optionsFor\(current\.sector\)/);
});

test('isolated SQL fixture checks catalog count, distinct location and historical branch preservation', () => {
  assert.match(fixture, /count\(\*\) from public\.organizational_sectors where active\)<>9/);
  assert.match(fixture, /sector='  frente   de loja '/);
  assert.match(fixture, /location='Sala 01'/);
  assert.match(fixture, /sector='Depósito Antigo' and sector_code is null/);
  assert.match(fixture, /inventory_branches b where b\.table_id=v_table_id\)<>branch_count/);
  assert.match(fixture, /TAG-SETOR-109/);
  assert.match(fixture, /metadata->>'sector'='Informática' and location='Rack 03'/);
});

test('Flux stores official sector separately from Local and exposes both in central identification', () => {
  assert.match(fluxMigration, /add column if not exists sector_code text/);
  assert.match(fluxMigration, /add column if not exists location text not null default ''/);
  assert.match(fluxMigration, /new\.sector:=canonical_name/);
  assert.match(fluxMigration, /jsonb_build_object\('sector', item\.sector/);
  assert.match(inventory, /name="sector" value="\$\{escape\(value\.sector\)\}"/);
  assert.match(inventory, /name="location" value="\$\{escape\(value\.location\)\}"/);
  assert.match(inventory, /field\.disabled = true/);
  assert.match(client, /inventory_item_id = values\.inventoryItemId/);
  assert.match(client, /sector: String\(values\.sector \|\| ''\)\.trim\(\)/);
  assert.match(client, /sector: row\.sector \|\| row\.metadata\?\.sector/);
});
