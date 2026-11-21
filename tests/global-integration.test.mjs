import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const events = read('supabase/063_event_context_foundation.sql');
const cases = read('supabase/095_control_case_architecture.sql');
const managementFlux = read('supabase/072_flux_management_maintenance.sql');
const completion = read('supabase/073_control_maintenance_completion.sql');
const reopen = read('supabase/103_control_case_manual_reopen.sql');
const partialFailureScenario = read('tests/local-management/rpc-integration.mjs');

test('correlação global usa um evento raiz e efeito idempotente por módulo', () => {
  assert.match(events, /unique \(source_module, source_event_key\)/);
  assert.match(events, /unique \(event_id, module\)/);
  assert.match(events, /error_message text/);
  assert.match(events, /add column if not exists event_id uuid references public\.equipment_events/);
  assert.match(managementFlux, /'management-maintenance:' \|\| movement\.id::text/);
  assert.match(managementFlux, /'control', 'applied'/);
  assert.match(completion, /'control', 'applied'/);
  assert.match(completion, /source_module, 'applied'/);
});

test('chamado mantém identidade física e reconhece computador exclusivo da Gestão TI', () => {
  assert.match(cases, /control_cases_one_open_item_idx[\s\S]*where control_item_id is not null/);
  assert.match(cases, /management_identity_ok := new\.management_record_id is not null/);
  assert.match(cases, /m\.management_computer_id is not null/);
  assert.match(cases, /source_uuid := coalesce\(new\.verification_inventory_item_id,new\.inventory_item_id,[\s\S]*management_computer_id/);
  assert.match(cases, /Após um encerramento, a nova entrada técnica é sempre outro chamado/);
  assert.match(cases, /new\.management_record_id is not null\s+and new\.verification_computer_id is null and not management_identity_ok/);
});

test('reabertura requer ação explícita e falha de efeito coordenado tem cenário de rollback', () => {
  assert.match(reopen, /current_case\.ticket_state<>'Resolvido'/);
  assert.match(reopen, /clean_reason text:=btrim\(coalesce\(p_reason,''\)\)/);
  assert.match(partialFailureScenario, /app\.test_control_failure/);
  assert.match(partialFailureScenario, /Falha simulada/);
  assert.match(partialFailureScenario, /count\(\*\)::integer as n from public\.equipment_events/);
  assert.match(partialFailureScenario, /count\(\*\)::integer as n from public\.equipment_event_effects/);
});
