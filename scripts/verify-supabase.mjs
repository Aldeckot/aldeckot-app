import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = resolve(process.cwd(), 'outputs', 'aldeckot');
const configWindow = {};
new Function('window', readFileSync(resolve(base, 'supabase-config.js'), 'utf8'))(configWindow);
const { url, publishableKey } = configWindow.ALDECKOT_SUPABASE_CONFIG || {};

if (!url || !publishableKey) throw new Error('Gere supabase-config.js antes de validar a conexão.');

const sdkText = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js')).text();
const sdk = new Function(`${sdkText}; return supabase;`)();
const client = sdk.createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const verify = async response => {
  if (response.error) throw new Error(response.error.message);
  return response.data;
};
const testName = `__aldeckot_validation_${Date.now()}`;
const testTag = `VAL-${Date.now()}`;
const created = { inventoryTable: null, controlTable: null, fluxTable: null, managementTable: null, managementRecord: null, managementEvent: null, agenda: null, backup: null, managementBackup: null, controlBackup: null, fluxBackup: null, sync: null, userId: null };

try {
  const session = await verify(await client.auth.signInAnonymously());
  if (!session.session?.user) throw new Error('A sessão anônima não foi criada. Ative Anonymous Sign-Ins no Supabase.');
  created.userId = session.session.user.id;
  console.log('✓ Sessão anônima e RLS autenticado');

  created.inventoryTable = await verify(await client.from('module_tables').insert({ module: 'inventory', name: testName, icon: '🧪' }).select().single());
  const item = await verify(await client.from('inventory_items').insert({ table_id: created.inventoryTable.id, equipment: 'Validação ALDECKOT', model: 'Teste', serial: 'SERIAL-VALIDACAO', tag: testTag, status: 'Ativo', situation: 'Normal', cleaning_type: 'Preventiva' }).select().single());
  await verify(await client.from('inventory_item_logs').insert({ inventory_item_id: item.id, action: 'create', message: 'Validação temporária.' }));
  console.log('✓ Inventário, relação e log');

  let agendaResponse = await client.from('agenda_entries').insert({ kind: 'task', title: 'Validação temporária', due_date: '2030-01-01', reminder_minutes: 0, priority: 'normal' }).select().single();
  if (/(?:priority.*(?:column|schema cache)|column.*priority)/i.test(agendaResponse.error?.message || '')) {
    agendaResponse = await client.from('agenda_entries').insert({ kind: 'task', title: 'Validação temporária', due_date: '2030-01-01', reminder_minutes: 0, notes: '[[aldeckot:priority:normal]]\n' }).select().single();
    console.log('✓ Agenda com compatibilidade de nível');
  } else console.log('✓ Agenda e nível');
  created.agenda = await verify(agendaResponse);

  created.controlTable = await verify(await client.from('module_tables').insert({ module: 'control', name: `${testName}_control`, icon: '🧪' }).select().single());
  const controlItem = await verify(await client.from('control_items').insert({ table_id: created.controlTable.id, equipment: 'Validação Controle TI', model: 'Teste', tag: testTag, serial: item.serial, status: 'Em uso', cleaning_type: 'Preventiva' }).select().single());
  await verify(await client.from('control_item_logs').insert({ control_item_id: controlItem.id, action: 'create', message: 'Validação temporária do Controle TI.' }));
  const synchronizedInventoryItem = await verify(await client.from('inventory_items').select('status').eq('id', item.id).single());
  if (synchronizedInventoryItem.status !== 'Atenção') throw new Error('O status do Inventário não foi sincronizado pelo Controle TI.');
  console.log('✓ Controle TI, relação e log');

  created.fluxTable = await verify(await client.from('module_tables').insert({ module: 'flux', name: `${testName}_flux`, icon: '🧪' }).select().single());
  const fluxItem = await verify(await client.from('flux_items').insert({
    table_id: created.fluxTable.id,
    movement: 'Envio',
    equipment: 'Validação Flux',
    model: 'Teste',
    brand: 'ALDECKOT',
    tag: testTag,
    serial: item.serial,
    sender_company: 'Empresa Remetente',
    destination_company: 'Empresa Destino',
    sender_responsible: 'Responsável Envio',
    receiver_responsible: 'Responsável Recebimento',
    send_date: '2030-01-01',
    received_date: '2030-01-02',
    shipping_type: 'Motoboy',
    reason: 'Transferência',
    status: 'Recebido'
  }).select().single());
  await verify(await client.from('flux_item_logs').insert({ flux_item_id: fluxItem.id, action: 'create', message: 'Validação temporária do Flux.' }));
  console.log('✓ Flux, relação e log');

  created.managementTable = await verify(await client.from('module_tables').insert({ module: 'management', name: `${testName}_management`, icon: '🖥️' }).select().single());
  created.managementRecord = await verify(await client.from('module_records').insert({
    table_id: created.managementTable.id,
    payload: {
      equipment: 'Validação Gestão TI',
      brand: 'ALDECKOT',
      model: 'Teste',
      tag: testTag,
      serial: item.serial,
      status: 'Ativo',
      lastActivity: 'Equipamento cadastrado no monitoramento.'
    }
  }).select().single());
  created.managementEvent = await verify(await client.from('sync_events').select('id, details').eq('module', 'management').contains('details', { itemId: created.managementRecord.id }).single());
  if (created.managementEvent.details?.targetUrl !== `management.html?item=${created.managementRecord.id}`) throw new Error('O evento da Gestão TI não recebeu o destino correto.');
  console.log('✓ Gestão TI, monitoramento e atividade automática');

  created.backup = await verify(await client.from('inventory_backups').insert({ label: 'Validação temporária', snapshot: { tables: [] }, source: 'network' }).select().single());
  await verify(await client.from('inventory_backup_settings').upsert({ owner_id: created.userId, automatic: false }));
  created.managementBackup = await verify(await client.from('management_backups').insert({ label: 'Validação temporária', snapshot: { data: { items: [] } }, source: 'network' }).select().single());
  await verify(await client.from('management_backup_settings').upsert({ owner_id: created.userId, automatic: false }));
  created.controlBackup = await verify(await client.from('control_backups').insert({ label: 'Validação temporária', snapshot: { tables: [] }, source: 'network' }).select().single());
  await verify(await client.from('control_backup_settings').upsert({ owner_id: created.userId, automatic: false }));
  created.fluxBackup = await verify(await client.from('flux_backups').insert({ label: 'Validação temporária', snapshot: { tables: [] }, source: 'network' }).select().single());
  await verify(await client.from('flux_backup_settings').upsert({ owner_id: created.userId, automatic: false }));
  created.sync = await verify(await client.from('sync_events').insert({
    module: 'inventory',
    operation: 'create',
    details: {
      validation: true,
      itemId: item.id,
      tableId: created.inventoryTable.id,
      tableName: testName,
      equipment: item.equipment,
      brand: '',
      serial: item.serial,
      tag: item.tag,
      status: item.status,
      description: 'Validação temporária do histórico global.',
      targetUrl: `inventory.html?table=${created.inventoryTable.id}&item=${item.id}`
    }
  }).select().single());
  const recentActivity = await verify(await client.from('sync_events').select('id').in('operation', ['create', 'update', 'delete', 'log']).eq('id', created.sync.id).single());
  if (!recentActivity?.id) throw new Error('O evento de atividade recente não foi localizado.');
  const centralMatches = await verify(await client.rpc('central_equipment_search', { search_term: testTag }));
  if (!centralMatches.some(row => row.id === item.id && row.tag === testTag)) throw new Error('A Central não localizou o equipamento pela TAG.');
  if (!centralMatches.some(row => row.id === fluxItem.id && row.module === 'flux')) throw new Error('A Central não localizou a movimentação do Flux pela TAG.');
  const centralTimeline = await verify(await client.rpc('central_equipment_timeline', { p_tag: testTag, p_serial: item.serial, p_item_ids: [item.id] }));
  if (!centralTimeline.some(row => row.id === created.sync.id)) throw new Error('A Central não localizou o evento do equipamento.');
  console.log('✓ Backup, preferência, sincronização, histórico global e Central do Equipamento');

  console.log('VALIDAÇÃO CONCLUÍDA: todas as chamadas do ALDECKOT estão funcionando.');
} finally {
  // A validação não deixa registros de negócio no projeto.
  if (created.agenda) await client.from('agenda_entries').delete().eq('id', created.agenda.id);
  if (created.backup) await client.from('inventory_backups').delete().eq('id', created.backup.id);
  if (created.managementBackup) await client.from('management_backups').delete().eq('id', created.managementBackup.id);
  if (created.controlBackup) await client.from('control_backups').delete().eq('id', created.controlBackup.id);
  if (created.fluxBackup) await client.from('flux_backups').delete().eq('id', created.fluxBackup.id);
  if (created.managementEvent) await client.from('sync_events').delete().eq('id', created.managementEvent.id);
  if (created.sync) await client.from('sync_events').delete().eq('id', created.sync.id);
  if (created.inventoryTable) await client.from('module_tables').delete().eq('id', created.inventoryTable.id);
  if (created.controlTable) await client.from('module_tables').delete().eq('id', created.controlTable.id);
  if (created.fluxTable) await client.from('module_tables').delete().eq('id', created.fluxTable.id);
  if (created.managementTable) await client.from('module_tables').delete().eq('id', created.managementTable.id);
  if (created.userId) await client.from('inventory_backup_settings').delete().eq('owner_id', created.userId);
  if (created.userId) await client.from('management_backup_settings').delete().eq('owner_id', created.userId);
  if (created.userId) await client.from('control_backup_settings').delete().eq('owner_id', created.userId);
  if (created.userId) await client.from('flux_backup_settings').delete().eq('owner_id', created.userId);
  await client.auth.signOut();
}
