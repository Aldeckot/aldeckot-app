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
  assert.match(ui, /variations\.alerts\(operational\)\.length/);
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
  assert.match(api, /const optimizedImage = async file =>/);
  assert.match(api, /createImageBitmap\(file\)/);
  assert.match(api, /canvas\.toBlob\(resolve, 'image\/webp', 0\.82\)/);
  assert.match(api, /const imageStillReferenced = async \(db, path\) =>/);
  assert.match(api, /db\.from\('supplies'\)\.select\('id'\)\.eq\('image_path', path\)/);
  assert.match(api, /db\.from\('supply_variants'\)\.select\('id'\)\.eq\('image_path', path\)/);
  assert.match(api, /if \(await imageStillReferenced\(db, path\)\) return false/);
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

test('tabela principal distingue status do estoque e dos equipamentos sem confundir marca ou modelo', () => {
  const headers = ui.match(/<table class="sp-table"><thead><tr>(.*?)<\/tr>/)?.[1];
  assert.equal(headers, '<th>Imagem</th><th>Nome do item</th><th>Categoria</th><th>Estoque</th><th>Mínimo</th><th>Indicador</th><th>Status do estoque</th><th>Status do equipamento</th>');
  assert.match(ui, /<td colspan="8" class="sp-empty">/);
  assert.ok(ui.includes('<td>${Number(row.active_count || 0)}</td>'));
  assert.match(css, /@media\(max-width:700px\)\{\.sp-table\{min-width:620px/);
  assert.doesNotMatch(css, /\.sp-table (?:th|td):nth-child\(3\)[^{]*\{[^}]*display:none/s);
});

test('paginação de Suprimentos usa 25 por padrão, permite escolha persistente e mantém filtros globais', () => {
  assert.match(ui, /const pageSizes = \[10, 25, 50, 100\]/);
  assert.match(ui, /pageSize: pageSizes\.includes\(savedPageSize\) \? savedPageSize : 25/);
  assert.match(ui, /rows\.slice\(\(state\.page - 1\) \* state\.pageSize, state\.page \* state\.pageSize\)/);
  assert.match(ui, /data-sp-page-size aria-label="Itens por página"/);
  assert.match(ui, /localStorage\.setItem\(pageSizeKey, String\(size\)\)/);
  assert.match(ui, /if \(state\.page > max\) state\.page = max/);
  assert.match(ui, /const rows = filtered\(\)/);
  assert.match(ui, /aria-current="page"/);
  assert.match(css, /\.sp-page-size select\{/);
});

test('exportação em PDF usa apenas campos válidos e respeita o conjunto filtrado', () => {
  assert.match(ui, /const rows = filtered\(\)\.map\(row => `<tr>/);
  assert.doesNotMatch(ui, /inventoryField\(/);
  assert.match(ui, /<th>Categoria<\/th><th>Estoque<\/th><th>Mínimo<\/th><th>Indicador<\/th><th>Status<\/th>/);
});

test('entrada por quantidade escolhe variação existente ou base sem duplicar grupos', () => {
  assert.match(ui, /const quantityChoices = item => .*filter\(row => !row\.base && !row\.disabled\)/);
  assert.match(ui, /data-sp-variation-search placeholder="Nome, marca, modelo ou característica"/);
  assert.match(ui, /<option value="base".*Item principal — Base sem variação/);
  assert.match(ui, /data-sp-quantity-new-variant>Cadastrar nova variação/);
  assert.match(ui, /p_variant_id: chosen\?\.id \|\| null/);
  assert.match(ui, /direction === 'exit' && quantity > current/);
  assert.match(sql, /where id = p_variant_id and supply_id = p_supply_id for update/);
  assert.match(sql, /if next_stock < 0 then raise exception 'Estoque insuficiente\.'/);
});

test('cadastro durante a entrada preserva rascunho e só movimenta estoque após confirmação', () => {
  assert.match(ui, /variantDialog\(null, captureMovementDraft\(form\)\)/);
  assert.match(ui, /return \(\) => reopenMovement\(resume, id\)/);
  assert.match(ui, /const continuation = await state\.onSubmit\(event\.target\)/);
  assert.match(ui, /await refresh\(\);\s*if \(typeof continuation === 'function'\)/);
  assert.match(ui, /const restoreMovementDraft = \(form, draft\) =>/);
  assert.match(ui, /row\.querySelector\('\[name=unit_serial\]'\)\.value = unit\.serial/);
  assert.match(ui, /data-sp-variant-back>Voltar à entrada/);
});

test('movimentação por quantidade exige motivo contextual e descreve Outro no histórico', () => {
  assert.match(ui, /entry: \['Compra \/ Reabastecimento', 'Devolução', 'Recebimento', 'Transferência recebida', 'Ajuste de inventário', 'Outro'\]/);
  assert.match(ui, /exit: \['Instalação em PDV', 'Substituição por defeito', 'Consumo', 'Envio para manutenção', 'Transferência'/);
  assert.match(ui, /name="reason_choice" data-sp-reason-choice required/);
  assert.match(ui, /data-sp-reason-other hidden/);
  assert.match(ui, /choice === 'Outro' && other\.length < 5/);
  assert.match(ui, /const reason = `\$\{choice === 'Outro'/);
  assert.match(ui, /p_reason: reason/);
  assert.match(sql, /insert into public\.supply_movements\(supply_id, variant_id, type, quantity, previous_stock, new_stock, reason, actor_id\)/);
});

test('detalhe da variação mantém seis campos essenciais e oculta contadores auxiliares zerados', () => {
  assert.match(ui, /<span>Marca<\/span><b>\$\{safe\(variant\.brand \|\| '—'\)\}<\/b><span>Modelo<\/span>/);
  assert.match(ui, /<span>Total<\/span><b>\$\{variant\.total\}<\/b><span>Estoque disponível<\/span>/);
  assert.match(ui, /<span>Mínimo<\/span><b>\$\{variant\.minimum_stock\}<\/b><span>Situação<\/span>/);
  assert.match(ui, /\['Manutenção', variant\.maintenance\], \['Defeito', variant\.defect\], \['Inativo', variant\.inactive\]/);
  assert.match(ui, /\.filter\(\(\[, count\]\) => Number\(count \|\| 0\) > 0\)/);
});

test('quadros de Suprimentos exibem o fundo animado através do blur', () => {
  assert.match(systemCss, /body\.supplies-open::before\s*\{[^}]*z-index:\s*0[^}]*animation:\s*sp-wallpaper 28s ease-in-out infinite/s);
  assert.match(systemCss, /body\.supplies-open \.supplies-app\s*\{[^}]*z-index:\s*2/s);
  assert.match(systemCss, /body\.supplies-open \.sp-metric,[\s\S]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(systemCss, /body\.supplies-open \.sp-card,[\s\S]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(systemCss, /body\.theme-light\.supplies-open \.sp-card,[\s\S]*backdrop-filter:\s*blur\(18px\)/);
  assert.match(systemCss, /body\.supplies-open \.sp-header\s*\{[^}]*backdrop-filter:\s*blur\(30px\)/s);
  assert.match(systemCss, /body\.supplies-open \.sp-metric\s*\{[^}]*backdrop-filter:\s*blur\(27px\)/s);
  assert.match(read('supplies.html'), /supplies-system\.css\?v=\d+\.\d+\.\d+/);
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
