import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const root = new URL('../../', import.meta.url);
const file = name => readFileSync(new URL('supabase/' + name, root), 'utf8');
const fn = (name, signature) => {
  const source = file(name), start = source.indexOf('create or replace function ' + signature);
  assert.ok(start >= 0, signature);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};
const db = new PGlite();
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12,'0');
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
try {
  await db.exec(
    "create schema app; create schema auth; create role anon; create role authenticated;" +
    "create function auth.uid() returns uuid language sql stable as $$ select '10000000-0000-4000-8000-000000000001'::uuid $$;" +
    "create function app.has_active_account() returns boolean language sql stable as $$ select true $$;" +
    "create function app.can_manage_module_table(uuid,text,text) returns boolean language sql stable as $$ select true $$;" +
    "create function app.inventory_installation_location_key(text) returns text language sql immutable as $$ select lower($1) $$;" +
    "create table public.module_tables(id uuid primary key default gen_random_uuid(),owner_id uuid not null,module text,name text,position int default 0,created_at timestamptz default now());" +
    "create table public.inventory_items(id uuid primary key default gen_random_uuid(),table_id uuid references module_tables,owner_id uuid,equipment text,model text default 'Modelo',brand text default '',serial text default '',tag text default '',sector text default '',location text default '',status text,situation text,cleaning_type text default 'Não realizada',notes text default '',position int default 0,created_at timestamptz default now(),updated_at timestamptz default now());" +
    "create table public.module_records(id uuid primary key default gen_random_uuid(),table_id uuid references module_tables,management_computer_id uuid unique,payload jsonb,position int default 0,created_at timestamptz default now(),updated_at timestamptz default now());" +
    "create table public.control_items(id uuid primary key default gen_random_uuid(),table_id uuid references module_tables,owner_id uuid not null,inventory_item_id uuid,management_record_id uuid,supply_unit_id uuid,equipment text,model text,brand text default '',tag text default '',serial text default '',sector text default '',entry_date date,exit_date date,status text constraint control_items_status_check check(status in ('Em manutenção','Manutenção concluída','Aguardando avaliação','Em uso','Em sala','Descartado','Cancelado')),cleaning_type text default 'Não realizada',notes text default '',position int default 0,created_at timestamptz default now(),updated_at timestamptz default now());" +
    "create unique index inv_ticket_unique on control_items(inventory_item_id) where inventory_item_id is not null;" +
    "create unique index pc_ticket_unique on control_items(management_record_id) where management_record_id is not null;" +
    "create table public.equipment_events(id uuid primary key default gen_random_uuid(),source_module text,source_event_key text,source_id uuid,inventory_item_id uuid,action text,previous_status text,new_status text,previous_location text,new_location text,reason text,affected_modules jsonb,metadata jsonb,processing_result jsonb default '{}',actor_id uuid,created_at timestamptz default now(),unique(source_module,source_event_key));" +
    "create table public.equipment_event_effects(id uuid primary key default gen_random_uuid(),event_id uuid,module text,status text,attempts int,processed_at timestamptz,unique(event_id,module));" +
    "create table public.inventory_item_logs(id uuid primary key default gen_random_uuid(),inventory_item_id uuid,action text,message text,event_id uuid,source_module text,source_log_id uuid,created_at timestamptz default now());" +
    "create unique index inv_source_log on inventory_item_logs(inventory_item_id,source_module,source_log_id) where source_module is not null and source_log_id is not null;" +
    "create table public.control_item_logs(id uuid primary key default gen_random_uuid(),control_item_id uuid,owner_id uuid,action text,message text,event_id uuid,created_at timestamptz default now());" +
    "create table public.sync_events(id uuid primary key default gen_random_uuid(),module text,operation text,details jsonb,event_id uuid,created_at timestamptz default now());"
  );
  for (const [name, signature] of [
    ['044_route_management_maintenance_to_current_month.sql','app.current_control_maintenance_table_name()'],
    ['057_inventory_control_maintenance_sync.sql','app.sync_inventory_maintenance_to_control('],
    ['057_inventory_control_maintenance_sync.sql','app.sync_control_from_inventory()'],
    ['044_route_management_maintenance_to_current_month.sql','app.sync_management_record_to_control('],
    ['062_status_identity_safety.sql','app.resolve_inventory_item_id('],
    ['062_status_identity_safety.sql','app.management_identity_matches('],
    ['062_status_identity_safety.sql','app.sync_inventory_status_from_control()'],
    ['084_control_management_identity_repair.sql','app.sync_management_status_from_control()'],
    ['088_management_movements.sql','app.sync_control_from_management()'],
    ['088_management_movements.sql','public.complete_control_maintenance('],
    ['062_status_identity_safety.sql','app.copy_control_log_to_inventory()'],
    ['062_status_identity_safety.sql','app.copy_control_log_to_management()']
  ]) await db.exec(fn(name, signature));
  await db.exec(
    "create function app.management_requires_control(jsonb) returns boolean language sql immutable as $$ select $1->>'status' in ('Manutenção','Defeito') $$;" +
    "create function app.add_management_control_log(uuid,text,text) returns void language sql as $$ insert into public.control_item_logs(control_item_id,action,message) values($1,$2,$3) $$;" +
    "create trigger maintenance_inventory_sync after insert or update of status on inventory_items for each row execute function app.sync_control_from_inventory();" +
    "create trigger forward_management_sync after insert or update of payload on module_records for each row execute function app.sync_control_from_management();" +
    "create trigger reverse_inventory_sync after insert or update of status on control_items for each row when(coalesce(current_setting(\'app.control_completion_event\',true),\'\')=\'\') execute function app.sync_inventory_status_from_control();" +
    "create trigger reverse_management_sync after insert or update of status on control_items for each row execute function app.sync_management_status_from_control();" +
    "create trigger copy_inventory_log after insert on control_item_logs for each row execute function app.copy_control_log_to_inventory();" +
    "create trigger copy_management_log after insert on control_item_logs for each row execute function app.copy_control_log_to_management();"
  );
  if (process.env.ALDECKOT_TEST_NO_OWNER === '1') await db.exec('alter table module_tables drop column owner_id; alter table control_items drop column owner_id;');
  await db.exec(file('094_control_technical_verification.sql'));
  if (process.env.ALDECKOT_TEST_NO_OWNER === '1') {
    await db.query("insert into module_tables(id,module,name) values($1,'inventory','Monitores'),($2,'management','Posições'),($3,'control',app.current_control_maintenance_table_name())",[id(10),id(20),id(30)]);
  } else {
    await db.query("insert into module_tables(id,owner_id,module,name) values($1,$4,'inventory','Monitores'),($2,$4,'management','Posições'),($3,$4,'control',app.current_control_maintenance_table_name())", [id(10),id(20),id(30),id(1)]);
  }
  await db.query("insert into inventory_items(id,table_id,equipment,tag,serial,status,situation,location) values($1,$2,'Monitor','AJMON001','SER-MON-001','Ativo','Normal','PDV 01')", [id(101),id(10)]);
  await db.query("update inventory_items set situation = 'Verificando' where id = $1",[id(101)]);
  const monitor = await one("select * from inventory_items where id=$1",[id(101)]);
  assert.equal(monitor.status,'Ativo'); assert.equal(monitor.location,'PDV 01');
  const ticket = await one("select * from control_items where verification_inventory_item_id=$1",[id(101)]);
  assert.equal(ticket.followup_kind,'verification'); assert.equal(ticket.status,'Aguardando avaliação');
  assert.equal((await one('select count(*)::int as n from inventory_item_logs')).n,1);
  await db.query("update inventory_items set tag='AJMON099' where id=$1",[id(101)]);
  assert.equal((await one("select tag from control_items where id=$1",[ticket.id])).tag,'AJMON099');
  assert.equal((await one("select count(*)::int as n from control_items")).n,1);
  await assert.rejects(db.query("update control_items set status='Verificação concluída' where id=$1",[ticket.id]), /Use a conclusão/);
  await assert.rejects(db.query("select public.complete_control_verification($1,$2,'', '{}'::jsonb)",[ticket.id,id(501)]), /resultado da verificação/);
  const completed = await one("select public.complete_control_verification($1,$2,'Teste concluído com sucesso','{}'::jsonb) as result",[ticket.id,id(501)]);
  assert.ok(completed.result.eventId);
  assert.equal((await one("select status from control_items where id=$1",[ticket.id])).status,'Verificação concluída');
  const restored = await one("select status,situation,location from inventory_items where id=$1",[id(101)]);
  assert.deepEqual(restored,{status:'Ativo',situation:'Normal',location:'PDV 01'});
  const again = await one("select public.complete_control_verification($1,$2,'Teste concluído com sucesso','{}'::jsonb) as result",[ticket.id,id(501)]);
  assert.equal(again.result.alreadyApplied,true);
  assert.equal((await one("select count(*)::int as n from equipment_events")).n,2);
  await db.query("update inventory_items set situation='Verificando' where id=$1",[id(101)]);
  assert.equal((await one("select count(*)::int as n from control_items")).n,2);
  assert.equal((await one("select status from control_items where id=$1",[ticket.id])).status,'Verificação concluída');
  await assert.rejects(db.query("update inventory_items set status='Manutenção' where id=$1",[id(101)]),/conclua a verificação/i);
  const secondVerification=await one("select id from control_items where verification_inventory_item_id=$1 and status='Aguardando avaliação'",[id(101)]);
  await db.query("select public.complete_control_verification($1,$2,'Defeito identificado, avaliação encerrada','{}'::jsonb)",[secondVerification.id,id(504)]);
  await db.query("update inventory_items set status='Manutenção' where id=$1",[id(101)]);
  assert.equal((await one("select count(*)::int as n from control_items where followup_kind='maintenance'")).n,1);
  const reusedMaintenance=await one("select id from control_items where inventory_item_id=$1 and status='Em manutenção'",[id(101)]);
  await db.query("update inventory_items set situation='Verificando' where id=$1",[id(101)]);
  assert.equal((await one("select count(*)::int as n from control_items where followup_kind='verification'")).n,2);
  assert.equal((await one("select count(*)::int as n from equipment_events where metadata->>'reusedMaintenance'='true'")).n,1);
  await db.query("select public.complete_control_maintenance($1,'Reserva',$2,'{}'::jsonb)",[reusedMaintenance.id,id(505)]);
  assert.deepEqual(await one("select status,situation,location from inventory_items where id=$1",[id(101)]),{status:'Reserva',situation:'Normal',location:'PDV 01'});

  const peripherals=[{id:'monitor',type:'Monitor',sourceItemId:id(101)}];
  await db.query("insert into module_records(id,table_id,management_computer_id,payload) values($1,$2,$3,$4)",[id(201),id(20),id(301),JSON.stringify({equipment:'Caixa 01',tag:'AJPCCX01',serial:'SER-PC-001',status:'Ativo',situation:'Em Uso',terminal:'PDV 01',location:'PDV 01',peripherals,logs:[]})]);
  await db.query("update module_records set payload=jsonb_set(payload,'{situation}','\"Verificando\"') where id=$1",[id(201)]);
  const pc = await one("select payload from module_records where id=$1",[id(201)]);
  assert.equal(pc.payload.status,'Ativo'); assert.equal(pc.payload.location,'PDV 01'); assert.deepEqual(pc.payload.peripherals,peripherals);
  const pcTicket = await one("select * from control_items where verification_computer_id=$1",[id(301)]);
  assert.equal(pcTicket.status,'Aguardando avaliação');
  const technicalLog=await one("insert into control_item_logs(control_item_id,action,message) values($1,'update','Primeira análise técnica') returning id",[pcTicket.id]);
  let technicalHistory=(await db.query("select * from public.management_technical_history($1)",[id(301)])).rows;
  assert.equal(technicalHistory.length,2);
  assert.ok(technicalHistory.some(row=>row.action==='Registro técnico'));
  await db.query("update control_item_logs set message='Análise técnica revisada' where id=$1",[technicalLog.id]);
  technicalHistory=(await db.query("select * from public.management_technical_history($1)",[id(301)])).rows;
  assert.equal(technicalHistory.length,3);
  assert.deepEqual((await one("select payload->'logs' as logs from module_records where id=$1",[id(201)])).logs,[]);
  await assert.rejects(db.query("update control_item_logs set message='Tentativa de sobrescrever início automático' where control_item_id=$1 and action='create'",[pcTicket.id]),/automático imutável/);
  assert.equal((await one("select count(*)::int as n from control_items where verification_computer_id=$1",[id(301)])).n,1);
  await assert.rejects(db.query("update module_records set payload=jsonb_set(payload,'{status}','\"Reserva\"') where id=$1",[id(201)]), /Conclua a verificação/);
  const oldPayload = pc.payload;
  await db.query("update inventory_items set situation='Verificando' where id=$1",[id(101)]);
  await db.exec("create function app.test_log_failure() returns trigger language plpgsql as $$ begin raise exception 'Falha simulada'; end $$;create trigger test_log_failure before insert on inventory_item_logs for each row execute function app.test_log_failure();");
  const secondMonitorTicket = await one("select id from control_items where followup_kind='verification' and status='Aguardando avaliação' and verification_inventory_item_id=$1",[id(101)]);
  await assert.rejects(db.query("select public.complete_control_verification($1,$2,'Conclusão simulada','{}'::jsonb)",[secondMonitorTicket.id,id(502)]), /Falha simulada/);
  assert.equal((await one("select status from control_items where id=$1",[secondMonitorTicket.id])).status,'Aguardando avaliação');
  assert.equal((await one("select count(*)::int as n from equipment_events where source_event_key=$1",['verification-complete:'+id(502)])).n,0);
  await db.exec('drop trigger test_log_failure on inventory_item_logs');
  await db.query("select public.complete_control_verification($1,$2,'PC aprovado na avaliação','{}'::jsonb)",[pcTicket.id,id(503)]);
  const pcAfter = await one("select payload from module_records where id=$1",[id(201)]);
  assert.equal(pcAfter.payload.situation,'Em Uso');
  assert.equal(pcAfter.payload.status,oldPayload.status);
  assert.equal(pcAfter.payload.location,oldPayload.location);
  assert.deepEqual(pcAfter.payload.peripherals,oldPayload.peripherals);
  assert.deepEqual(pcAfter.payload.logs,[]);
  assert.equal((await db.query("select * from public.management_technical_history($1)",[id(301)])).rows.length,4);
  await db.exec('alter table inventory_items disable trigger inventory_technical_verification_sync');
  await db.query("insert into inventory_items(id,table_id,equipment,tag,status,situation,location) values($1,$2,'Monitor legado','LEGACY','Ativo','Verificando','PDV 02')",[id(102),id(10)]);
  await db.exec('alter table inventory_items enable trigger inventory_technical_verification_sync');
  await db.query("update inventory_items set tag='AJMON002' where id=$1",[id(102)]);
  assert.equal((await one("select count(*)::int as n from control_items where verification_inventory_item_id=$1",[id(102)])).n,0);
  await assert.rejects(db.query('delete from control_items where id=$1',[ticket.id]), /histórico permanente/);
  await assert.rejects(db.query('delete from module_records where id=$1',[id(201)]), /acompanhamento técnico/);
  console.log('PASS: 094 isolada — início, reaproveitamento/idempotência, conclusão, novo episódio, status/local preservados, logs correlacionados, bloqueios e rollback.');
} catch (error) { console.error('Falha PostgreSQL:', error.message, error.code || '', error.where || (error.stack || '').split('\n').slice(0,4).join('\n')); process.exitCode = 1; } finally { await db.close(); }
