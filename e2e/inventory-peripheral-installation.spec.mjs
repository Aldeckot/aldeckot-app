import { expect, test } from '@playwright/test';

// Todas as consultas do teste são fictícias; nenhuma requisição externa é permitida.
const fakeClient = `(() => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const tableId = '00000000-0000-4000-8000-000000000010';
  const itemId = '00000000-0000-4000-8000-000000000020';
  const table = { id: tableId, name: 'IMPRESSORAS', icon: 'printer', position: 1 };
  const item = {
    id: itemId, tableId, equipment: 'Impressora MPR2', tag: 'IMPR002',
    model: '', brand: '', serial: '', sector: 'Frente de Loja',
    location: 'PDV 04', status: 'Ativo', situation: 'Normal',
    cleaning: 'Não realizada', priority: 'Estável', notes: '', logs: []
  };
  window.__installedPc = { tag: 'AJPCCX04', name: 'Caixa 04' };
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
      globalCategories: async () => [table],
      globalOverview: async () => ({ recent: [], total: 1, statuses: [], situations: [] }),
      categoryBranches: async () => [],
      categoryPage: async () => ({ items: [item], total: 1, page: 1 }),
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

test('Inventário mostra o PC atual sem mover o local físico do periférico', async ({ page }) => {
  await page.goto('/inventory.html');
  await expect(page.locator('html')).toHaveClass(/auth-ready/);
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
