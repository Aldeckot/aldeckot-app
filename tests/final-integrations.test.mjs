import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const review = require('../flux-review.js');

test('resumo de confirmação diferencia efeitos reais e operações sem troca de status', () => {
  const values = { movement: 'Envio', situation: 'Manutenção', equipment: 'Computador',
    tag: 'ABC01', serial: 'SER01', destinationCompany: 'Oficina' };
  const linked = review.describe({ sourceModule: 'management', sourceLocation: 'Caixa 05',
    sourceStatus: 'Ativo', newSourceStatus: 'Manutenção', linkedMaintenance: true,
    controlAction: 'Criar' }, values);
  assert.equal(linked.source, 'Gestão TI');
  assert.equal(linked.previousStatus, 'Ativo');
  assert.equal(linked.nextStatus, 'Manutenção');
  assert.match(linked.effects.join(' '), /Controle TI: criar chamado/);
  const plain = review.describe({ sourceModule: null, linkedMaintenance: false }, values);
  assert.match(plain.effects.join(' '), /nenhuma mudança de status/);
});

test('cancelamento da prévia ocorre antes de qualquer gravação e a confirmação é única', () => {
  const ui = read('inventory.js');
  const path = ui.slice(ui.indexOf('async function saveItem(form)'), ui.indexOf('function download(content'));
  assert.ok(path.indexOf('previewMovement(') < path.indexOf('AldeckotFluxReview.confirm('));
  assert.ok(path.indexOf('AldeckotFluxReview.confirm(') < path.indexOf('moduleApi().saveItem('));
  assert.match(path, /if \(!await window\.AldeckotFluxReview\.confirm\(preview, item\)\) \{[\s\S]*?return;/);
  assert.match(path, /form\.dataset\.fluxBusy = 'true'/);
  const sql = read('supabase/075_flux_reviewed_movements.sql');
  assert.match(sql, /request_id uuid primary key/);
  assert.match(sql, /where request_id = p_request_id for update/);
  assert.match(sql, /reviewed->>'token' is distinct from p_review_token/);
  assert.match(sql, /Nenhuma alteração será mantida/);
});

test('estorno só restaura estado intacto, preserva originais e bloqueia duplicação', () => {
  const sql = read('supabase/076_flux_audited_reversal.sql');
  assert.match(sql, /receipt\.source_status_before/);
  assert.match(sql, /current_updated is distinct from receipt\.source_updated_at_after/);
  assert.match(sql, /ticket\.updated_at is distinct from receipt\.control_updated_at_after/);
  assert.match(sql, /receipt\.reversal_request_id = p_request_id/);
  assert.match(sql, /update public\.control_items set status = 'Cancelado'/);
  assert.match(sql, /update public\.flux_reviewed_movements\s+set reversed_event_id/);
  assert.match(sql, /reversed_flux_movement_guard/);
  assert.doesNotMatch(sql, /delete from public\.(?:flux_items|control_items|inventory_items|module_records)/i);
});

test('compatibilidade é explícita e não altera estoque, categoria e origem continuam distintas', () => {
  const sql = read('supabase/074_supply_model_compatibility.sql');
  assert.match(sql, /references public\.supplies\(id\) on delete restrict/);
  assert.match(sql, /where inactive_at is null/);
  assert.match(sql, /model text not null/);
  assert.doesNotMatch(sql, /update public\.(?:supplies|supply_units|inventory_items)/i);
  const projection = read('supplies-inventory.js');
  assert.match(projection, /source: 'inventory', name: group\.name, category: group\.name/);
  const ui = read('supplies.js');
  assert.match(ui, /Categoria do suprimento/);
  assert.match(ui, /Origem/);
  assert.match(ui, /ausência de relação não significa incompatibilidade/);
});

test('gatilho patrimonial não confunde o ID do recibo com a coluna do evento', () => {
  const sql = read('supabase/077_flux_inventory_event_id_ambiguity.sql');
  assert.match(sql, /v_sync_event_id uuid/);
  assert.match(sql, /returning id into v_sync_event_id/);
  assert.match(sql, /where public\.equipment_sync_events\.id = v_sync_event_id/);
  assert.doesNotMatch(sql, /where id = event_id;/);
  assert.match(sql, /app\.process_flux_management_maintenance\(new\.id\)/);
});

test('estorno consulta o ID existente da tabela de origem', () => {
  const sql = read('supabase/078_flux_reversal_source_table.sql');
  assert.match(sql, /select id into source_table from public\.module_tables/);
  assert.match(sql, /Função de estorno divergente/);
  assert.doesNotMatch(sql, /delete from|truncate /i);
});
