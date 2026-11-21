import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const view = require('../control-case-detail.js');
const base = {
  case:{id:'case-1',control_item_id:'item-1',source_module:'management',
    equipment:'Notebook',tag:'PC-1',ticket_state:'Em diagnóstico',opened_at:'2026-10-24T08:00:00Z'},
  item:{id:'item-1',equipment:'Notebook',model:'M1',serial:'SER-1',status:'Em manutenção'},
  location:null,diagnostics:[],transitions:[],movements:[]
};

test('detalhe aceita equipamento exclusivo da Gestão TI sem inventar vínculo ao Inventário',()=>{
  const html=view.markup(base);
  assert.match(html,/management/);
  assert.match(html,/SER-1/);
  assert.match(html,/Local físico/);
  assert.match(html,/Próxima ação/);
  assert.match(html,/Tempo até resolução/);
  const editable=view.markup({...base,duration:{priorityLevel:'Alta',
    totalMinutes:1440,resolutionMinutes:600,maintenanceSeverity:'Atenção'}},'overview',true);
  assert.match(editable,/data-control-case-priority/);
  assert.match(editable,/<option selected>Alta<\/option>/);
  assert.match(editable,/Prioridade não altera a severidade/);
  assert.match(view.markup({...base,case:{...base.case,ticket_state:'Concluído'}},'overview',true),
    /Prioridade/);
  assert.doesNotMatch(view.markup({...base,case:{...base.case,ticket_state:'Concluído'}},'overview',true),
    /data-control-case-priority/);
  assert.equal((html.match(/data-control-case-tab=/g)||[]).length,7);
});

test('diagnóstico mostra versões preservadas e formulário preenchido com a última',()=>{
  const html=view.markup({...base,diagnostics:[
    {revision:2,symptom:'Falha nova',cause:'Fonte',created_at:'2026-10-24T10:00:00Z'},
    {revision:1,symptom:'Falha antiga',created_at:'2026-10-24T09:00:00Z'}
  ]},'diagnosis',true);
  assert.match(html,/Revisão 2/);
  assert.match(html,/Revisão 1/);
  assert.match(html,/data-control-diagnostic-form/);
  assert.match(html,/>Falha nova<\/textarea>/);
  assert.doesNotMatch(view.markup({...base,case:{...base.case,ticket_state:'Concluído'}},'diagnosis',true),/data-control-diagnostic-form/);
});

test('movimentações só exibem eventos oficiais recebidos e histórico não confunde notas antigas',()=>{
  assert.match(view.markup(base,'movements'),/Somente eventos físicos oficiais/);
  const html=view.markup({...base,movements:[{action:'Movimentação',origin_location:'A',destination_location:'B'}]},'movements');
  assert.match(html,/A → B/);
  const history=view.markup({...base,transitions:[{next_state:'Em diagnóstico',source:'manual'}]},'history',false,[{text:'Nota do equipamento'}]);
  assert.match(history,/Estado: Em diagnóstico/);
  assert.match(history,/podem abranger outros episódios/);
});

test('histórico mantém as alterações auditadas da prioridade como eventos independentes',()=>{
  const html=view.markup({...base,priorityChanges:[
    {previous_priority:'Média',next_priority:'Crítica',created_at:'2026-10-24T10:00:00Z'}
  ]},'history');
  assert.match(html,/Prioridade: Crítica/);
  assert.match(html,/Prioridade anterior: Média/);
});

test('reabertura só aparece em chamado resolvido e exige justificativa manual',()=>{
  const resolved=view.markup({...base,case:{...base.case,ticket_state:'Resolvido'}},'overview',true);
  assert.match(resolved,/data-control-case-reopen/);
  assert.match(resolved,/Motivo da reabertura/);
  assert.match(resolved,/required/);
  assert.match(resolved,/preserva esta ocorrência e seu histórico/);
  const completed=view.markup({...base,case:{...base.case,ticket_state:'Concluído'}},'overview',true);
  assert.doesNotMatch(completed,/data-control-case-reopen/);
});

test('resolução exige conteúdo estruturado e mostra a condição final confirmada',()=>{
  const editable=view.markup(base,'overview',true);
  assert.match(editable,/data-control-case-resolution/);
  assert.match(editable,/Diagnóstico final \*/);
  assert.match(editable,/Solução aplicada \*/);
  assert.match(editable,/Testes realizados \*/);
  assert.match(editable,/Categoria técnica \*/);
  assert.match(editable,/Condição final confirmada/);
  assert.match(editable,/não altera o status do Inventário/);
  const inventory=view.markup({...base,case:{...base.case,source_module:'inventory'}},'overview',true);
  assert.match(inventory,/Ativo/);
  assert.match(inventory,/Reserva/);
  const recurrence=view.markup({...base,recurrenceAvailable:true,recurrence:{available:true,
    occurrenceCount:2,sourceModule:'inventory',likelyRecurrence:true,
    signalBasis:'Mesmo UUID e categoria',categories:[{category:'Alimentação elétrica',
      occurrences:2,averageIntervalDays:14,references:[{caseId:'old-case',state:'Concluído',
        openedAt:'2026-10-01T10:00:00Z',intervalDays:14,diagnosis:'Falha anterior'}]}],
    recentCases:[{id:'old-case',state:'Concluído',opened_at:'2026-10-01T10:00:00Z',
      category:'Alimentação elétrica',maintenanceMinutes:120,replacedParts:[{name:'Fonte'}]}]}}
    ,'overview',true);
  assert.match(recurrence,/Possível reincidência/);
  assert.match(recurrence,/mesmo equipamento de origem/i);
  assert.match(recurrence,/Abrir chamado/);
  assert.match(recurrence,/Fonte/);
  const resolved=view.markup({...base,resolutions:[{
    final_diagnosis:'Falha identificada',solution:'Componente substituído',
    tests:'Teste funcional aprovado',final_condition:'Ativo',observations:'Fixture',
    created_at:'2026-10-24T12:00:00Z'
  }],case:{...base.case,ticket_state:'Resolvido'}},'overview',true);
  assert.match(resolved,/Resolução registrada/);
  assert.match(resolved,/Componente substituído/);
  assert.doesNotMatch(resolved,/data-control-case-resolution/);
  assert.match(view.markup({...base,resolutions:[{final_diagnosis:'Falha',solution:'Ação',
    tests:'Aprovado',final_condition:'Ativo',created_at:'2026-10-24T12:00:00Z'}]},'history'),
    /Resolução técnica registrada/);
});

test('cinco intervenções do mesmo chamado aparecem em ordem sem exigir autoria técnica',()=>{
  const interventions=Array.from({length:5},(_,index)=>({
    id:`intervention-${index+1}`,case_id:'case-1',
    occurred_at:`2026-10-${String(15-index).padStart(2,'0')}T09:00:00Z`,
    intervention_type:index===0?'Inspeção':'Reparo',
    description:`Ação ${index+1}`,result:`Resultado ${index+1}`,
    contextual_state:'Em diagnóstico',technical_author:''
  }));
  const data={...base,interventions,interventionsAvailable:true};
  const html=view.markup(data,'interventions',true);
  assert.equal((html.match(/class="control-case-timeline control-case-interventions"/g)||[]).length,1);
  assert.equal((html.match(/ID intervention-/g)||[]).length,5);
  assert.ok(html.indexOf('intervention-5') < html.indexOf('intervention-1'));
  assert.match(html,/data-control-intervention-form/);
  assert.match(html,/Responsável técnico \(opcional\)/);
  assert.match(view.markup(data,'history'),/Intervenção · Inspeção/);
  assert.doesNotMatch(view.markup({...data,interventionsAvailable:false},'interventions',true),/data-control-intervention-form/);
  assert.doesNotMatch(view.markup({...data,case:{...base.case,ticket_state:'Concluído'}},'interventions',true),/data-control-intervention-form/);
});

test('pendências destacam vencimento, próxima ação e decisão antes da conclusão',()=>{
  const tasks=[
    {id:'task-open',description:'Trocar fonte',due_at:'2026-01-02T10:00:00Z',
      priority:'Alta',task_state:'Pendente',revision:1,notes:''},
    {id:'task-done',description:'Testar bancada',due_at:null,
      priority:'Média',task_state:'Concluída',revision:2,
      completion_note:'Teste aprovado'}
  ];
  const data={...base,tasks,tasksAvailable:true,
    case:{...base.case,ticket_state:'Resolvido'}};
  const pending=view.markup(data,'pending',true);
  assert.match(pending,/Vencida/);
  assert.match(pending,/data-control-task-create/);
  assert.equal((pending.match(/data-control-task-update/g)||[]).length,2);
  assert.match(pending,/Teste aprovado/);
  const overview=view.markup(data,'overview',true);
  assert.match(overview,/Próxima ação/);
  assert.match(overview,/Trocar fonte/);
  assert.match(overview,/data-control-case-close/);
  assert.match(overview,/Manter estas pendências abertas/);
  assert.doesNotMatch(view.markup({...data,tasksAvailable:false},'overview',true),
    /data-control-case-close/);
  assert.doesNotMatch(view.markup({...data,tasksAvailable:false},'pending',true),
    /data-control-task-create/);
  assert.doesNotMatch(view.markup({...data,case:{...base.case,ticket_state:'Concluído'}},
    'pending',true),/data-control-task-create/);
});

test('campos de texto do chamado são escapados',()=>{
  const html=view.markup({...base,item:{...base.item,equipment:'<script>alert(1)</script>',
    notes:'[[aldeckot:item-priority:alta]]\nFalha relatada'}});
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/Falha relatada/);
  assert.doesNotMatch(html,/item-priority:alta/);
});

test('API expõe leitura por ID e acréscimo idempotente por RPC',()=>{
  const source=readFileSync(new URL('../supabase-client.js',import.meta.url),'utf8');
  assert.match(source,/rpc\('get_control_case_detail', \{ p_case_id: caseId \}\)/);
  assert.match(source,/rpc\('append_control_case_diagnostic',/);
  assert.match(source,/rpc\('set_control_case_priority',/);
  assert.match(source,/rpc\('reopen_control_case',/);
  assert.match(source,/rpc\('resolve_control_case',/);
  assert.match(source,/from\('control_case_resolutions'\)/);
  assert.match(source,/p_request_id: requestId/);
});
