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

test('todas as páginas principais usam o ícone oficial na aba do navegador', () => {
  assert.equal(existsSync(resolve(root, 'assets/aldeckot-favicon.png')), true);
  for (const page of pages) {
    const source = readFileSync(resolve(root, page), 'utf8');
    assert.match(source, /rel="icon" type="image\/png" href="assets\/aldeckot-favicon\.png\?v=20260910-1"/);
  }
});

test('as telas permanecem disponíveis durante consultas e atualizações automáticas', () => {
  const loading = readFileSync(resolve(root, 'loading-indicator.js'), 'utf8');
  const home = readFileSync(resolve(root, 'index.html'), 'utf8');

  assert.match(loading, /const requestMethod = \(input, options\) => String\(/);
  assert.match(loading, /const isReadOnlyRpc = input => \/\\\/rpc\\\//);
  assert.match(loading, /return \['GET', 'HEAD'\]\.includes\(requestMethod\(input, options\)\) \|\| isReadOnlyRpc\(input\);/);
  assert.match(loading, /return isBackgroundRequest\(input, options\) \? request : track\(request\);/);
  assert.match(home, /loading-indicator\.js\?v=20260910-background-requests2/);
  for (const page of pages) {
    const source = readFileSync(resolve(root, page), 'utf8');
    assert.match(source, /loading-indicator\.js\?v=20260910-background-requests2/);
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

test('Gestão TI encaminha manutenções para a última tabela do Controle TI', () => {
  const migration = readFileSync(resolve(root, 'supabase/041_management_control_maintenance_sync.sql'), 'utf8');
  const correction = readFileSync(resolve(root, 'supabase/042_fix_management_control_maintenance_owner.sql'), 'utf8');
  const centralCorrection = readFileSync(resolve(root, 'supabase/043_fix_central_management_control_maintenance_sync.sql'), 'utf8');
  const monthlyRouting = readFileSync(resolve(root, 'supabase/044_route_management_maintenance_to_current_month.sql'), 'utf8');

  assert.match(migration, /add column if not exists management_record_id uuid/);
  assert.match(migration, /create unique index if not exists control_items_management_record_unique/);
  assert.match(migration, /app\.management_requires_control/);
  assert.match(migration, /'em manutenção', 'em manutencao'/);
  assert.match(migration, /where table_row\.module = 'control'\s+order by table_row\.created_at desc, table_row\.id desc/);
  assert.match(migration, /create trigger management_record_control_sync/);
  assert.match(migration, /app\.sync_management_status_from_control/);
  assert.match(migration, /select app\.reconcile_management_control_maintenance\(\)/);
  assert.match(correction, /insert into public\.control_items \(\s*table_id, owner_id, management_record_id/);
  assert.match(correction, /values \(\s*control_item_id, latest_control_owner_id, 'create', sync_message\)/);
  assert.match(correction, /and table_row\.owner_id = management_owner_id/);
  assert.match(correction, /select app\.reconcile_management_control_maintenance\(\)/);
  assert.match(centralCorrection, /create or replace function app\.add_management_control_log/);
  assert.match(centralCorrection, /to_jsonb\(table_row\) ->> 'owner_id'/);
  assert.doesNotMatch(centralCorrection, /record_row\.owner_id/);
  assert.match(centralCorrection, /select app\.reconcile_management_control_maintenance\(\)/);
  assert.match(monthlyRouting, /app\.current_control_maintenance_table_name/);
  assert.match(monthlyRouting, /when 9 then 'SETEMBRO'/);
  assert.match(monthlyRouting, /lower\(btrim\(table_row\.name\)\) = lower\(current_control_table_name\)/);
  assert.match(monthlyRouting, /table_id = case[\s\S]*current_control_table_id/);
});

test('os módulos mantêm a atualização automática sem botões manuais de sincronização', () => {
  const inventory = readFileSync(resolve(root, 'inventory.js'), 'utf8');
  const management = readFileSync(resolve(root, 'management.js'), 'utf8');

  assert.doesNotMatch(inventory, /data-inv-action="sync"|Sincronizar módulo|function synchronizeModule/);
  assert.doesNotMatch(management, /data-management-action="sync"|Sincronizar módulo|function syncModule/);
  assert.doesNotMatch(inventory, /class="inventory-sync"[^>]*>Sincronizado/);
  assert.doesNotMatch(management, /class="management-sync"[^>]*>Sincronizado/);
});

test('os cards de resumo das configurações aparecem apenas na seção geral', () => {
  const settingsPage = readFileSync(resolve(root, 'settings.html'), 'utf8');
  const settings = readFileSync(resolve(root, 'settings.js'), 'utf8');

  assert.match(settingsPage, /id="settingsOverview" class="settings-overview"/);
  assert.match(settings, /overview\.hidden = name !== 'general'/);
});

test('a assinatura visual mostra somente a logo e o nome Aldeckot', () => {
  const headerBrand = readFileSync(resolve(root, 'header-official-logo.js'), 'utf8');
  const homeBrand = readFileSync(resolve(root, 'home-official-logo.js'), 'utf8');
  const home = readFileSync(resolve(root, 'index.html'), 'utf8');
  const settings = readFileSync(resolve(root, 'settings.html'), 'utf8');
  const version = readFileSync(resolve(root, 'system-version.js'), 'utf8');

  assert.match(headerBrand, /<b>Aldeckot<\/b>/);
  assert.doesNotMatch(headerBrand, /Sistema de Gestão/);
  assert.match(homeBrand, /<b>Aldeckot<\/b>/);
  assert.doesNotMatch(homeBrand, /Sistema de Gestão/);
  assert.match(home, /<div class="brand" aria-label="Aldeckot">/);
  assert.match(home, /<b>Aldeckot<\/b>/);
  assert.doesNotMatch(home, /data-aldeckot-brand-subtitle/);
  assert.match(settings, /class="settings-brand-mark"/);
  assert.match(settings, /<b>Aldeckot<\/b>/);
  assert.doesNotMatch(settings, /ALDECKOT — Sistema de Gestão/);
  assert.doesNotMatch(version, /aldeckot-brand-subtitle/);

  for (const page of pages) {
    const source = readFileSync(resolve(root, page), 'utf8');
    assert.match(source, /<title>Aldeckot<\/title>/);
  }
});

test('os modais de equipamentos e PCs não fecham ao clicar no fundo', () => {
  const inventory = readFileSync(resolve(root, 'inventory.js'), 'utf8');
  const management = readFileSync(resolve(root, 'management.js'), 'utf8');

  assert.match(inventory, /node\.addEventListener\('click', event => \{\s*if \(event\.target !== node\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.doesNotMatch(management, /event\.target === modalNode\) \{ state\.modal = null; renderModal\(\); \}/);
  assert.match(inventory, /data-inv-close/);
  assert.match(management, /data-management-action="close"/);
});

test('os modais de informações dos módulos usam o acabamento corporativo compartilhado', () => {
  const modalStyles = readFileSync(resolve(root, 'item-detail-modals.css'), 'utf8');

  assert.match(modalStyles, /\.inv-dialog:has\(\.inv-detail-grid\)/);
  assert.match(modalStyles, /\.management-modal-dialog:has\(\.management-detail-grid\)/);
  assert.match(modalStyles, /\.nfe-dialog:has\(\.nfe-detail-grid\)/);
  assert.match(modalStyles, /@media \(prefers-reduced-motion: reduce\)/);

  for (const page of ['inventory.html', 'control.html', 'flux.html', 'management.html', 'nfe.html']) {
    const source = readFileSync(resolve(root, page), 'utf8');
    assert.match(source, /item-detail-modals\.css\?v=20260911-2/);
  }
});

test('Gestão TI preserva o nome fixo do terminal durante a edição', () => {
  const management = readFileSync(resolve(root, 'management.js'), 'utf8');

  assert.match(management, /const terminalField = edit\s*\? `<input type="hidden" name="terminal" value="\$\{escape\(current\.terminal\)\}">`/);
  assert.match(management, /terminal: current \? current\.terminal : String\(values\.terminal \|\| ''\)\.trim\(\)/);
});

test('os controles do Inventário não acumulam modais em uma mesma ação', () => {
  const inventory = readFileSync(resolve(root, 'inventory.js'), 'utf8');

  assert.match(inventory, /function removeOpenModals\(\) \{\s*document\.querySelectorAll\('\.inv-modal'\)\.forEach\(openModal => openModal\.remove\(\)\);/);
  assert.match(inventory, /function modal\(content, dialogClass = '', statusColor = ''\) \{\s*\/\/ Alguns fluxos[\s\S]*?removeOpenModals\(\);/);
  assert.match(inventory, /function closeModal\(\) \{ state\.itemActionMenu = false; removeOpenModals\(\); \}/);
});

test('as notificações dos módulos priorizam equipamentos que exigem ação', () => {
  const notifications = readFileSync(resolve(root, 'module-notifications.js'), 'utf8');
  const styles = readFileSync(resolve(root, 'module-notifications.css'), 'utf8');

  for (const rule of ['inventory-defect', 'control-assessment', 'flux-pending', 'management-defect', 'nfe-recurring-pdv']) {
    assert.match(notifications, new RegExp(rule));
  }
  assert.match(notifications, /Próximo passo/);
  assert.match(notifications, /slice\(0, 5\)/);
  assert.match(notifications, /data-module-notification-dismiss/);
  assert.match(notifications, /\[data-module-notification-toggle\]/);
  assert.match(notifications, /function openNotification\(notification\) \{\s*if \(!notification\) return;\s*closePanel\(\);/);
  assert.match(notifications, /AldeckotInventoryOpenDetails/);
  assert.match(styles, /module-notification-action/);
  assert.match(styles, /module-notification-dismiss/);
});
