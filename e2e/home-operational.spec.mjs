import { expect, test } from '@playwright/test';

function fakeHomeClient() {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  window.AldeckotSupabase = {
    init: async () => ({ client: {} }),
    auth: { state: async () => ({ session: { user }, user, profile: {
      id: user.id, full_name: 'Teste Local', role: 'admin', status: 'active', module_permissions: {}
    }, isAdmin: true }) },
    realtime: { subscribe: async () => () => {} },
    agenda: { load: async () => [
      { id: 'agenda-1', title: 'Conferência programada', kind: 'event', date: '2026-10-23', time: '14:00', completed: false },
      { id: 'agenda-2', title: 'Inspeção do setor', kind: 'task', date: '2026-10-22', time: '09:00', completed: false },
      { id: 'agenda-3', title: 'Agendamento concluído', kind: 'event', date: '2026-10-25', time: '10:00', completed: true }
    ] },
    central: {
      search: async term => [
        { id: 'inv-1', module: 'inventory', table_id: 'inv-table', equipment: 'Monitor Dell', tag: 'REUSED', serial: 'SER-A' },
        { id: 'inv-2', module: 'inventory', table_id: 'inv-table', equipment: 'Monitor LG', tag: 'REUSED', serial: 'SER-B' }
      ].filter(row => term === 'REUSED' || row.serial === term)
    },
    notificationAcknowledgements: { list: async () => [] }
  };
}
function fakeHomeData() {
  const stamp = '2026-10-22T10:00:00-03:00';
  window.__homeReads = 0;
  window.__homeSource = {
    inventory: [
      { id: 'inv-1', tableId: 'inv-table', module: 'inventory', equipment: 'Monitor Dell', model: 'P2422', brand: 'Dell', tag: 'AJMON001', status: 'Ativo', createdAt: '2026-10-01', updatedAt: stamp },
      { id: 'inv-2', tableId: 'inv-table', module: 'inventory', equipment: 'Impressora térmica', tag: 'IMPR002', status: 'Manutenção', createdAt: '2026-09-01', updatedAt: stamp }
    ],
    management: [
      { id: 'position-1', computerId: 'pc-1', tableId: 'management-table', module: 'management', equipment: 'Caixa 01', terminal: 'PDV 01', tag: 'AJPCCX01', status: 'Ativo', createdAt: '2026-10-01', updatedAt: stamp },
      { id: 'position-2', computerId: 'pc-2', tableId: 'management-table', module: 'management', equipment: 'Caixa 15', terminal: 'RES 01', tag: 'AJPCCX15', status: 'Reserva', createdAt: '2026-09-01', updatedAt: stamp },
      { id: 'position-empty', module: 'management', equipment: '', terminal: 'PDV 02', status: 'Inativo' }
    ],
    control: [
      { id: 'ticket-1', module: 'control', tableId: 'control-table', inventoryItemId: 'inv-2', equipment: 'Impressora térmica', tag: 'IMPR002', status: 'Em manutenção', entryDate: '2026-10-01', updatedAt: stamp },
      { id: 'ticket-2', module: 'control', tableId: 'control-table', equipment: 'Scanner', followUpKind: 'verification', status: 'Aguardando avaliação', entryDate: '2026-10-21', updatedAt: stamp },
      { id: 'ticket-3', module: 'control', tableId: 'control-table', equipment: 'Monitor', status: 'Manutenção concluída', exitDate: '2026-10-15', updatedAt: stamp }
    ],
    flux: [{ id: 'flux-1', tableId: 'flux-table', module: 'flux', equipment: 'Switch de rede', tag: 'SW001', status: 'Em Trânsito', updatedAt: stamp },
      { id: 'flux-2', tableId: 'flux-table', module: 'flux', equipment: 'Leitor', status: 'Entregue', receivedDate: '2026-10-10', updatedAt: stamp }],
    nfe: [{ id: 'nfe-1', module: 'nfe', nfeNumber: '123', pdv: '01', reason: 'Erro no Pin Pad', occurredAt: stamp, updatedAt: stamp }],
    events: [],
    stock: [{ itemId: 'toner', variantId: 'v1', itemName: 'Toner', name: 'HP', stock: 0, minimum: 3 }],
    effects: [{ id: 'effect-1', eventId: 'event-1', module: 'management', status: 'applied', processedAt: stamp }],
    backups: [{ id: 'backup-1', module: 'inventory', source: 'automatic', label: 'Backup confirmado', createdAt: stamp }],
    health: {}, loadedAt: stamp
  };
  window.__calendarMonths = [];
  window.AldeckotHomeQueries = { calendarMonth: async month => {
    window.__calendarMonths.push(month);
    const s=window.__homeSource, inMonth=(rows,field)=>rows.filter(row=>(row[field]||'').slice(0,7)===month);
    return {
      maintenance:inMonth(s.control,'entryDate').filter(row=>row.followUpKind!=='verification'),
      technical:inMonth(s.control,'entryDate').filter(row=>row.followUpKind==='verification'),
      transfers:inMonth(s.flux,'receivedDate'),
      fiscal:month==='2026-07' ? [{id:'nfe-historic',module:'nfe',nfeNumber:'999',equipment:'NF-e 999',occurredAt:'2026-07-15T12:00:00-03:00'}] : inMonth(s.nfe,'occurredAt')
    };
  }, load: async () => {
    window.__homeReads++;
    return JSON.parse(JSON.stringify(window.__homeSource));
  } };
}
test('calendário carrega registros de meses anteriores ao período dos indicadores',async ({page})=>{
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  for(let i=0;i<3;i++) await page.getByRole('button',{name:'Mês anterior',exact:true}).click();
  await page.getByRole('button',{name:/^2026-07-15/}).click();
  await expect(page.getByRole('dialog', { name: 'Criar agendamento' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver registros do dia' }).click();
  const fiscal=page.locator('[data-home-calendar-kind="fiscal"]');
  await expect(fiscal.locator('small')).toHaveText('1 registro(s)');
  await fiscal.click();
  await expect(page.getByRole('dialog')).toContainText('999');
  expect(await page.evaluate(()=>window.__calendarMonths)).toContain('2026-07');
});

test.use({ timezoneId: 'America/Sao_Paulo' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const OriginalDate = Date;
    const fixed = OriginalDate.parse('2026-10-22T15:00:00Z');
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [fixed])); }
      static now() { return fixed; }
    };
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-client.js')
      return route.fulfill({ contentType: 'application/javascript', body: '(' + fakeHomeClient.toString() + ')();' });
    if (url.hostname === '127.0.0.1' && url.pathname === '/home-data.js')
      return route.fulfill({ contentType: 'application/javascript', body: '(' + fakeHomeData.toString() + ')();' });
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-config.js')
      return route.fulfill({ contentType: 'application/javascript', body: 'window.ALDECKOT_SUPABASE_CONFIG={};' });
    if (url.hostname === 'cdn.jsdelivr.net')
      return route.fulfill({ contentType: 'application/javascript', body: '' });
    if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/api/'))
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    if (url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
});
test('notificações ficam inteiras fora da rolagem do menu e painéis preservam leitura', async ({ page }) => {
  await page.setViewportSize({ width: 1556, height: 887 });
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('aldeckot:operational-alerts', { detail: {
    alerts: [{ id: 'layout-test', title: 'Alerta de teste', description: 'Confira o equipamento.', urgent: true }]
  } })));
  await page.locator('[data-home-notification-toggle]').click();
  const panel = page.locator('#homeNotificationsPanel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Alerta de teste');
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#homeNotificationsPanel');
    const rect = panel.getBoundingClientRect();
    const aside = document.querySelector('.side');
    return { parent: panel.parentElement.tagName, x: rect.x, right: rect.right, width: rect.width,
      asideRight: aside.getBoundingClientRect().right, sideBorder: getComputedStyle(aside).borderRightWidth,
      alertScrollbar: getComputedStyle(document.querySelector('.home-alert-panel')).scrollbarWidth,
      monthlyRemoved: document.querySelector('.home-monthly') === null,
      donutAnimation: getComputedStyle(document.querySelector('.home-donut'), '::after').animationName,
      reverseAnimation: getComputedStyle(document.querySelector('.home-donut'), '::before').animationName,
      operationsClockwise: getComputedStyle(document.querySelector('.home-operations-donut'), '::before').animationName,
      operationsCounterclockwise: getComputedStyle(document.querySelector('.home-operations-donut'), '::after').animationName };
  });
  expect(layout.parent).toBe('BODY');
  expect(layout.width).toBeGreaterThan(300);
  expect(layout.x).toBeGreaterThanOrEqual(layout.asideRight - 1);
  expect(layout.right).toBeLessThanOrEqual(1556);
  expect(layout.sideBorder).toBe('0px');
  expect(layout.alertScrollbar).toBe('none');
  expect(layout.monthlyRemoved).toBe(true);
  expect(layout.donutAnimation).toBe('home-ring-clockwise');
  expect(layout.reverseAnimation).toBe('home-ring-counterclockwise');
  expect(layout.operationsClockwise).toBe('home-ring-clockwise');
  expect(layout.operationsCounterclockwise).toBe('home-ring-counterclockwise');
  await page.screenshot({ path: 'test-results/home-notification-open.png', animations: 'disabled' });
  await page.locator('#homeNotificationsPanel header').click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-home-notification-toggle]').click();
  await expect(panel).toBeVisible();
  const mobile = await panel.boundingBox();
  expect(mobile.x).toBeGreaterThanOrEqual(0);
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
});

test('valores e listagens têm a mesma origem e computadores vazios não entram no Resumo Global', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  await expect(page.locator('.home-operations-donut strong')).toHaveText('3');
  await expect(page.locator('[data-home-set="operation:maintenanceOpen"] b')).toHaveText('1');
  await expect(page.locator('[data-home-set="operation:verificationOpen"] b')).toHaveText('1');
  await page.locator('.home-summary-legend [data-home-set="status:Ativo"]').click();
  const dialog = page.getByRole('dialog', { name: 'Equipamentos · Ativo' });
  await expect(dialog.locator('.home-data-row')).toHaveCount(2);
  await expect(dialog).toContainText('AJPCCX01');
  await dialog.locator('[data-home-filter]').fill('AJMON001');
  await expect(dialog.locator('.home-data-row')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('calendário seleciona data e abre os registros do dia sem quadro lateral', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.home-calendar .is-selected')).toHaveAttribute('data-date', '2026-10-22');
  await page.locator('.home-calendar [data-date="2026-10-23"]').click();
  await expect(page.locator('.home-calendar .is-selected')).toHaveAttribute('data-date', '2026-10-23');
  await expect(page.locator('.home-calendar-events')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Criar agendamento' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver registros do dia' }).click();
  await expect(page.locator('[data-home-calendar-kind="appointments"] small')).toHaveText('1 registro(s)');
  await page.getByRole('button', { name: 'Fechar' }).click();
  await page.locator('[data-agenda-today]').click();
  await expect(page.locator('.home-calendar .is-selected')).toHaveAttribute('data-date', '2026-10-22');
  await page.locator('[data-agenda-all]').click();
  await expect(page.getByRole('dialog', { name: 'Agenda completa' })).toContainText('Conferência programada');
});
test('busca preserva ambiguidades de TAG e abre registro único por série com identificador persistente', async ({ page }) => {
  await page.goto('/index.html');
  await page.keyboard.press('Control+k');
  const input = page.locator('[data-central-search-input]');
  await expect(input).toBeFocused();
  await input.fill('REUSED');
  await expect(page.locator('[data-central-result]')).toHaveCount(2);
  await expect(page.locator('[data-central-search-results]')).toContainText('SER-A');
  await expect(page.locator('[data-central-search-results]')).toContainText('SER-B');
  await input.fill('SER-B');
  await expect(page.locator('[data-central-result]')).toHaveCount(1);
  await page.evaluate(() => { window.__homeRoute = ''; window.AldeckotRoute.navigate = url => { window.__homeRoute = url; }; });
  await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__homeRoute)).toContain('item=inv-2');
});
test('atualizar reconsulta dados, preserva wallpaper e falha parcial não exibe zero inventado', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  await page.evaluate(() => {
    window.__hero = document.querySelector('.home-hero');
    window.__homeSource.health.control = { unavailable: true, error: 'Falha controlada' };
    delete window.__homeSource.control;
  });
  await page.locator('[data-home-refresh]').click();
  await expect(page.locator('.home-operation-note').first()).toContainText('Cobertura parcial');
  expect(await page.evaluate(() => window.__hero === document.querySelector('.home-hero'))).toBe(true);
  expect(await page.evaluate(() => window.__homeReads)).toBe(2);
  await expect(page.locator('[data-home-recent-list]')).toContainText('Consulta incompleta');
});
test('prévias exibem até três registros e pendências de fonte aparecem em Alertas críticos', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(() => {
    window.__homeSource.inventory.push({ id: 'quality-a', module: 'inventory', equipment: 'Monitor A', tag: 'TAG-DUP', status: 'Ativo', createdAt: '2026-10-01', updatedAt: '2026-10-22T11:00:00-03:00' });
    window.__homeSource.inventory.push({ id: 'quality-b', module: 'inventory', equipment: 'Monitor B', tag: 'TAG-DUP', status: 'Ativo', createdAt: '2026-10-01', updatedAt: '2026-10-22T11:01:00-03:00' });
    for (let i = 2; i <= 5; i++) window.__homeSource.effects.push({ id: 'effect-' + i, eventId: 'event-' + i, module: 'inventory', status: 'applied', processedAt: '2026-10-22T10:0' + i + ':00-03:00' });
  });
  await page.locator('[data-home-refresh]').click();
  await expect(page.locator('[data-home-recent-list] .home-data-row')).toHaveCount(3);
  await expect(page.locator('.home-activities')).toHaveCount(0);
  await expect(page.locator('.home-recent-panel .home-small-button')).toHaveCount(0);
  await expect(page.locator('.home-monthly .home-small-button')).toHaveCount(0);
  await expect(page.locator('[data-home-alerts] .home-data-row')).toHaveCount(3);
  await expect(page.locator('.home-quality-note')).toHaveCount(0);
  await page.locator('.home-alert-panel [data-home-set="alerts"]').click();
  await expect(page.getByRole('dialog', { name: 'Alertas críticos' })).toContainText('TAG em identidades distintas');
});

test('quadros centrais ocupam o lugar das atividades sem descartar os dados', async ({ page }) => {
  await page.setViewportSize({ width: 1556, height: 887 });
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  await expect(page.locator('.home-activities')).toHaveCount(0);
  const activityTitles = await page.evaluate(() => window.AldeckotHomeDashboard.model.sets.activities.map(row => row.title));
  expect(activityTitles).toContain('Backup automático concluído');
  expect(activityTitles).toContain('Integração Gestão TI concluída');
  const layout = await page.evaluate(() => {
    const center = document.querySelector('.home-center').getBoundingClientRect();
    const summary = document.querySelector('.home-global').getBoundingClientRect();
    const operations = document.querySelector('.home-operations').getBoundingClientRect();
    return { centerBottom: center.bottom, summaryBottom: summary.bottom, operationsBottom: operations.bottom, summaryHeight: summary.height };
  });
  expect(Math.abs(layout.centerBottom - layout.summaryBottom)).toBeLessThan(2);
  expect(Math.abs(layout.centerBottom - layout.operationsBottom)).toBeLessThan(2);
  expect(layout.summaryHeight).toBeLessThanOrEqual(370);
  await expect(page.locator('.home-recent-panel .home-small-button')).toHaveCount(0);
  await expect(page.locator('.home-monthly')).toHaveCount(0);
  await page.locator('.home-operations-donut button').click();
  await expect(page.getByRole('dialog', { name: 'Central de Operações' })).toBeVisible();
});
test('Central de Operações alterna modo e combina filtros no gráfico e no modal', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.home-operations-donut strong')).toHaveText('3');
  await page.locator('[data-home-operation-filter="mode"]').selectOption('activity');
  await expect(page.locator('.home-operations-donut strong')).toHaveText('5');
  await page.locator('[data-home-operation-filter="module"]').selectOption('control');
  await expect(page.locator('.home-operations-donut strong')).toHaveText('1');
  await page.locator('[data-home-operation-filter="type"]').selectOption('maintenanceDone');
  await expect(page.locator('[data-home-set="operation:maintenanceDone"] b')).toHaveText('1');
  await page.locator('[data-home-set="operation:maintenanceDone"]').last().click();
  const dialog = page.getByRole('dialog', { name: 'Manutenções concluídas' });
  await expect(dialog.locator('.home-data-row')).toHaveCount(1);
  await expect(dialog).toContainText('Monitor');
  await page.keyboard.press('Escape');
  await page.locator('[data-home-operation-filter="period"]').selectOption('custom');
  await page.locator('[data-home-operation-filter="from"]').fill('2026-10-16');
  await page.locator('[data-home-operation-filter="to"]').fill('2026-10-22');
  await expect(page.locator('.home-operations-donut strong')).toHaveText('0');
  await page.locator('[data-home-operation-clear]').click();
  await expect(page.locator('.home-operations-donut strong')).toHaveText('3');
});

test('alerta abre as causas e o calendário oferece criação de tarefa e nota', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('[data-home-alerts] .home-data-row').first().click();
  const detail = page.getByRole('dialog');
  await expect(detail).toContainText('Motivo');
  await expect(detail).toContainText('última atualização técnica');
  await expect(detail.getByRole('button', { name: 'Abrir registro original' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.home-calendar [data-date="2026-10-26"]').click();
  const chooser = page.getByRole('dialog', { name: 'Criar agendamento' });
  await expect(chooser.getByRole('button', { name: /Nota/ })).toBeVisible();
  await chooser.getByRole('button', { name: /Tarefa/ }).click();
  await expect(page.getByRole('dialog', { name: 'Lembrete' })).toBeVisible();
  await expect(page.locator('.agenda-modal input[name="date"]')).toHaveValue('2026-10-26');
});

test('Resumo Global e Central de Operações cabem sem rolagem interna na altura da Home', async ({ page }) => {
  await page.setViewportSize({ width: 1624, height: 724 });
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  const checkLayout = async () => page.evaluate(() => {
    const measure = selector => {
      const element = document.querySelector(selector);
      return { scroll: element.scrollHeight, client: element.clientHeight, overflow: getComputedStyle(element).overflowY };
    };
    return {
      summary: measure('.home-global'),
      operations: measure('.home-operations'),
      legend: measure('.home-operations-legend'),
      clearInHeader: Boolean(document.querySelector('.home-operations .home-panel-head [data-home-operation-clear]'))
    };
  });
  for (const state of ['default', 'custom']) {
    if (state === 'custom') {
      await page.locator('[data-home-operation-filter="mode"]').selectOption('activity');
      await page.locator('[data-home-operation-filter="period"]').selectOption('custom');
    }
    const layout = await checkLayout();
    expect(layout.clearInHeader).toBe(true);
    expect(layout.summary.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.summary.client + 1);
    expect(layout.operations.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.operations.client + 1);
    expect(layout.legend.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.legend.client + 1);
    expect(layout.summary.overflow).toBe('hidden');
    expect(layout.operations.overflow).toBe('hidden');
  }
});

test('movimento reduzido desliga o passeio do wallpaper e os dois anéis dos gráficos', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/index.html');
  await expect(page.locator('.home-donut strong')).toHaveText('4');
  const animationNames = await page.evaluate(() => {
    const style = (selector, pseudo) => getComputedStyle(document.querySelector(selector), pseudo).animationName;
    return [
      style('.app', '::before'),
      style('.home-donut', '::before'), style('.home-donut', '::after'),
      style('.home-operations-donut', '::before'), style('.home-operations-donut', '::after')
    ];
  });
  expect(animationNames).toEqual(['none', 'none', 'none', 'none', 'none']);
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1600, height: 900 }, { width: 1624, height: 724 }, { width: 1366, height: 768 }, { width: 1267, height: 724 }, { width: 900, height: 900 }, { width: 390, height: 844 }]) {
  for (const theme of ['dark', 'light']) {
    test('composição ' + size.width + 'x' + size.height + ' ' + theme, async ({ page }) => {
      await page.setViewportSize(size);
      await page.addInitScript(theme => localStorage.setItem('aldeckot-theme-preference', theme), theme);
      await page.goto('/index.html');
      await expect(page.locator('.home-donut strong')).toHaveText('4');
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: innerWidth, height: document.documentElement.scrollHeight, screen: innerHeight }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.view + 1);
      if (size.width >= 1366) expect(widths.height).toBeLessThanOrEqual(widths.screen + 1);
      await expect(page.locator('[data-module-card]')).toHaveCount(6);
      await expect(page.locator('.home-calendar')).toBeVisible();
      const surfaces = await page.evaluate(() => ({
        wallpaper: getComputedStyle(document.querySelector('.app'), '::before').backgroundImage,
        wallpaperFilter: getComputedStyle(document.querySelector('.app'), '::before').filter,
        wallpaperAnimation: getComputedStyle(document.querySelector('.app'), '::before').animationName,
        calendarHeight: document.querySelector('.home-calendar').getBoundingClientRect().height,
        operationsRingBottom: document.querySelector('.home-operations-donut').getBoundingClientRect().bottom,
        heroImage: getComputedStyle(document.querySelector('.home-hero'), '::before').backgroundImage,
        heroContent: getComputedStyle(document.querySelector('.home-hero'), '::before').content,
        sidebarBlur: getComputedStyle(document.querySelector('.side')).backdropFilter,
        rightColumnBlur: getComputedStyle(document.querySelector('.home-side')).backdropFilter,
        panels: [...document.querySelectorAll('.home-panel')].map(panel => ({
          background: getComputedStyle(panel).backgroundColor,
          backgroundImage: getComputedStyle(panel).backgroundImage,
          border: getComputedStyle(panel).borderTopWidth,
          radius: getComputedStyle(panel).borderTopLeftRadius,
          blur: getComputedStyle(panel).backdropFilter
        })),
        moduleBlur: getComputedStyle(document.querySelector('.module-nav-card')).backdropFilter
      }));
      expect(surfaces.wallpaper).toContain('home-wallpaper-' + theme + '-v4.png');
      expect(surfaces.wallpaperFilter).not.toContain('blur(');
      expect(surfaces.wallpaperAnimation).toBe('home-wallpaper-tour');
      if (size.width >= 1366) {
        expect(surfaces.calendarHeight).toBeLessThanOrEqual(191);
        expect(surfaces.operationsRingBottom).toBeLessThanOrEqual(size.height + 1);
      }
      expect(surfaces.heroImage).toBe('none');
      expect(surfaces.heroContent).toBe('none');
      expect(surfaces.sidebarBlur).toBe('none');
      expect(surfaces.rightColumnBlur).toBe('none');
      expect(surfaces.panels.length).toBeGreaterThan(0);
      expect(surfaces.panels.every(panel => panel.background === 'rgba(0, 0, 0, 0)' && panel.backgroundImage.includes('radial-gradient(') && !panel.backgroundImage.includes('url(') && panel.border === '0px' && panel.radius === '12px' && panel.blur === 'none'), JSON.stringify(surfaces.panels)).toBe(true);
      expect(surfaces.moduleBlur).toBe('none');
      await page.screenshot({ path: 'test-results/home-' + size.width + '-' + theme + '.png', fullPage: true, animations: 'disabled' });
    });
  }
}
