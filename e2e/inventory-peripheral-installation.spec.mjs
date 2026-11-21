import { expect, test } from '@playwright/test';

// Todas as consultas do teste são fictícias; nenhuma requisição externa é permitida.
const fakeClient = `(() => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const tableId = '00000000-0000-4000-8000-000000000010';
  const itemId = '00000000-0000-4000-8000-000000000020';
  const table = { id: tableId, name: 'IMPRESSORAS', icon: 'printer', position: 1 };
  const monitorTable = { id: 'monitores', name: 'MONITORES', position: 2 };
  const item = {
    id: itemId, tableId, equipment: 'Impressora MPR2', tag: 'IMPR002',
    model: '', brand: '', serial: '', sector: 'Frente de Loja',
    location: 'PDV 04', status: 'Ativo', situation: 'Normal',
    cleaning: 'Não realizada', priority: 'Estável', notes: '', logs: [],
    updatedAt: '2026-10-24T10:00:00Z'
  };
  window.__installedPc = { tag: 'AJPCCX04', name: 'Caixa 04' };
  window.__verificationCalls = [];
  window.__categoryCalls = [];
  const query = () => {
    let chain;
    chain = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return (resolve, reject) =>
          Promise.resolve({ data: [], error: null }).then(resolve, reject);
        return () => chain;
      }
    });
    return chain;
  };
  window.AldeckotSupabase = {
    init: async () => ({ client: { from: query, storage: {
      from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) })
    } } }),
    auth: { state: async () => ({ session: { user }, user,
      profile: { id: user.id, full_name: 'Teste Local', role: 'admin',
        status: 'active', module_permissions: {} }, isAdmin: true }) },
    inventory: {
      globalCategories: async () => window.__inventoryCategoryNavigation ? [table, monitorTable] : [table],
      globalOverview: async () => ({ recent: [], total: 1, statuses: [], situations: [] }),
      categoryBranches: async category => window.__inventoryCategoryNavigation && category === tableId
        ? [{ id: 'caixas', name: 'Caixas', tableId }] : [],
      categoryPage: async filters => {
        window.__categoryCalls.push(filters);
        return { items: filters.category === tableId ? [item] : [], total: filters.category === tableId ? 1 : 0, page: 1 };
      },
      startVerification: async (id, reason, updatedAt, requestId) => {
        window.__verificationCalls.push({ id, reason, updatedAt, requestId });
        item.situation = 'Verificando';
        return item;
      },
      peripheralInstallation: async id => id === itemId
        ? { terminal: 'PDV 04', computer: window.__installedPc.name,
          computerTag: window.__installedPc.tag } : null
    },
    backups: {
      settings: async () => ({ automatic: false, frequency_days: 7 }),
      list: async () => []
    }
  };
})();`;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-client.js')
      return route.fulfill({ contentType: 'application/javascript', body: fakeClient });
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-config.js')
      return route.fulfill({ contentType: 'application/javascript',
        body: 'window.ALDECKOT_SUPABASE_CONFIG = {};' });
    if (url.hostname === 'cdn.jsdelivr.net')
      return route.fulfill({ contentType: 'application/javascript', body: 'window.supabase = {};' });
    if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/api/'))
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    if (url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
});

test('Inventário muda de categoria na barra de filtros sem levar a ramificação anterior', async ({ page }) => {
  await page.addInitScript(() => { window.__inventoryCategoryNavigation = true; });
  await page.goto('/inventory.html');
  await expect(page.locator('.module-home-navigation')).toBeVisible();
  await page.getByRole('combobox', { name: 'Abrir categoria' }).selectOption('00000000-0000-4000-8000-000000000010');
  await expect(page.getByRole('combobox', { name: 'Categoria' })).toHaveValue('00000000-0000-4000-8000-000000000010');
  await page.getByRole('button', { name: 'Caixas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Caixas', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('searchbox', { name: 'Buscar equipamento' }).fill('Impressora');
  await page.getByRole('combobox', { name: 'Filtrar por status' }).selectOption('Ativo');
  await page.getByRole('button', { name: 'Próxima categoria' }).click();
  await expect(page.getByRole('combobox', { name: 'Categoria' })).toHaveValue('monitores');
  await expect(page.getByRole('searchbox', { name: 'Buscar equipamento' })).toHaveValue('Impressora');
  await expect(page.getByRole('button', { name: 'Caixas', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__categoryCalls.at(-1))).toMatchObject({
    category: 'monitores', branchId: null, page: 1, query: 'Impressora', status: 'Ativo'
  });
  await page.getByRole('button', { name: 'Início do Inventário' }).click();
  await expect(page.locator('.module-home-navigation')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Abrir categoria' })).toHaveValue('');
});

test('Inventário exige motivo e usa a abertura auditada ao marcar Verificando', async ({ page }) => {
  await page.goto('/inventory.html');
  await expect(page.locator('html')).toHaveClass(/auth-ready/);
  await page.evaluate(() => window.AldeckotInventoryOpenDetails({
    id: '00000000-0000-4000-8000-000000000020',
    tableId: '00000000-0000-4000-8000-000000000010'
  }));
  await page.locator('[data-inv-action="toggle-item-actions"]').click();
  await page.locator('[data-inv-edit-item]').click();
  const form = page.locator('[data-inv-item-form]');
  const reason = form.locator('[name="verificationReason"]');
  await expect(reason).toBeHidden();
  await form.locator('[name="situation"]').selectOption('Verificando');
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute('required', '');
  await reason.fill('Imagem falhando intermitentemente');
  await form.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(() => page.evaluate(() => window.__verificationCalls.length)).toBe(1);
  expect(await page.evaluate(() => window.__verificationCalls[0])).toMatchObject({
    id: '00000000-0000-4000-8000-000000000020',
    reason: 'Imagem falhando intermitentemente',
    updatedAt: '2026-10-24T10:00:00Z'
  });
});

test('Inventário mostra o PC atual sem mover o local físico do periférico', async ({ page }) => {
  await page.goto('/inventory.html');
  await expect(page.locator('html')).toHaveClass(/auth-ready/);
  const labelRadii = await page.evaluate(() => {
    const labels = ['inventory-status ativo', 'inventory-situation normal'].map(className => {
      const span = document.createElement('span');
      span.className = className; span.textContent = 'Estado'; document.body.append(span);
      const radius = getComputedStyle(span).borderRadius; span.remove(); return radius;
    });
    return labels;
  });
  expect(labelRadii).toEqual(['5px', '5px']);
  const chartTone = await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.className = 'inventory-chart-bar'; bar.style.setProperty('--chart-color', '#ff6874');
    document.body.append(bar); const tone = getComputedStyle(bar).filter; bar.remove(); return tone;
  });
  expect(chartTone).toBe('saturate(1.18)');
  await page.evaluate(() => window.AldeckotInventoryOpenDetails({
    id: '00000000-0000-4000-8000-000000000020',
    tableId: '00000000-0000-4000-8000-000000000010'
  }));
  const location = page.locator('.inv-equipment-detail-dialog .inv-detail')
    .filter({ has: page.getByText('Local de instalação', { exact: true }) }).locator('b');
  await expect(location).toHaveText('PDV 04 — PC AJPCCX04 (Caixa 04)');
  await page.evaluate(() => {
    window.__installedPc = { tag: 'AJPCCX17', name: 'Caixa 17' };
    window.dispatchEvent(new CustomEvent('aldeckot:realtime-change',
      { detail: { table: 'module_records' } }));
  });
  await expect(location).toHaveText('PDV 04 — PC AJPCCX17 (Caixa 17)');
  await expect(page.locator('.inv-modal').filter({ has: page.locator('.inv-equipment-detail-dialog') })).toHaveAttribute(
    'data-inventory-location', 'PDV 04');
});
