import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const view = require('../control-operational.js');
const apiSource = readFileSync(new URL('../supabase-client.js',import.meta.url),'utf8');
function clientApi(rpc) {
  const window = { ALDECKOT_SUPABASE_CONFIG: {
    url:'https://test.supabase.co',publishableKey:'test-public-key'
  },supabase:{createClient:()=>({rpc})} };
  runInNewContext(apiSource,{window,console,Headers,Request,URLSearchParams});
  return window.AldeckotSupabase;
}

test('central mostra contagens de chamados e sinaliza intervenções/prazos ainda indisponíveis',()=>{
  const html=view.markup({tab:'overview',busy:false,dashboard:{
    periodStart:'2026-10-01',metrics:{open:2,verification:1,maintenance:1,
      waiting:0,testing:0,critical:1,completedPeriod:3,avgResolutionHours:5.5,
      overdue:null},queue:[],activity:[{id:'transition',caseId:'case',state:'Resolvido',
        reason:'Teste',equipment:'Monitor',created_at:'2026-10-24T10:00:00Z'}]
  }});
  assert.match(html,/Central Operacional/);
  assert.match(html,/2<\/strong><small>Casos ainda não encerrados/);
  assert.match(html,/5.5 h/);
  assert.match(html,/não são intervenções/);
  assert.match(html,/nenhum vencimento é presumido/i);
  assert.doesNotMatch(html,/0<\/strong><small>.*vencid/);
});

test('fila preserva UUID do caso e escapa conteúdo antes da navegação',()=>{
  const html=view.overview({busy:false,dashboard:{metrics:{},queue:[{
    id:'case-1',controlItemId:'item-1',tableId:'table-1',equipment:'<script>',
    tag:'TAG-1',priority:'Alta',state:'Em manutenção',ageHours:50
  }],activity:[]}});
  assert.match(html,/control\.html\?table=table-1&amp;item=item-1&amp;case=case-1/);
  assert.match(html,/&lt;script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/2 d/);
});

test('relatórios apresentam indicadores e gráficos das listas filtradas e exportações',()=>{
  const html=view.markup({tab:'reports',busy:false,reportFilters:{maintenanceMode:'internal',category:'Periféricos'},report:{
    periodStart:'2026-10-01',periodEnd:'2026-10-24',metrics:{cases:1,resolvedCases:1,resolutionRate:100,
      avgResolutionHours:3,avgMaintenanceMinutes:90,recurrences:0,overdueTasks:1},
    states:[{label:'Concluído',count:1}],timeline:[{label:'2026-10-20',count:1}],
    sectors:[{label:'TI',count:1}],categories:[{label:'Periféricos',count:1}],origins:[{label:'inventory',count:1}],resolutionTimes:[{label:'TI',count:3}],
    casesList:[{id:'case-1',equipment:'Notebook',tag:'TAG-1',sector:'TI',state:'Concluído',category:'Periféricos',maintenanceMinutes:90,interventions:2,recurrence:false}]
  }});
  assert.match(html,/data-report-filter="category"/);
  assert.match(html,/data-report-filter="maintenanceMode"/);
  assert.match(html,/data-control-export-csv/);
  assert.match(html,/data-control-export-pdf/);
  assert.match(html,/Estados/);
  assert.match(html,/Evolução diária/);
  assert.match(html,/Tempo médio de resolução por setor/);
  assert.match(html,/90 min/);
  assert.match(html,/data-report-print-id="case-1"/);
  assert.match(html,/intervenções são apresentadas separadamente/);
});

test('endpoint de relatório envia os filtros em um único RPC',async()=>{
  const calls=[];
  const api=clientApi(async(name,args)=>{calls.push({name,args});return {data:{metrics:{cases:0}},error:null};});
  const filters={periodStart:'2026-10-01',periodEnd:'2026-10-24',sector:'TI',category:'Periféricos',maintenanceMode:'external'};
  const result=await api.control.controlCaseReport(filters);
  assert.equal(result.metrics.cases,0);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{name:'control_case_report',args:{p_filters:filters}}]);
});

test('intervenção recente abre o chamado, nunca o ID do evento',()=>{
  const html=view.overview({busy:false,dashboard:{metrics:{},queue:[],activity:[],
    interventionsAvailable:true,interventions:[{id:'event-1',caseId:'case-1',
      controlItemId:'item-1',tableId:'table-1',equipment:'Monitor',
      type:'Inspeção',description:'Conferência',occurred_at:'2026-10-24T10:00:00Z'}]}});
  assert.match(html,/case=case-1/);
  assert.doesNotMatch(html,/case=event-1/);
  assert.match(html,/Inspeção/);
});

test('pendência vencida aparece uma vez e abre o chamado correto',()=>{
  const html=view.overview({busy:false,dashboard:{metrics:{overdue:1},queue:[],
    activity:[],tasksAvailable:true,overdueTasks:[{id:'task-1',caseId:'case-1',
      controlItemId:'item-1',tableId:'table-1',equipment:'Notebook',
      description:'Trocar fonte',priority:'Alta',state:'Pendente',
      due_at:'2026-10-20T10:00:00Z'}]}});
  assert.match(html,/Pendências vencidas/);
  assert.match(html,/Trocar fonte/);
  assert.match(html,/case=case-1/);
  assert.doesNotMatch(html,/case=task-1/);
});

test('lista oferece filtros e paginação 10/25/50/100 com total vindo do servidor',()=>{
  const html=view.listing({tab:'active',query:'MON',status:'Em manutenção',
    priority:'Alta',page:2,pageSize:25,busy:false,
    listing:{total:30,items:[{id:'case-2',table_id:'table-1',
      control_item_id:'item-2',equipment:'Monitor',tag:'MON002',
      ticket_state:'Em manutenção',priority:'Alta'}]}});
  assert.match(html,/value="25" selected/);
  assert.match(html,/value="100"/);
  assert.match(html,/30 chamados · página 2 de 2/);
  assert.match(html,/data-control-page="1"/);
  assert.match(html,/data-control-page="3" disabled/);
  assert.match(html,/value="Crítica"/);
  assert.match(html,/value="Baixa"/);
  assert.doesNotMatch(html,/value="Estável"/);
});

test('API usa RPCs de indicadores e páginas, sem derivar chamados de intervenções',async()=>{
  const calls=[];
  const api=clientApi(async(name,args)=>{
    calls.push({name,args});
    return {data:name==='list_control_cases' ? {total:0,items:[]}
      : name==='recent_control_case_interventions' ? [] : {metrics:{open:0}},error:null};
  });
  await api.control.operationalOverview();
  await api.control.operationalCases({tab:'active',query:'MON',priority:'Alta',page:2,pageSize:25});
  assert.deepEqual(calls.map(call=>call.name),['control_operational_overview',
    'recent_control_case_interventions','control_overdue_case_tasks','list_control_cases']);
  assert.equal(calls[3].args.p_tab,'active');
  assert.equal(calls[3].args.p_query,'MON');
  assert.equal(calls[3].args.p_page,2);
  assert.equal(calls[3].args.p_page_size,25);
});
