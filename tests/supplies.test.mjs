import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const sql = read('supabase/058_supplies.sql');
const ui = read('supplies.js');
const api = read('supplies-api.js');
const css = read('supplies.css');
const systemCss = read('supplies-system.css');
const backupSql = read('supabase/059_supply_backups.sql');
const backupUi = read('supplies-backup.js');

test('Suprimentos mantém identidade por UUID e três camadas independentes de status', () => {
  assert.match(sql, /create table if not exists public\.supplies/);
  assert.match(sql, /create table if not exists public\.supply_units/);
  assert.match(sql, /create table if not exists public\.supply_maintenance_links/);
  assert.match(sql, /stock_status/);
  assert.match(sql, /status in \('Em estoque', 'Instalado', 'Reserva', 'Manutenção', 'Defeito', 'Inativo'\)/);
  assert.match(sql, /status in \('Aberta', 'Em andamento', 'Aguardando peça', 'Concluída', 'Sem reparo'\)/);
  assert.match(sql, /installed_inventory_item_id uuid references public\.inventory_items\(id\)/);
  assert.match(sql, /installed_management_record_id uuid references public\.module_records\(id\)/);
  assert.match(sql, /control_item_id uuid not null unique references public\.control_items\(id\)/);
});

test('estoque disponível ignora unidades não disponíveis e catálogo inativo', () => {
  assert.match(sql, /count\(\*\) filter \(where status = 'Em estoque'\)/);
  assert.match(sql, /when s\.inactive then 'Inativo'/);
  assert.match(sql, /when \(case when s\.tracking_type = 'unit'.*\) = 0 then 'Sem estoque'/);
  assert.match(sql, /then 'Estoque baixo'/);
  assert.match(ui, /filter\(row => !row\.inactive\)/);
  assert.match(ui, /row\.stock_status === 'Estoque baixo'/);
});

test('operações críticas são atômicas e evitam estados impossíveis', () => {
  assert.match(sql, /supply_unit_installation_consistency/);
  assert.match(sql, /num_nonnulls\(installed_inventory_item_id, installed_management_record_id\) = 1/);
  assert.match(sql, /supply_maintenance_one_active/);
  assert.match(sql, /where closed_at is null/);
  assert.match(sql, /select \* into source from public\.supply_units where id = p_unit_id for update/);
  assert.match(sql, /create or replace function public\.supply_replace_unit/);
  assert.match(sql, /perform public\.supply_transition_unit\(p_old_unit_id/);
  assert.match(sql, /perform public\.supply_transition_unit\(p_new_unit_id/);
  assert.match(sql, /Finalize a ordem no Controle TI e escolha o destino/);
});

test('manutenção exige destino explícito e não cria cópia independente', () => {
  assert.match(sql, /supply_unit_id uuid references public\.supply_units\(id\)/);
  assert.match(sql, /create or replace function public\.supply_complete_maintenance/);
  assert.match(sql, /p_destination = 'reinstall'/);
  assert.match(sql, /p_destination = 'other'/);
  assert.match(sql, /p_destination = 'stock'/);
  assert.match(sql, /p_destination = 'reserve'/);
  assert.match(sql, /p_destination = 'defect'/);
  assert.match(sql, /p_destination = 'inactive'/);
  assert.match(sql, /supply_control_status_guard/);
  assert.match(api, /supply_complete_maintenance/);
});

test('migração de Suprimentos aceita a base corporativa sem owner_id nos módulos antigos', () => {
  assert.match(sql, /to_jsonb\(t\)->>'owner_id'/);
  assert.match(sql, /control_items_require_owner/);
  assert.match(sql, /app\.add_management_control_log/);
  assert.doesNotMatch(sql, /select owner_id into .* from public\.(?:control_items|inventory_items)/);
  assert.doesNotMatch(sql, /insert into public\.(?:control_item_logs|inventory_item_logs)\([^)]*owner_id/);
});

test('interface consulta dados reais e liga Inventário, Gestão TI e Controle TI', () => {
  assert.match(api, /from\('supply_stock_summary'\)/);
  assert.match(api, /from\('inventory_items'\)/);
  assert.match(api, /from\('module_records'\)/);
  assert.match(api, /from\('supply_maintenance_links'\)/);
  assert.match(read('inventory.html'), /supply-links\.js/);
  assert.match(read('management.html'), /supply-links\.js/);
  assert.match(read('control.html'), /supply-links\.js/);
  assert.match(read('home.js'), /id: 'supplies'/);
});

test('imagens ficam em bucket privado com limite e políticas de acesso', () => {
  assert.match(sql, /'supply-images', 'supply-images', false, 5242880/);
  assert.match(sql, /app\.has_active_account\(\)/);
  assert.match(sql, /app\.is_admin\(\)/);
  assert.match(api, /createSignedUrl\(path, 3600\)/);
  assert.match(api, /file\.size > 5242880/);
});

test('composição visual preserva painel, variações e formulário sem dados fictícios na aplicação', () => {
  assert.match(ui, /sp-search-wrap/);
  assert.match(ui, /sp-toolbar-add/);
  assert.doesNotMatch(ui, /data-sp-filter="category"|data-sp-action="filters"|data-sp-action="sync"/);
  assert.match(ui, /sp-variant-card/);
  assert.match(ui, /sp-variant-form/);
  assert.match(ui, /spInlineVariantForm/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(410px,36\.8%\)/);
  assert.match(systemCss, /\.sp-main,\s*body\.supplies-open \.sp-detail\s*\{[^}]*overflow-y: auto/s);
  assert.match(systemCss, /background-dark\.png/);
  assert.match(systemCss, /background-light-v2\.png/);
  assert.match(systemCss, /\.sp-header-action\s*\{[^}]*width: 42px;[^}]*min-width: 42px;/s);
  assert.doesNotMatch(systemCss, /animation:\s*sp-art-float|@keyframes sp-art-float/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(read('supplies.html'), /loading-indicator\.css/);
  assert.match(read('supplies.html'), /theme\.js/);
  assert.match(read('supplies.html'), /scrollbars\.css/);
});

test('quadros de Suprimentos exibem o fundo animado através do blur', () => {
  assert.match(systemCss, /body\.supplies-open::before\s*\{[^}]*z-index:\s*0[^}]*animation:\s*sp-wallpaper 28s ease-in-out infinite/s);
  assert.match(systemCss, /body\.supplies-open \.supplies-app\s*\{[^}]*z-index:\s*2/s);
  assert.match(systemCss, /body\.supplies-open \.sp-metric,[\s\S]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(systemCss, /body\.supplies-open \.sp-card,[\s\S]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(systemCss, /body\.theme-light\.supplies-open \.sp-card,[\s\S]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(read('supplies.html'), /supplies-system\.css\?v=20261007-glass-motion3/);
});

test('indicadores e imagens sem foto usam ícones distintos e acessíveis', () => {
  for (const name of ['total', 'stock', 'warning', 'empty']) assert.match(ui, new RegExp(`${name}: '<svg`));
  assert.match(ui, /const imagePlaceholder = '<svg/);
  assert.match(ui, /node\.innerHTML = imagePlaceholder/);
  assert.match(ui, /sp-export-action.*<svg/);
  assert.match(ui, /sp-backup-action.*Sistema de backup/);
});

test('Suprimentos reutiliza a Central de Notificações compartilhada', () => {
  const notifications = read('module-notifications.js');
  assert.match(notifications, /key === 'supplies' \? '\.sp-header'/);
  assert.match(notifications, /key === 'supplies' \? '\.sp-heading'/);
  assert.match(read('supplies.html'), /module-notifications\.js/);
  assert.match(read('supplies.html'), /mascot\.css/);
  assert.doesNotMatch(ui, /sp-notification-button/);
});

test('backup de Suprimentos tem histórico e frequência isolados, sem restauração insegura', () => {
  assert.match(backupSql, /create table if not exists public\.supply_backups/);
  assert.match(backupSql, /create table if not exists public\.supply_backup_settings/);
  assert.match(backupSql, /frequency_days integer not null default 7 check \(frequency_days between 1 and 90\)/);
  assert.match(backupSql, /public\.supply_backup_snapshot\(\)/);
  assert.match(backupSql, /app\.is_admin\(\)/);
  assert.match(api, /backup,\s*$/m);
  assert.match(backupUi, /state\.settings\.frequency_days \* 86400000/);
  assert.match(backupUi, /A restauração ainda não é oferecida/);
  assert.match(backupUi, /data-sp-backup="create"/);
  assert.match(backupUi, /type="button" disabled aria-describedby="spBackupRestoreNotice"/);
  assert.match(read('supplies.html'), /supplies-backup\.js/);
});
