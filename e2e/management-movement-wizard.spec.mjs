import { expect, test } from '@playwright/test';

// The browser never loads the real data client or sends a request outside localhost.
const fakeClient = `(() => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const at = '2026-10-18T12:00:00.000Z';
  const make = (id, computerId, terminal, equipment, status, location, peripherals = []) => ({
    id, computerId, tableId: 'test-table', terminal, equipment, status, location,
    tag: equipment ? 'TAG-' + id.slice(-1) : '', area: 'Frente de Loja',
    sector: 'Frente de Loja', isFixed: true, peripherals, monitoring: {}, logs: [],
    updatedAt: at, registeredAt: '2026-10-18', situation: 'Em Uso', cleaning: 'Preventiva'
  });
  const items = [
    make('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201', 'PDV 01', 'Caixa 01', 'Ativo', 'PDV 01', [{ type: 'Monitor', status: 'AJMON001', sourceModule: 'inventory', sourceItemId: '00000000-0000-4000-8000-000000000401' }]),
    make('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000202', 'RES 01', 'Caixa 15', 'Reserva', 'Sala CPD'),
    make('00000000-0000-4000-8000-000000000103', '', 'PDV 02', '', 'Inativo', ''),
    make('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000204', 'PDV 04', 'Caixa 04', 'Ativo', 'PDV 04')
  ];
  if (window.location.search.includes('photo-test'))
    items[0].imagePath = 'management/00000000-0000-4000-8000-000000000201.webp';
  const eventId = '00000000-0000-4000-8000-000000000301';
  items[0].logs = [
    { id: 'automatic', at, text: 'Movimentação confirmada.', eventId },
    { id: 'manual', at, text: 'Conferência manual.' }
  ];
  const historyEvent = {
    event_id: eventId, occurred_at: at, reason: 'Troca confirmada',
    metadata: {
      incoming: { id: items[0].computerId, from: items[1].id, to: items[0].id,
        before: { status: 'Reserva', location: 'Sala CPD' }, after: { status: 'Ativo', location: 'PDV 01' } },
      outgoing: { id: items[1].computerId, from: items[0].id, to: items[1].id,
        before: { status: 'Ativo', location: 'PDV 01' }, after: { status: 'Reserva', location: 'Sala CPD' } }
    }
  };
  const peripheralEvent = {
    event_id: '00000000-0000-4000-8000-000000000302', occurred_at: at,
    reason: 'Localização alterada no Inventário.',
    metadata: { peripheral: {
      equipment: 'Impressora MPR2', tag: 'IMPR002',
      fromPositionId: items[3].id, toPositionId: items[0].id,
      fromLocation: 'PDV 04', toLocation: 'PDV 01'
    } }
  };
  window.__testTransfers = [];
  window.__historyQueries = [];
  window.AldeckotSupabase = {
    init: async () => {},
    auth: { state: async () => ({ session: { user }, user, profile: {
      id: user.id, full_name: 'Teste Local', role: 'admin', status: 'active', module_permissions: {}
    }, isAdmin: true }) },
    management: {
      load: async () => ({ table: { id: 'test-table', name: 'Teste local' }, items }),
      peripheralInventoryStatuses: async () => [{ id: '00000000-0000-4000-8000-000000000401', tag: 'AJMON001', status: 'Ativo' }],
      movementHistory: async query => {
        window.__historyQueries.push(query);
        return query.computerId === items[0].computerId ? [historyEvent]
          : query.positionId === items[0].id ? [historyEvent, peripheralEvent] : [];
      },
      moveComputer: async (operationId, plan) => {
        window.__testTransfers.push({ operationId, plan });
        throw new Error('Simulação local: nenhuma gravação foi efetuada.');
      }
    },
    managementBackups: {
      list: async () => [], settings: async () => ({ automatic: false, frequency_days: 7 })
    }
  };
})();`;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-client.js') {
      return route.fulfill({ contentType: 'application/javascript', body: fakeClient });
    }
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-config.js') {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.ALDECKOT_SUPABASE_CONFIG = {};' });
    }
    if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/supabase-js@2')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase = {};' });
    }
    if (url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
});

test('distribuições usam barras e legendas mais vivas nos dois temas', async ({ page }) => {
  await page.goto('/management.html');
  await expect(page.locator('.management-chart')).toHaveCount(3);
  const bar = page.locator('.management-chart-bar').first();
  await expect(bar).toHaveCSS('filter', 'saturate(1.18)');
  await expect(page.locator('.management-chart-legend i').first()).toHaveCSS('width', '9px');
  await page.screenshot({ path: 'test-results/management-charts-dark.png', animations: 'disabled' });
  await page.evaluate(() => document.body.classList.add('theme-light'));
  await expect(bar).toHaveCSS('filter', 'saturate(1.2) contrast(1.07)');
  await page.screenshot({ path: 'test-results/management-charts-light.png', animations: 'disabled' });
});

test('monitor AJMON vinculado ao terminal aparece nas informações do PC atual', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000101');
  await expect(page.locator('.mini-status').first()).toHaveCSS('border-radius', '5px');
  const monitor = page.locator('.management-asset-peripheral').filter({ hasText: 'AJMON001' });
  await expect(monitor).toBeVisible();
  await expect(monitor.locator('strong')).toHaveText('Monitor');
  await expect(monitor.locator('small')).toHaveText('TAG AJMON001');
  await expect(monitor.locator('em')).toHaveText('Ativo');
});

test('substituição exige revisão e confirmação dos locais antes de enviar', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000102');
  // Isolated tests block decorative remote assets; their resource warning must not cover the wizard.
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await expect(page.locator('#managementDetailTitle')).toContainText('RES 01');
  await page.locator('[data-management-action="transfer"]').click();
  if (process.env.ALDECKOT_CAPTURE_WIZARD) {
    await page.screenshot({ path: 'test-results/management-transfer-step-1.png', animations: 'disabled' });
  }
  await page.locator('[data-management-transfer-mode="replace-other"]').click();
  if (process.env.ALDECKOT_CAPTURE_WIZARD) {
    await page.screenshot({ path: 'test-results/management-transfer-step-2.png', animations: 'disabled' });
  }
  await page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000101"]').click();
  await expect(page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000101"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(0);
  await page.locator('[data-management-action="confirm-transfer-destination"]').click();
  await expect(page.locator('.management-transfer-panel').first()).toContainText('Computador retirado');
  await expect(page.locator('.management-transfer-panel').first()).toContainText('Caixa 01');
  await expect(page.locator('[name="incomingStatus"], [name="incomingLocation"]')).toHaveCount(0);
  await expect(page.locator('.management-transfer-panel').last()).toContainText('Ativo (automático)');
  await page.locator('[name="outgoingDestinationId"]').selectOption('00000000-0000-4000-8000-000000000102');
  await page.locator('[name="outgoingStatus"]').selectOption('Defeito');
  await page.locator('[name="reason"]').fill('Teste fictício de troca');
  await expect(page.locator('[data-management-reason-label]')).toHaveText('Qual defeito foi identificado neste computador?');
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await expect(page.locator('.management-transfer-review')).toContainText('Caixa 01');
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(0);
  await expect(page.locator('[data-management-final-confirm]')).toBeDisabled();
  await page.locator('[name="confirmedLocations"]').check();
  await expect(page.locator('[data-management-final-confirm]')).toBeEnabled();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(1);
  const [{ plan }] = await page.evaluate(() => window.__testTransfers);
  expect(plan).toMatchObject({
    mode: 'replace-other', incomingStatus: 'Ativo', incomingLocation: 'PDV 01',
    outgoingStatus: 'Defeito', outgoingLocation: 'Sala CPD',
    reason: 'Teste fictício de troca', confirmedLocations: true
  });
});

test('substituição iniciada pelo PDV usa o mesmo plano explícito', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000101');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.locator('[data-management-action="transfer"]').click();
  await page.locator('[data-management-transfer-mode="be-replaced"]').click();
  await page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000102"]').click();
  await page.locator('[data-management-action="confirm-transfer-destination"]').click();
  await page.locator('[name="outgoingDestinationId"]').selectOption('00000000-0000-4000-8000-000000000102');
  await page.locator('[name="outgoingStatus"]').selectOption('Reserva');
  await page.locator('[name="reason"]').fill('Substituição inversa fictícia');
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('[name="confirmedLocations"]').check();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(1);
  const [{ plan }] = await page.evaluate(() => window.__testTransfers);
  expect(plan).toMatchObject({
    mode: 'be-replaced', sourceId: '00000000-0000-4000-8000-000000000102',
    targetId: '00000000-0000-4000-8000-000000000101',
    outgoingDestinationId: '00000000-0000-4000-8000-000000000102'
  });
});

test('computador de outro PDV não aparece como substituto disponível', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000101');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.locator('[data-management-action="transfer"]').click();
  await expect(page.locator('[data-management-transfer-mode="replace-other"]')).toBeDisabled();
  await page.locator('[data-management-transfer-mode="be-replaced"]').click();
  await page.locator('[data-management-transfer-filter="available"]').click();
  await expect(page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000102"]')).toBeVisible();
  await expect(page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000104"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(0);
});

test('busca e filtros da etapa 2 não confirmam destino oculto nem gravam dados', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000102');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.locator('[data-management-action="transfer"]').click();
  await page.locator('[data-management-transfer-mode="replace-other"]').click();
  const card = page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000101"]');
  const confirm = page.locator('[data-management-action="confirm-transfer-destination"]');
  const search = page.locator('[data-management-transfer-query]');
  await expect(confirm).toBeDisabled();
  await search.fill('não existe');
  await expect(card).toBeHidden();
  await expect(page.locator('[data-management-transfer-empty]')).toBeVisible();
  await search.fill('PDV 01');
  await expect(card).toBeVisible();
  await card.click();
  await expect(confirm).toBeEnabled();
  await page.locator('[data-management-transfer-filter="available"]').click();
  await expect(card).toBeHidden();
  await expect(confirm).toBeDisabled();
  await expect(page.locator('[data-management-selected-destination-label]')).toHaveText('Escolha uma posição');
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(0);
});

test('modal de movimentação permanece utilizável em tela estreita', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000102');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.locator('[data-management-action="transfer"]').click();
  await expect(page.locator('[data-management-transfer-mode]')).toHaveCount(3);
  await page.locator('[data-management-transfer-mode="replace-other"]').click();
  await expect(page.locator('[data-management-transfer-query]')).toBeVisible();
  await expect(page.locator('[data-management-action="confirm-transfer-destination"]')).toBeVisible();
  const bounds = await page.locator('.management-transfer-dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
});

test('transferência direta para PDV vazio não inventa computador retirado', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000102');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.locator('[data-management-action="transfer"]').click();
  await page.locator('[data-management-transfer-mode="direct"]').click();
  await page.locator('[data-management-destination-id="00000000-0000-4000-8000-000000000103"]').click();
  await page.locator('[data-management-action="confirm-transfer-destination"]').click();
  await expect(page.locator('[name="outgoingStatus"]')).toHaveCount(0);
  await page.locator('[name="incomingStatus"]').selectOption('Ativo');
  await page.locator('[name="reason"]').fill('Instalação fictícia em posição vazia');
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('[name="confirmedLocations"]').check();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(1);
  const [{ plan }] = await page.evaluate(() => window.__testTransfers);
  expect(plan).toMatchObject({
    mode: 'direct', targetId: '00000000-0000-4000-8000-000000000103',
    outgoingComputerId: null, outgoingDestinationId: null,
    incomingStatus: 'Ativo', incomingLocation: 'PDV 02'
  });
});

test('transferência sem terminal exige local escolhido e justificativa não vazia', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000102');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.locator('[data-management-action="transfer"]').click();
  await page.locator('[data-management-transfer-mode="direct"]').click();
  await page.locator('[data-management-destination-id="__unassigned__"]').click();
  await page.locator('[data-management-action="confirm-transfer-destination"]').click();
  await page.locator('[name="incomingPhysicalLocation"]').selectOption('Matriz');
  await page.locator('[name="incomingStatus"]').selectOption('Manutenção');
  await page.locator('[name="reason"]').fill('   ');
  await page.locator('.management-transfer-form [type="submit"]').click();
  await expect(page.locator('.management-transfer-step-3')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__testTransfers.length)).toBe(0);
  await page.locator('[name="reason"]').fill('Encaminhado para análise técnica');
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('.management-transfer-form [type="submit"]').click();
  await page.locator('[name="confirmedLocations"]').check();
  await page.locator('[data-management-final-confirm]').click();
  const [{ plan }] = await page.evaluate(() => window.__testTransfers);
  expect(plan).toMatchObject({
    mode: 'direct', targetUnassigned: true, incomingLocation: 'Matriz',
    incomingStatus: 'Manutenção', reason: 'Encaminhado para análise técnica'
  });
});

test('somente a moldura da TAG segue a cor da situação', async ({ page }) => {
  await page.goto('/management.html');
  const colors = await page.evaluate(() => {
    const active = document.querySelector('[data-management-open="00000000-0000-4000-8000-000000000101"]');
    const reserve = document.querySelector('[data-management-open="00000000-0000-4000-8000-000000000102"]');
    const style = (element, selector) => getComputedStyle(element.querySelector(selector)).borderTopColor;
    return {
      activeTag: style(active, '.mini-chassis'), reserveTag: style(reserve, '.mini-chassis'),
      activeScreen: style(active, '.mini-screen'), reserveScreen: style(reserve, '.mini-screen'),
      situation: active.style.getPropertyValue('--situation-color')
    };
  });
  expect(colors.situation).toBe('#36c8f4');
  expect(colors.activeTag).toBe(colors.reserveTag);
  expect(colors.activeScreen).not.toBe(colors.reserveScreen);
});

test('históricos do PC e do PDV são separados e evento automático não é editável', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000101');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(page.locator('.management-movement-history-group')).toHaveCount(1);
  await expect(page.locator('.management-movement-history-group').first()).toContainText('Sala CPD → PDV 01');
  await expect(page.locator('.management-movement-history-group')).not.toContainText('Saída de Caixa 15');
  await expect(page.locator('.management-movement-history-group')).not.toContainText('Impressora MPR2');
  await page.getByRole('button', { name: 'Movimentação', exact: true }).click();
  await expect(page.locator('.management-movement-history-group')).toHaveCount(1);
  await expect(page.locator('.management-movement-history-group')).toContainText('Entrada de Caixa 01');
  await expect(page.locator('.management-movement-history-group')).toContainText('Saída de Caixa 15');
  await expect(page.locator('.management-movement-history-group')).toContainText('Entrada de Impressora MPR2 · TAG IMPR002');
  expect(await page.evaluate(() => window.__historyQueries)).toEqual([
    { computerId: '00000000-0000-4000-8000-000000000201' },
    { positionId: '00000000-0000-4000-8000-000000000101' }
  ]);
  await expect(page.locator('[data-management-log-id="automatic"]')).toHaveCount(0);
  await expect(page.locator('[data-management-log-id="manual"]')).toHaveCount(2);
});

test('histórico legado permanece visível antes da ativação da nova consulta', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000101');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.evaluate(() => {
    window.AldeckotSupabase.management.movementHistory = async () => {
      throw new Error('PGRST202: management_movement_history not found');
    };
  });
  await page.getByRole('button', { name: 'Movimentação', exact: true }).click();
  await expect(page.locator('.management-movement-history [role="status"]')).toContainText('Histórico de movimentações ainda não ativado no banco.');
  await expect(page.locator('.management-history')).toContainText('Conferência manual.');
  await expect(page.locator('.management-history')).toContainText('Movimentação confirmada.');
});

test('PDV vazio mantém acesso à movimentação da posição', async ({ page }) => {
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000103');
  await page.addStyleTag({ content: '#aldeckot-resource-notice { display: none !important; }' });
  await page.getByRole('button', { name: 'Movimentação', exact: true }).click();
  await expect(page.locator('.management-movement-history-group')).toContainText('Nenhuma movimentação registrada para esta posição.');
  expect(await page.evaluate(() => window.__historyQueries)).toEqual([
    { positionId: '00000000-0000-4000-8000-000000000103' }
  ]);
});

test('foto do PC cabe inteira em um quadro compacto sem empurrar os dados', async ({ page }) => {
  const portrait = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="white"/></svg>').toString('base64');
  await page.route('**/equipment-images.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.AldeckotEquipmentImages={urlForPath:async()=>"data:image/svg+xml;base64,${portrait}"};`
  }));
  await page.goto('/management.html?item=00000000-0000-4000-8000-000000000101&photo-test=1');
  const image = page.locator('.management-asset-overview .management-computer-photo-frame img');
  await expect(image).toBeVisible();
  const frame = await page.locator('.management-asset-overview .management-computer-photo-frame').boundingBox();
  const facts = await page.locator('.management-asset-overview .management-asset-facts').boundingBox();
  expect(frame.width).toBeLessThanOrEqual(161);
  expect(frame.height).toBeLessThanOrEqual(121);
  expect(facts.x).toBeGreaterThan(frame.x + frame.width);
  expect(await image.evaluate(element => getComputedStyle(element).objectFit)).toBe('contain');
});
