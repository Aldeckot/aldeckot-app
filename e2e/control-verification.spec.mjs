import { expect,test } from '@playwright/test';
function fakeControlClient() {
  const user={id:'10000000-0000-4000-8000-000000000001'};
  const item={id:'10000000-0000-4000-8000-000000000101',equipment:'Monitor Dell',model:'P2422',brand:'Dell',tag:'AJMON001',
    serial:'MON-SER-1',status:'Aguardando avaliação',followUpKind:'verification',verificationInventoryItemId:'physical-monitor',
    entryDate:'2026-10-22',exitDate:'',situation:'Não realizada',priority:'Estável',notes:'',logs:[]};
  if(window.__managementOnly){delete item.verificationInventoryItemId;item.followUpKind='maintenance';item.status='Em manutenção';}
  const table={id:'10000000-0000-4000-8000-000000000010',name:'OUTUBRO 2026',items:[item]};
  const query=()=>{let chain;chain=new Proxy({}, {get(_target,key){
    if(key==='then')return(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject);
    return()=>chain;
  }});return chain;};
  window.__verificationCalls=[];window.__maintenanceCalls=[];window.__promotionCalls=[];
  window.__diagnosticCalls=[];window.__diagnostics=[];
  window.__interventionCalls=[];window.__interventions=[];
  window.__taskCalls=[];window.__tasks=[];window.__taskEvents=[];window.__closureCalls=[];
  window.AldeckotSupabase={
    init:async()=>({client:{from:query,storage:{from:()=>({createSignedUrl:async()=>({data:null,error:null})})}}}),
    auth:{state:async()=>({session:{user},user,profile:{id:user.id,full_name:'Teste local',role:'admin',status:'active',module_permissions:{}},isAdmin:true})},
    realtime:{subscribe:async()=>()=>{}},
    control:{
      load:async()=>({tables:[table]}),
      caseDetail:window.__caseDetailEnabled ? async id=>{
        if(window.__caseDetailMissing)throw Object.assign(
          new Error('Could not find public.get_control_case_detail in the schema cache'),
          {code:'PGRST202'});
        return{
        case:{id,control_item_id:item.id,source_module:'management',equipment:item.equipment,
          tag:item.tag,serial:item.serial,ticket_state:window.__caseState||'Em verificação',priority:'Estável',
          opened_at:'2026-10-22T09:00:00Z'},
        item:{...item},location:null,diagnostics:[...window.__diagnostics],
        transitions:[{id:'transition-1',next_state:'Em verificação',source:'legacy',
          created_at:'2026-10-22T09:00:00Z'}],movements:[],
        interventions:[...window.__interventions],
        interventionsAvailable:!!window.__interventionsEnabled,
        tasks:[...window.__tasks],taskEvents:[...window.__taskEvents],
        tasksAvailable:!!window.__tasksEnabled
        };
      } : undefined,
      appendCaseDiagnostic:async(id,payload,requestId)=>{
        window.__diagnosticCalls.push({id,payload,requestId});
        window.__diagnostics.unshift({...payload,final_diagnosis:payload.finalDiagnosis,
          revision:window.__diagnostics.length+1,created_at:'2026-10-24T10:00:00Z'});
        return{revision:window.__diagnostics.length,alreadyApplied:false};
      },
      appendCaseIntervention:async(id,payload,requestId)=>{
        window.__interventionCalls.push({id,payload,requestId});
        window.__interventions.push({id:'intervention-'+window.__interventions.length,
          case_id:id,occurred_at:payload.occurredAt,intervention_type:payload.type,
          description:payload.description,result:payload.result,
          contextual_state:'Em verificação',technical_author:payload.technicalAuthor,
          reference_note:payload.referenceNote});
        return{id:'intervention-'+window.__interventions.length,alreadyApplied:false};
      },
      createCaseTask:async(id,payload,requestId)=>{
        window.__taskCalls.push({kind:'create',id,payload,requestId});
        const task={id:'task-'+(window.__tasks.length+1),case_id:id,
          description:payload.description,due_at:payload.dueAt,priority:payload.priority,
          notes:payload.notes,task_state:'Pendente',completion_note:'',revision:1};
        window.__tasks.push(task);
        window.__taskEvents.push({action:'Criada',created_at:new Date().toISOString(),
          after_snapshot:{...task}});
        return{id:task.id,alreadyApplied:false};
      },
      updateCaseTask:async(taskId,payload,requestId)=>{
        window.__taskCalls.push({kind:'update',taskId,payload,requestId});
        const task=window.__tasks.find(entry=>entry.id===taskId);
        Object.assign(task,{description:payload.description,due_at:payload.dueAt,
          priority:payload.priority,notes:payload.notes,task_state:payload.state,
          completion_note:payload.completionNote,revision:task.revision+1});
        window.__taskEvents.push({action:'Atualizada',created_at:new Date().toISOString(),
          after_snapshot:{...task}});
        return{id:taskId,alreadyApplied:false};
      },
      closeCaseWithTasks:async(caseId,reason,requestId,openTaskIds,decision)=>{
        window.__closureCalls.push({caseId,reason,requestId,openTaskIds,decision});
        window.__caseState='Concluído';
        return{caseId,alreadyApplied:false};
      },
      listCases:async()=>{
        if(window.__caseHistoryFailure)throw Error("Could not find the table 'public.control_cases' in the schema cache");
        return [
          {id:item.id,ticket_state:'Em verificação',followup_kind:'verification',opened_at:'2026-10-22T09:00:00Z',closed_at:null},
          {id:'older-case',ticket_state:'Concluído',followup_kind:'maintenance',opened_at:'2026-09-20T09:00:00Z',closed_at:'2026-09-21T10:00:00Z',requires_review:true}
        ];
      },
      completeVerification:async(id,values,requestId)=>{window.__verificationCalls.push({id,values,requestId});item.status='Verificação concluída';return{id,eventId:'verification-event'};},
      promoteVerification:async(id,reason,requestId)=>{window.__promotionCalls.push({id,reason,requestId});item.status='Verificação concluída';return{caseId:'maintenance-case',alreadyApplied:false};},
      completeMaintenance:async()=>{window.__maintenanceCalls.push('unexpected');throw Error('Não era manutenção');},
      syncManagementPeripheral:async()=>({state:'server-managed'})
    },
    controlBackups:{list:async()=>[],latest:async()=>null,settings:async()=>({automatic:false,frequency_days:7})}
  };
}
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1'&&url.pathname==='/supabase-client.js')return route.fulfill({contentType:'application/javascript',body:'('+fakeControlClient.toString()+')();'});
    if(url.hostname==='127.0.0.1'&&url.pathname==='/supabase-config.js')return route.fulfill({contentType:'application/javascript',body:'window.ALDECKOT_SUPABASE_CONFIG={};'});
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'application/javascript',body:''});
    if(url.hostname==='127.0.0.1'&&url.pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    if(url.hostname==='127.0.0.1')return route.continue();
    return route.abort();
  });
});
async function edit(page) {
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101');
  await expect(page.locator('.inv-modal')).toBeVisible();
  await page.locator('[data-inv-action="toggle-item-actions"]').click();
  await page.locator('[data-inv-edit-item]').click();
  const form=page.locator('[data-inv-item-form]');
  await expect(form).toBeVisible();
  return form;
}
test('detalhe mostra episódios técnicos separados do status legado',async({page})=>{
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101');
  await expect(page.locator('.control-case-history')).toContainText('Em verificação');
  await expect(page.locator('.control-case-history')).toContainText('Concluído');
  await expect(page.locator('.control-case-history')).toContainText('vínculo de origem a revisar');
  await expect(page.locator('.control-case-history .inv-log')).toHaveCount(2);
  await expect(page.locator('.inv-detail').filter({hasText:/^Estado técnico do acompanhamento/})).toContainText('Aguardando avaliação');
});
test('sem a migration 095 o detalhe legado continua utilizável',async({page})=>{
  await page.addInitScript(()=>{window.__caseHistoryFailure=true;});
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101');
  await expect(page.locator('.inv-modal')).toBeVisible();
  await expect(page.locator('.control-case-history')).toHaveCount(0);
  await expect(page.locator('.inv-log-head')).toContainText('Histórico');
});
test('chamado de origem Gestão TI abre sete abas e salva revisão sem exigir Inventário',async({page})=>{
  await page.addInitScript(()=>{window.__caseDetailEnabled=true;window.__managementOnly=true;});
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-control-case-tab]')).toHaveCount(7);
  await expect(detail).toContainText('MON-SER-1');
  await detail.locator('[data-control-case-tab="movements"]').click();
  await expect(detail).toContainText('Somente eventos físicos oficiais');
  await detail.locator('[data-control-case-tab="diagnosis"]').click();
  await detail.locator('[name="symptom"]').fill('Tela apagando');
  await detail.locator('[data-control-diagnostic-form] button[type="submit"]').click();
  await expect(detail).toContainText('Revisão 1');
  const calls=await page.evaluate(()=>window.__diagnosticCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].payload.symptom).toBe('Tela apagando');
  expect(calls[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
});
test('sem a migration 098 o chamado retorna ao detalhe legado sem loop',async({page})=>{
  await page.addInitScript(()=>{window.__caseDetailEnabled=true;window.__caseDetailMissing=true;});
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  await expect(page.locator('.control-case-history .control-case-focused')).toBeVisible();
  await expect(page.locator('.control-case-detail')).toHaveCount(0);
  await expect(page.locator('.inv-modal')).toHaveCount(1);
});
test('cinco intervenções em dias diferentes permanecem no mesmo chamado sem trocar seu estado',async({page})=>{
  await page.addInitScript(()=>{window.__caseDetailEnabled=true;window.__managementOnly=true;window.__interventionsEnabled=true;});
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await expect(detail).toBeVisible();
  await detail.locator('[data-control-case-tab="interventions"]').click();
  for(let index=1;index<=5;index++){
    const form=detail.locator('[data-control-intervention-form]');
    await form.locator('[name="occurredAt"]').fill(`2026-10-${String(14+index).padStart(2,'0')}T09:00`);
    await form.locator('[name="type"]').selectOption(index===5?'Teste funcional':'Inspeção');
    await form.locator('[name="description"]').fill(`Ação técnica ${index}`);
    await form.locator('[name="result"]').fill(`Resultado técnico ${index}`);
    await form.getByRole('button',{name:'Registrar intervenção'}).click();
    await expect(detail.locator('.control-case-interventions li')).toHaveCount(index);
  }
  await expect(detail).toContainText('Intervenções · 5');
  await expect(detail).toContainText('Em verificação');
  const calls=await page.evaluate(()=>window.__interventionCalls);
  expect(calls).toHaveLength(5);
  expect(new Set(calls.map(call=>call.id)).size).toBe(1);
  expect(calls.every(call=>call.payload.technicalAuthor==='')).toBe(true);
  expect(calls.every(call=>/^[a-f0-9-]{36}$/.test(call.requestId))).toBe(true);
});
test('sem a migration 099 a aba não apresenta notas legadas como intervenções',async({page})=>{
  await page.addInitScript(()=>{window.__caseDetailEnabled=true;window.__managementOnly=true;});
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await expect(detail).toBeVisible();
  await detail.locator('[data-control-case-tab="interventions"]').click();
  await expect(detail).toContainText('migração 099');
  await expect(detail.locator('[data-control-intervention-form]')).toHaveCount(0);
});
test('formulário de intervenção cabe no modal em tela estreita',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{window.__caseDetailEnabled=true;window.__managementOnly=true;window.__interventionsEnabled=true;});
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await expect(detail).toBeVisible();
  await detail.locator('[data-control-case-tab="interventions"]').click();
  await expect(detail.locator('[data-control-intervention-form]')).toBeVisible();
  const widths=await page.evaluate(()=>{const modal=document.querySelector('.control-case-dialog');return{
    viewport:innerWidth,modal:modal.getBoundingClientRect().width,
    overflowing:[...modal.querySelectorAll('[data-control-intervention-form] *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).length};});
  expect(widths.modal).toBeLessThanOrEqual(widths.viewport);
  expect(widths.overflowing).toBe(0);
});
test('pendências vencidas, conclusão auditada e encerramento exigem decisão explícita',async({page})=>{
  await page.addInitScript(()=>{
    window.__caseDetailEnabled=true;window.__managementOnly=true;
    window.__tasksEnabled=true;window.__caseState='Resolvido';
  });
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await expect(detail).toBeVisible();
  await detail.locator('[data-control-case-tab="pending"]').click();
  for(const [name,due] of [['Trocar fonte fictícia','2020-01-02T10:00'],
    ['Testar bancada fictícia','2030-01-02T10:00']]){
    const form=detail.locator('[data-control-task-create]');
    await form.locator('[name="description"]').fill(name);
    await form.locator('[name="dueAt"]').fill(due);
    await form.getByRole('button',{name:'Criar pendência'}).click();
    await expect(detail.locator('.control-case-pending li')).toHaveCount(
      name.startsWith('Trocar')?1:2);
  }
  await expect(detail).toContainText('Vencida');
  const second=detail.locator('.control-case-pending li').filter({hasText:'Testar bancada fictícia'});
  await second.locator('summary').click();
  await second.locator('[name="state"]').selectOption('Concluída');
  await second.locator('[name="completionNote"]').fill('Teste aprovado no laboratório.');
  await second.getByRole('button',{name:'Salvar pendência'}).click();
  await expect(detail).toContainText('Teste aprovado no laboratório.');
  await detail.locator('[data-control-case-tab="overview"]').click();
  await expect(detail).toContainText('Próxima ação');
  await expect(detail.locator('[data-control-case-close]')).toContainText('Trocar fonte fictícia');
  const close=detail.locator('[data-control-case-close]');
  await close.locator('[name="reason"]').fill('Problema principal resolvido.');
  await close.getByRole('button',{name:'Concluir chamado'}).click();
  expect(await page.evaluate(()=>window.__closureCalls.length)).toBe(0);
  await close.locator('[name="keepOpen"]').check();
  await close.getByRole('button',{name:'Concluir chamado'}).click();
  await expect(detail).toContainText('Chamado concluído');
  const result=await page.evaluate(()=>({
    calls:window.__closureCalls,tasks:window.__tasks,
    taskCalls:window.__taskCalls,events:window.__taskEvents}));
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0].decision).toBe('Manter abertas');
  expect(result.calls[0].openTaskIds).toEqual(['task-1']);
  expect(result.tasks[0].task_state).toBe('Pendente');
  expect(result.tasks[1].task_state).toBe('Concluída');
  expect(result.taskCalls).toHaveLength(3);
  expect(result.events).toHaveLength(3);
});
test('sem a migração 100 não oferece criação nem encerramento parcial',async({page})=>{
  await page.addInitScript(()=>{
    window.__caseDetailEnabled=true;window.__managementOnly=true;
    window.__caseState='Resolvido';
  });
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await expect(detail).toBeVisible();
  await expect(detail.locator('[data-control-case-close]')).toHaveCount(0);
  await detail.locator('[data-control-case-tab="pending"]').click();
  await expect(detail).toContainText('migração 100');
  await expect(detail.locator('[data-control-task-create]')).toHaveCount(0);
});
test('formulário de pendência permanece dentro do modal em tela estreita',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    window.__caseDetailEnabled=true;window.__managementOnly=true;window.__tasksEnabled=true;
  });
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101&case=10000000-0000-4000-8000-000000000101');
  const detail=page.locator('.control-case-detail');
  await detail.locator('[data-control-case-tab="pending"]').click();
  await expect(detail.locator('[data-control-task-create]')).toBeVisible();
  const widths=await page.evaluate(()=>{
    const modal=document.querySelector('.control-case-dialog');
    return{viewport:innerWidth,modal:modal.getBoundingClientRect().width,
      overflowing:[...modal.querySelectorAll('[data-control-task-create] *')]
        .filter(el=>el.getBoundingClientRect().right>innerWidth+1).length};
  });
  expect(widths.modal).toBeLessThanOrEqual(widths.viewport);
  expect(widths.overflowing).toBe(0);
});
test('acompanhamento técnico oferece conclusão própria e não solicita status Ativo/Reserva do equipamento',async({page})=>{
  const form=await edit(page);
  await expect(form.locator('[name="status"] option')).toHaveText(['Aguardando avaliação','Verificação concluída']);
  await form.locator('[name="status"]').selectOption('Verificação concluída');
  await form.locator('[name="notes"]').fill('Conexão conferida e funcionamento aprovado.');
  await form.getByRole('button',{name:'Salvar',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__verificationCalls.length)).toBe(1);
  expect(await page.evaluate(()=>window.__maintenanceCalls.length)).toBe(0);
  const call=await page.evaluate(()=>window.__verificationCalls[0]);
  expect(call.id).toBe('10000000-0000-4000-8000-000000000101');
  expect(call.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(call.values.notes).toContain('funcionamento aprovado');
});
test('conclusão sem resultado técnico é bloqueada antes de qualquer chamada de gravação',async({page})=>{
  const form=await edit(page);
  await form.locator('[name="status"]').selectOption('Verificação concluída');
  await form.getByRole('button',{name:'Salvar',exact:true}).click();
  await expect(page.getByText('Descreva o resultado da verificação em Observações antes de concluir.')).toBeVisible();
  expect(await page.evaluate(()=>window.__verificationCalls.length)).toBe(0);
  expect(await page.evaluate(()=>window.__maintenanceCalls.length)).toBe(0);
});
test('encaminhamento explícito exige justificativa e não duplica envios',async({page})=>{
  await page.goto('/control.html?table=10000000-0000-4000-8000-000000000010&item=10000000-0000-4000-8000-000000000101');
  await page.getByRole('button',{name:'Encaminhar para manutenção'}).click();
  const form=page.locator('[data-inv-promotion-form]');
  await expect(form).toBeVisible();
  await expect(form).toContainText('Justificativa');
  await form.locator('[name="reason"]').fill('Falha elétrica exige reparo');
  await form.getByRole('button',{name:'Confirmar encaminhamento'}).click();
  await expect.poll(()=>page.evaluate(()=>window.__promotionCalls.length)).toBe(1);
  const call=await page.evaluate(()=>window.__promotionCalls[0]);
  expect(call.reason).toBe('Falha elétrica exige reparo');
  expect(call.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(await page.evaluate(()=>window.__maintenanceCalls.length)).toBe(0);
});
