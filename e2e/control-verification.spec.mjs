import { expect,test } from '@playwright/test';
function fakeControlClient() {
  const user={id:'10000000-0000-4000-8000-000000000001'};
  const item={id:'10000000-0000-4000-8000-000000000101',equipment:'Monitor Dell',model:'P2422',brand:'Dell',tag:'AJMON001',
    serial:'MON-SER-1',status:'Aguardando avaliação',followUpKind:'verification',verificationInventoryItemId:'physical-monitor',
    entryDate:'2026-10-22',exitDate:'',situation:'Não realizada',priority:'Estável',notes:'',logs:[]};
  const table={id:'10000000-0000-4000-8000-000000000010',name:'OUTUBRO 2026',items:[item]};
  const query=()=>{let chain;chain=new Proxy({}, {get(_target,key){
    if(key==='then')return(resolve,reject)=>Promise.resolve({data:[],error:null}).then(resolve,reject);
    return()=>chain;
  }});return chain;};
  window.__verificationCalls=[];window.__maintenanceCalls=[];
  window.AldeckotSupabase={
    init:async()=>({client:{from:query,storage:{from:()=>({createSignedUrl:async()=>({data:null,error:null})})}}}),
    auth:{state:async()=>({session:{user},user,profile:{id:user.id,full_name:'Teste local',role:'admin',status:'active',module_permissions:{}},isAdmin:true})},
    realtime:{subscribe:async()=>()=>{}},
    control:{
      load:async()=>({tables:[table]}),
      completeVerification:async(id,values,requestId)=>{window.__verificationCalls.push({id,values,requestId});item.status='Verificação concluída';return{id,eventId:'verification-event'};},
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
