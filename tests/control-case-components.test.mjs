import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import detail from '../control-case-detail.js';

const migration=readFileSync(resolve('supabase/101_control_case_components_external.sql'),'utf8');

test('componente vinculado reaproveita identidade existente e não duplica nem move estoque implicitamente',()=>{
  assert.match(migration,/inventory_item_id uuid references public\.inventory_items\(id\)/);
  assert.match(migration,/supply_unit_id uuid references public\.supply_units\(id\)/);
  assert.match(migration,/component_name:=item\.equipment; brand_name:=item\.brand; model_name:=item\.model/);
  assert.match(migration,/component_name:=supply\.name; brand_name:=supply\.brand; model_name:=supply\.model/);
  assert.doesNotMatch(migration,/insert into public\.equipment_events/i);
  assert.match(migration,/create unique index control_case_components_inventory_uq/);
  assert.match(migration,/create unique index control_case_components_supply_uq/);
  assert.match(migration,/perform public\.supply_replace_unit\(linked_supply_unit_id,replacement_unit_id/);
  assert.match(migration,/perform public\.supply_transition_unit\(linked_supply_unit_id,old_stock_destination/);
});

test('envio externo exige fornecedor, motivo, situação enviada e previsão de retorno',()=>{
  assert.match(migration,/action_name='Enviado ao fornecedor'[\s\S]{0,100}expected_at is null/);
  assert.match(migration,/action_name in \('Enviado ao fornecedor','Acompanhamento externo','Retornado do fornecedor'\)[\s\S]{0,100}supplier_name='' or service_reason=''/);
  assert.match(migration,/service_status='Retornado'/);
});

test('aba renderiza identidade, timeline e escapa conteúdo do fornecedor',()=>{
  const html=detail.components({
    case:{ticket_state:'Em manutenção'},
    componentsAvailable:true,
    components:[{
      component_name:'SSD <fictício>',brand:'Marca',model:'Modelo',tag:'TAG-01',
      serial:'S-01',inventory_item_id:'id-existente',
      events:[{action:'Enviado ao fornecedor',occurred_at:'2026-10-24T12:00:00Z',
        result:'Avaliação',supplier:'<Fornecedor>',reason:'Reparo',protocol:'OS-8',
        service_status:'Em análise',expected_return_at:'2026-10-28T12:00:00Z'}]
    }]
  },true);
  assert.match(html,/SSD &lt;fictício&gt;/);
  assert.match(html,/Inventário vinculado/);
  assert.match(html,/&lt;Fornecedor&gt;/);
  assert.match(html,/data-control-component-form/);
  assert.match(html,/Inspeções não alteram estoque/);
  assert.match(html,/operação oficial de Suprimentos/);
  assert.match(html,/replacementSupplyUnitId/);
});
