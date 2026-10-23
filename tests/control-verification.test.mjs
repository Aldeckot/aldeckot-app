import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../supabase-client.js', import.meta.url), 'utf8');
function apiFor(client) {
  const window = { ALDECKOT_SUPABASE_CONFIG: { url: 'https://test.supabase.co', publishableKey: 'test-public-key' },
    supabase: { createClient: () => client } };
  runInNewContext(source, { window, console, Headers, Request, URLSearchParams });
  return window.AldeckotSupabase;
}
test('conclusão de verificação usa uma RPC e não transmite mudança de status, TAG ou localização do equipamento', async () => {
  const calls = [];
  const api = apiFor({ rpc: async (name,args) => { calls.push({name,args}); return { data:{eventId:'event',alreadyApplied:false},error:null }; } });
  await api.control.completeVerification('ticket',{ equipment:'Monitor',model:'Dell',notes:'Conferido e aprovado',
    priority:'Alta',situation:'Preventiva',status:'Verificação concluída',tag:'AJMON001',location:'PDV 01' },'request');
  assert.equal(calls.length,1);
  assert.equal(calls[0].name,'complete_control_verification');
  assert.equal(calls[0].args.p_request_id,'request');
  assert.equal(calls[0].args.p_solution,'Conferido e aprovado');
  assert.equal(calls[0].args.p_control_fields.status,undefined);
  assert.equal(calls[0].args.p_control_fields.location,undefined);
  assert.equal(calls[0].args.p_control_fields.tag,undefined);
});
test('Control TI anterior à 094 continua carregando, com fallback somente para coluna nova ausente', async () => {
  let count=0;
  const chain = {
    select(){return chain;},eq(){return chain;},order(){return chain;},
    then(resolve,reject) {
      count++;
      return Promise.resolve(count===1 ? {data:null,error:{code:'42703',message:'column followup_kind does not exist'}}
        : {data:[{id:'table',name:'Controle',control_items:[{id:'item',equipment:'Impressora',status:'Em manutenção'}]}],error:null}).then(resolve,reject);
    }
  };
  const api=apiFor({from:()=>chain});
  const result=await api.control.load();
  assert.equal(count,2);
  assert.equal(result.tables[0].items[0].followUpKind,'maintenance');
  assert.equal(result.tables[0].items[0].equipment,'Impressora');
});
test('backup com acompanhamento técnico é preservado antes de qualquer exclusão da rotina legada', async () => {
  const calls=[];
  const chain={select(){return chain;},eq(){return chain;},limit(){return Promise.resolve({data:[{id:'verification'}],error:null});}};
  const api=apiFor({from(table){calls.push(table);return chain;}});
  await assert.rejects(api.control.replace({tables:[]}),/Backup preservado/);
  assert.deepEqual(calls,['control_items']);
});
test('histórico técnico e movimentos compartilham navegação por UUID, sem duplicar eventos', async () => {
  const api=apiFor({rpc:async(name,args)=>({error:null,data:name==='management_movement_history'
    ? [{event_id:'move',occurred_at:'2026-10-01'}]
    : [{event_id:'technical',occurred_at:'2026-10-22',metadata:{computerId:args.p_computer_id,physicalMovement:false}}]})});
  const rows=await api.management.movementHistory({computerId:'pc'});
  assert.equal(rows.length,2);
  assert.equal(rows[0].event_id,'technical');
  assert.equal(rows[0].metadata.computerId,'pc');
  assert.equal(rows[0].metadata.physicalMovement,false);
});
test('histórico anterior permanece disponível enquanto a RPC técnica da 094 não foi aplicada', async () => {
  const api=apiFor({rpc:async name=>name==='management_movement_history'
    ? {error:null,data:[{event_id:'original',occurred_at:'2026-10-01'}]}
    : {error:{code:'PGRST202',message:'Function not found'},data:null}});
  const rows=await api.management.movementHistory({computerId:'pc'});
  assert.equal(rows[0].event_id,'original');
});
