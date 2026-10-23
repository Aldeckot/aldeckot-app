import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = require('../home-operations-model.js');
const now = new Date('2026-10-22T15:00:00Z');
const source = () => ({
  inventory: [{ id:'inv-pc', equipment:'Computador', status:'Ativo', serial:'SER-ONE', tag:'PC1',
    createdAt:'2026-10-02' }],
  management: [{ id:'position', computerId:'pc-one', inventoryItemId:'inv-pc', equipment:'Caixa 01',
    status:'Ativo', serial:'SER-ONE', tag:'PC1', createdAt:'2026-10-03' }],
  control: [
    { id:'open-maint', status:'Em manutenção', entryDate:'2026-09-10', createdAt:'2026-09-10' },
    { id:'open-ver', status:'Aguardando avaliação', followUpKind:'verification', entryDate:'2026-10-18', createdAt:'2026-10-18' },
    { id:'done', status:'Manutenção concluída', exitDate:'2026-10-12', createdAt:'2026-09-01' }
  ],
  flux: [{ id:'moving', status:'Em trânsito', createdAt:'2026-09-01' },
    { id:'received', status:'Recebido', createdAt:'2026-10-01', receivedDate:'2026-10-20' }],
  nfe: [{ id:'fiscal', nfeNumber:'123', occurredAt:'2026-10-21T12:00:00-03:00' }],
  events: [{ id:'complete-event', sourceId:'done', action:'Manutenção concluída', createdAt:'2026-10-12T15:00:00Z' }],
  health: {}
});
test('intervalo incompleto ou invertido não vira zero confirmado', () => {
  for (const [from,to] of [['','2026-10-20'],['2026-10-22','2026-10-20']]) {
    const view=build(source(),{mode:'activity',period:'custom',from,to},now);
    assert.equal(view.invalidPeriod,true);
    assert.equal(view.partial,true);
    assert.equal(view.total,0);
  }
});
test('modos separam fatos históricos de processos abertos e deduplicam computador compartilhado', () => {
  const data = source();
  const activity = build(data,{ mode:'activity', period:'month' },now);
  const open = build(data,{ mode:'open', period:'all' },now);
  assert.equal(activity.categories.find(row => row.key === 'registered').rows.length,1);
  assert.equal(activity.categories.find(row => row.key === 'maintenanceDone').rows.length,1);
  assert.equal(open.categories.find(row => row.key === 'maintenanceOpen').rows.length,1);
  assert.equal(open.categories.find(row => row.key === 'verificationOpen').rows.length,1);
  assert.equal(open.categories.find(row => row.key === 'ticketOpen').rows.length,0);
  assert.equal(open.categories.find(row => row.key === 'transferOpen').rows.length,1);
  assert.equal(open.total,open.categories.reduce((sum,row)=>sum+row.rows.length,0));
  assert.equal(activity.total,activity.categories.reduce((sum,row)=>sum+row.rows.length,0));
  assert.equal(open.rows.some(row => row.id === 'done'),false);
});
test('filtros combinam módulo, tipo e datas inclusivas sem alterar a origem', () => {
  const data = source();
  const view = build(data,{ mode:'activity', module:'control', type:'maintenanceDone',
    period:'custom', from:'2026-10-12', to:'2026-10-12' },now);
  assert.equal(view.total,1);
  assert.equal(view.rows[0].id,'done');
  assert.equal(view.categories.reduce((sum,row)=>sum+row.rows.length,0),1);
  assert.equal(build(data,{ mode:'activity',module:'control',type:'maintenanceDone',
    period:'custom',from:'2026-10-13',to:'2026-10-31' },now).total,0);
  assert.equal(data.control.length,3);
});
test('falha de fonte não se apresenta como zero confiável', () => {
  const data=source();
  delete data.control;
  data.health.control={unavailable:true,error:'Falha'};
  const view=build(data,{mode:'open',period:'all'},now);
  assert.equal(view.partial,true);
  assert.ok(view.missing.includes('control'));
});
