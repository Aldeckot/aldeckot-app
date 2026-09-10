import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index.html', 'login.html', 'inventory.html', 'management.html', 'control.html', 'flux.html', 'nfe.html', 'settings.html'];

test('todas as páginas principais possuem monitoramento e carregamento global', () => {
  for (const page of pages) {
    const source = readFileSync(resolve(root, page), 'utf8');
    assert.match(source, /error-monitor\.js/);
    assert.match(source, /loading-indicator\.js/);
  }
});

test('os artefatos operacionais essenciais estão presentes', () => {
  for (const artifact of ['README.md', 'docs/OPERATIONS.md', 'supabase/README.md', 'scripts/check-migrations.mjs', 'scripts/verify-rls.mjs', 'scripts/verify-backups.mjs']) {
    assert.equal(existsSync(resolve(root, artifact)), true, `Ausente: ${artifact}`);
  }
});

test('a política de conteúdo permite apenas as bibliotecas externas usadas pelo sistema', () => {
  const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
  const csp = config.headers[0].headers.find(header => header.key === 'Content-Security-Policy').value;
  assert.match(csp, /https:\/\/cdn\.jsdelivr\.net/);
  assert.match(csp, /https:\/\/cdnjs\.cloudflare\.com/);
  assert.match(csp, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/);
});

test('tarefas e eventos da agenda mantêm a conclusão visível e persistente', () => {
  const agenda = readFileSync(resolve(root, 'agenda.js'), 'utf8');
  const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
  assert.match(agenda, /data-agenda-complete/);
  assert.match(agenda, /is-completed/);
  assert.match(agenda, /agenda-overdue-reminder/);
  assert.match(agenda, /overdueEntries/);
  assert.match(client, /setAgendaTaskCompletion|set_agenda_(?:task|entry)_completion/);
  assert.equal(existsSync(resolve(root, 'supabase/028_agenda_task_completion.sql')), true);
  assert.equal(existsSync(resolve(root, 'supabase/029_agenda_event_completion.sql')), true);
});

test('Inventário sincroniza as TAGs de periféricos compatíveis com a Gestão TI', () => {
  const management = readFileSync(resolve(root, 'management.js'), 'utf8');
  const client = readFileSync(resolve(root, 'supabase-client.js'), 'utf8');
  const migration = readFileSync(resolve(root, 'supabase/038_inventory_management_peripheral_sync.sql'), 'utf8');
  const correction = readFileSync(resolve(root, 'supabase/039_fix_inventory_management_peripheral_sync_owner.sql'), 'utf8');
  const reconciliation = readFileSync(resolve(root, 'supabase/040_reconcile_inventory_management_peripherals.sql'), 'utf8');
  for (const [type, prefix] of [['Impressora', 'IMPR'], ['Leitor', 'EAN'], ['Gaveta', 'GVT'], ['Pin Pad', 'PP'], ['Balança', 'BAL'], ['Monitor', 'MON'], ['Teclado', 'TEC']]) {
    assert.match(management, new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(management, new RegExp(`/\\^${prefix}\\[0-9\\]\\+\\$/`));
    assert.match(migration, new RegExp(`\\^${prefix}\\[0-9\\]\\+\\$`));
  }
  assert.match(client, /syncManagementPeripheral/);
  assert.match(client, /sourceItemId/);
  assert.match(migration, /inventory_peripheral_management_sync/);
  assert.match(migration, /management_peripheral_tag_format/);
  assert.match(correction, /p_remove boolean default false\s*\)\s*returns integer/);
  assert.match(correction, /app\.apply_inventory_peripheral_assignment\(null, new\.id/);
  assert.doesNotMatch(correction, /record_item\.owner_id|new\.owner_id|old\.owner_id/);
  assert.match(reconciliation, /jsonb_typeof\(record_row\.payload -> 'peripherals'\) = 'array'/);
  assert.match(reconciliation, /reconcile_inventory_management_peripherals/);
  assert.match(reconciliation, /select app\.reconcile_inventory_management_peripherals\(\)/);
});
