import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Laboratório isolado: nenhum cliente Supabase, URL remota ou dado de produção.
// O esquema mínimo reproduz as identidades estáveis da 087 e os vínculos da 086.
const db = new PGlite();
const ids = {
  reserve: '10000000-0000-4000-8000-000000000001',
  pdv01: '10000000-0000-4000-8000-000000000002',
  pdv02: '10000000-0000-4000-8000-000000000003',
  caixa16: '20000000-0000-4000-8000-000000000016',
  caixa01: '20000000-0000-4000-8000-000000000001',
  monitor: '30000000-0000-4000-8000-000000000001',
};
const pcFields = ['equipment', 'tag', 'serial', 'brand', 'model', 'status', 'location'];
const validStatuses = new Set(['Ativo', 'Reserva', 'Defeito', 'Manutenção', 'Inativo']);

const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];
const clone = value => structuredClone(value);
const pcOnly = payload => Object.fromEntries(pcFields.filter(key => key in payload).map(key => [key, payload[key]]));
const positionOnly = payload => Object.fromEntries(Object.entries(payload).filter(([key]) => !pcFields.includes(key)));

async function setup() {
  await db.exec(`
    create table module_records (
      id uuid primary key,
      payload jsonb not null,
      management_computer_id uuid unique deferrable initially deferred,
      revision integer not null default 0,
      check ((nullif(btrim(coalesce(payload->>'equipment', '')), '') is not null)
        = (management_computer_id is not null))
    );
    create table inventory_items (id uuid primary key, tag text not null unique, location text not null);
    create table equipment_events (
      id uuid primary key,
      source_module text not null,
      source_event_key text not null,
      reason text not null,
      metadata jsonb not null,
      created_at timestamptz not null default now(),
      unique (source_module, source_event_key)
    );
    create table control_items (
      id uuid primary key default gen_random_uuid(),
      management_record_id uuid not null references module_records(id),
      computer_id uuid not null,
      tag text not null,
      status text not null,
      created_by_event_id uuid not null references equipment_events(id)
    );
    create unique index one_open_ticket_per_computer
      on control_items(computer_id) where status = 'Em manutenção';
    create table sync_events (
      id uuid primary key default gen_random_uuid(),
      event_id uuid not null unique references equipment_events(id),
      details jsonb not null
    );
    create function guard_pdv_peripherals() returns trigger language plpgsql as $$
    declare peripheral jsonb;
    begin
      if tg_op = 'UPDATE' and old.payload->>'terminal' like 'PDV %' then
        if new.payload->>'terminal' is distinct from old.payload->>'terminal'
          or new.payload->'peripherals' is distinct from old.payload->'peripherals' then
          raise exception 'Periféricos e posição física do PDV não acompanham o computador.';
        end if;
      end if;
      if new.payload->>'terminal' like 'PDV %' then
        for peripheral in select value from jsonb_array_elements(coalesce(new.payload->'peripherals', '[]'::jsonb)) loop
          if not exists (select 1 from inventory_items i
            where i.id::text = peripheral->>'sourceItemId'
              and i.tag = peripheral->>'status'
              and i.location = new.payload->>'terminal') then
            raise exception 'Periférico divergente do Inventário.';
          end if;
        end loop;
      end if;
      return new;
    end;
    $$;
    create trigger guard_pdv_peripherals before insert or update on module_records
      for each row execute function guard_pdv_peripherals();
  `);
  await db.query('insert into inventory_items values ($1, $2, $3)', [ids.monitor, 'MON001', 'PDV 01']);
  const reserve = { terminal: 'RES 02', area: 'Frente de Loja', peripherals: [], logs: [],
    equipment: 'Caixa 16', tag: 'CX016', serial: 'SER016', brand: 'Marca fictícia',
    model: 'Modelo fictício', status: 'Reserva', location: 'Sala CPD' };
  const pdv01 = { terminal: 'PDV 01', area: 'Frente de Loja',
    peripherals: [{ sourceModule: 'inventory', sourceItemId: ids.monitor, status: 'MON001', type: 'monitor' }],
    logs: [], equipment: 'Caixa 01', tag: 'CX001', serial: 'SER001',
    status: 'Ativo', location: 'PDV 01' };
  const pdv02 = { terminal: 'PDV 02', area: 'Frente de Loja', peripherals: [], logs: [] };
  for (const [id, computerId, payload] of [
    [ids.reserve, ids.caixa16, reserve], [ids.pdv01, ids.caixa01, pdv01], [ids.pdv02, null, pdv02],
  ]) {
    await db.query('insert into module_records(id, management_computer_id, payload) values($1,$2,$3)',
      [id, computerId, JSON.stringify(payload)]);
  }
}

// Implementação de laboratório, não RPC de produção. Reproduz a operação
// planejada em uma transação real do PostgreSQL embarcado.
async function move(plan, { failAfterUpdates = false } = {}) {
  const request = clone(plan);
  return db.transaction(async tx => {
    const repeated = await one(tx, `select * from equipment_events
      where source_module = 'management' and source_event_key = $1`, [plan.operationId]);
    if (repeated) {
      assert.deepEqual(repeated.metadata.request, request, 'ID de operação reutilizado com outro plano');
      return { eventId: repeated.id, repeated: true };
    }
    if (!['replace', 'direct'].includes(plan.mode) || !plan.confirmed || !plan.reason?.trim())
      throw new Error('Modalidade, motivo e confirmação são obrigatórios.');
    if (!validStatuses.has(plan.incomingStatus) || !plan.incomingLocation?.trim())
      throw new Error('Status e local final do computador de entrada são obrigatórios.');
    if (plan.sourceId === plan.targetId) throw new Error('Origem e destino devem ser diferentes.');
    const selectedIds = [...new Set([plan.sourceId, plan.targetId, plan.outgoingDestinationId].filter(Boolean))];
    const { rows } = await tx.query('select * from module_records where id = any($1::uuid[]) order by id for update',
      [selectedIds]);
    if (rows.length !== selectedIds.length) throw new Error('Posição não encontrada.');
    const byId = new Map(rows.map(row => [row.id, row]));
    const source = byId.get(plan.sourceId);
    const target = byId.get(plan.targetId);
    const outgoingDestination = plan.outgoingDestinationId ? byId.get(plan.outgoingDestinationId) : null;
    if (source.revision !== plan.sourceRevision || target.revision !== plan.targetRevision)
      throw new Error('Conflito: posição alterada por outra movimentação.');
    if (outgoingDestination && outgoingDestination.id !== source.id
      && outgoingDestination.revision !== plan.outgoingDestinationRevision)
      throw new Error('Conflito: destino do computador retirado mudou.');
    if (!source.management_computer_id) throw new Error('Origem sem computador.');
    const occupied = Boolean(target.management_computer_id);
    if (plan.mode === 'direct' && occupied)
      throw new Error('PDV ocupado: use o fluxo de substituição.');
    if (plan.mode === 'replace' && !occupied)
      throw new Error('Substituição exige computador no destino.');
    if (occupied && (!outgoingDestination || !validStatuses.has(plan.outgoingStatus)
      || !plan.outgoingLocation?.trim()))
      throw new Error('Computador retirado exige destino, status e local confirmados.');
    if (!occupied && outgoingDestination) throw new Error('Destino de retirada inesperado.');
    if (outgoingDestination && outgoingDestination.id !== source.id && outgoingDestination.management_computer_id)
      throw new Error('Destino do computador retirado já está ocupado.');
    if (target.payload.terminal?.startsWith('PDV ') && plan.incomingLocation !== target.payload.terminal)
      throw new Error('Local confirmado deve ser o PDV de destino.');

    const incomingBefore = pcOnly(source.payload);
    const outgoingBefore = occupied ? pcOnly(target.payload) : null;
    const incomingAfter = { ...incomingBefore, status: plan.incomingStatus, location: plan.incomingLocation };
    const outgoingAfter = occupied
      ? { ...outgoingBefore, status: plan.outgoingStatus, location: plan.outgoingLocation }
      : null;
    const next = new Map(rows.map(row => [row.id, {
      ...positionOnly(row.payload), logs: clone(row.payload.logs || []),
    }]));
    Object.assign(next.get(target.id), incomingAfter);
    if (occupied) Object.assign(next.get(outgoingDestination.id), outgoingAfter);
    const nextComputerIds = new Map([[source.id, null], [target.id, source.management_computer_id]]);
    if (occupied) nextComputerIds.set(outgoingDestination.id, target.management_computer_id);
    const affected = [source, target, ...(outgoingDestination && outgoingDestination.id !== source.id ? [outgoingDestination] : [])];
    const metadata = {
      request, positions: affected.map(row => row.id),
      computers: [
        { id: source.management_computer_id, before: incomingBefore, after: incomingAfter,
          from: source.id, to: target.id },
        ...(occupied ? [{ id: target.management_computer_id, before: outgoingBefore,
          after: outgoingAfter, from: target.id, to: outgoingDestination.id }] : []),
      ],
      inventoryPeripheralIds: [ids.monitor],
    };
    for (const row of affected) {
      const message = { eventId: plan.operationId, type: 'computer-movement',
        reason: plan.reason, computers: metadata.computers.map(pc => pc.id) };
      next.get(row.id).logs.push(message);
      await tx.query(`update module_records set payload=$2, management_computer_id=$3,
        revision=revision+1 where id=$1`, [row.id, JSON.stringify(next.get(row.id)), nextComputerIds.get(row.id)]);
    }
    if (failAfterUpdates) throw new Error('Falha simulada após atualizar posições.');
    await tx.query(`insert into equipment_events(id,source_module,source_event_key,reason,metadata)
      values($1,'management',$2,$3,$4)`, [plan.operationId, plan.operationId, plan.reason, JSON.stringify(metadata)]);
    await tx.query('insert into sync_events(event_id,details) values($1,$2)',
      [plan.operationId, JSON.stringify({ affectedPositions: metadata.positions, computerIds: metadata.computers.map(pc => pc.id) })]);
    for (const pc of metadata.computers) {
      await tx.query('update control_items set management_record_id=$1 where computer_id=$2', [pc.to, pc.id]);
      if (['Defeito', 'Manutenção'].includes(pc.after.status)) {
        await tx.query(`insert into control_items(management_record_id,computer_id,tag,status,created_by_event_id)
          select $1,$2,$3,'Em manutenção',$4
          where not exists (select 1 from control_items where computer_id=$2 and status='Em manutenção')`,
        [pc.to, pc.id, pc.after.tag || '', plan.operationId]);
      }
    }
    return { eventId: plan.operationId, repeated: false };
  });
}

async function snapshot() {
  const positions = (await db.query('select * from module_records order by id')).rows;
  const events = (await db.query('select * from equipment_events order by created_at,id')).rows;
  const tickets = (await db.query('select * from control_items order by id')).rows;
  const syncs = (await db.query('select * from sync_events order by id')).rows;
  const peripheral = await one(db, 'select * from inventory_items where id=$1', [ids.monitor]);
  return { positions, events, tickets, syncs, peripheral };
}

async function main() {
  await setup();
  const base = await snapshot();
  const [reserve, pdv01] = [base.positions.find(row => row.id === ids.reserve),
    base.positions.find(row => row.id === ids.pdv01)];
  const swap = {
    operationId: randomUUID(), mode: 'replace', confirmed: true,
    sourceId: ids.reserve, targetId: ids.pdv01, outgoingDestinationId: ids.reserve,
    sourceRevision: reserve.revision, targetRevision: pdv01.revision,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 01',
    outgoingStatus: 'Defeito', outgoingLocation: 'Sala CPD',
    reason: 'Teste fictício: substituição do computador do PDV 01',
  };
  const invalid = { ...swap, operationId: randomUUID(), outgoingLocation: '' };
  await assert.rejects(move(invalid), /destino, status e local/);
  assert.deepEqual(await snapshot(), base, 'validação não pode alterar nada');
  await assert.rejects(move(swap, { failAfterUpdates: true }), /Falha simulada/);
  assert.deepEqual(await snapshot(), base, 'falha parcial deve reverter toda a transação');
  const first = await move(swap);
  assert.equal(first.repeated, false);
  const afterSwap = await snapshot();
  const reserveAfter = afterSwap.positions.find(row => row.id === ids.reserve);
  const pdvAfter = afterSwap.positions.find(row => row.id === ids.pdv01);
  assert.equal(pdvAfter.management_computer_id, ids.caixa16);
  assert.equal(pdvAfter.payload.equipment, 'Caixa 16');
  assert.equal(pdvAfter.payload.status, 'Ativo');
  assert.equal(pdvAfter.payload.location, 'PDV 01');
  assert.equal(reserveAfter.management_computer_id, ids.caixa01);
  assert.equal(reserveAfter.payload.status, 'Defeito');
  assert.equal(reserveAfter.payload.location, 'Sala CPD');
  assert.deepEqual(pdvAfter.payload.peripherals, pdv01.payload.peripherals);
  assert.equal(afterSwap.peripheral.location, 'PDV 01');
  assert.equal(afterSwap.events.length, 1);
  assert.equal(afterSwap.syncs.length, 1);
  assert.equal(afterSwap.tickets.length, 1);
  assert.equal(afterSwap.tickets[0].computer_id, ids.caixa01);
  assert.equal(afterSwap.tickets[0].management_record_id, ids.reserve);
  assert.equal(afterSwap.events[0].metadata.computers.length, 2);
  assert.equal(pdvAfter.payload.logs.at(-1).eventId, swap.operationId);
  assert.equal(reserveAfter.payload.logs.at(-1).eventId, swap.operationId);
  assert.equal((await move(swap)).repeated, true);
  assert.deepEqual(await snapshot(), afterSwap, 'reenvio não pode duplicar evento, chamado ou log');
  await assert.rejects(move({ ...swap, reason: 'Outro motivo' }), /ID de operação reutilizado/);

  const beforeDirect = await snapshot();
  const currentPdv01 = beforeDirect.positions.find(row => row.id === ids.pdv01);
  const emptyPdv02 = beforeDirect.positions.find(row => row.id === ids.pdv02);
  const direct = { operationId: randomUUID(), mode: 'direct', confirmed: true,
    sourceId: ids.pdv01, targetId: ids.pdv02,
    sourceRevision: currentPdv01.revision, targetRevision: emptyPdv02.revision,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 02',
    reason: 'Teste fictício: transferência para posição vazia' };
  await assert.rejects(move({ ...direct, operationId: randomUUID(),
    targetId: ids.reserve, targetRevision: reserveAfter.revision }), /PDV ocupado/);
  assert.deepEqual(await snapshot(), beforeDirect);
  await move(direct);
  const afterDirect = await snapshot();
  assert.equal(afterDirect.positions.find(row => row.id === ids.pdv02).payload.equipment, 'Caixa 16');
  assert.equal(afterDirect.positions.find(row => row.id === ids.pdv01).management_computer_id, null);
  assert.deepEqual(afterDirect.positions.find(row => row.id === ids.pdv01).payload.peripherals,
    pdv01.payload.peripherals);
  assert.equal(afterDirect.peripheral.location, 'PDV 01');
  assert.equal(afterDirect.events.length, 2);
  assert.equal(afterDirect.syncs.length, 2);
  assert.equal(afterDirect.tickets.length, 1);

  const raceBase = afterDirect.positions.find(row => row.id === ids.pdv02);
  const raceTarget = afterDirect.positions.find(row => row.id === ids.pdv01);
  const concurrent = [randomUUID(), randomUUID()].map(operationId => ({
    ...direct, operationId, sourceId: ids.pdv02, targetId: ids.pdv01,
    sourceRevision: raceBase.revision, targetRevision: raceTarget.revision,
    incomingLocation: 'PDV 01', reason: 'Teste fictício: dois operadores no mesmo PDV',
  }));
  const race = await Promise.allSettled(concurrent.map(plan => move(plan)));
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected').length, 1);
  assert.match(race.find(result => result.status === 'rejected').reason.message, /Conflito/);
  const afterRace = await snapshot();
  assert.equal(afterRace.positions.find(row => row.id === ids.pdv01).management_computer_id, ids.caixa16);
  assert.equal(afterRace.positions.find(row => row.id === ids.pdv02).management_computer_id, null);
  assert.deepEqual(afterRace.positions.find(row => row.id === ids.pdv01).payload.peripherals,
    pdv01.payload.peripherals);
  assert.equal(afterRace.events.length, 3);
  assert.equal(afterRace.tickets.length, 1);
  assert.equal(afterRace.events.filter(event => event.metadata.computers.some(pc => pc.id === ids.caixa16)).length, 3);
  assert.equal(afterRace.events.filter(event => event.metadata.positions.includes(ids.pdv01)).length, 3);

  const stale = { ...direct, operationId: randomUUID(), sourceId: ids.pdv02,
    targetId: ids.pdv01, incomingLocation: 'PDV 01',
    sourceRevision: emptyPdv02.revision, targetRevision: currentPdv01.revision };
  await assert.rejects(move(stale), /Conflito/);
  assert.deepEqual(await snapshot(), afterRace);
  console.log('OK: validações, rollback, troca Reserva ↔ PDV, status independentes, periférico,');
  console.log('    chamado único, evento/logs, reenvio idempotente, transferência direta e conflito concorrente.');
  console.log(`Ambiente: PostgreSQL embarcado em memória; ${afterRace.events.length} eventos fictícios; Supabase não acessado.`);
}

try {
  await main();
} finally {
  await db.close();
}
