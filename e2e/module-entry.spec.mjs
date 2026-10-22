import { expect, test } from '@playwright/test';

const sdk = `(() => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const profile = { id: user.id, full_name: 'Usuário de Teste', role: 'admin', status: 'active', module_permissions: {} };
  const query = table => {
    let chain;
    chain = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return (resolve, reject) => Promise.resolve({ data: table === 'profiles' ? profile : [], error: null, count: 0 }).then(resolve, reject);
        if (property === 'single' || property === 'maybeSingle') return () => Promise.resolve({ data: table === 'profiles' ? profile : null, error: null });
        return () => chain;
      }
    });
    return chain;
  };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user, access_token: 'test-only' } }, error: null }),
      getUser: async () => ({ data: { user }, error: null })
    },
    from: query,
    rpc: async name => ({
      data: name === 'inventory_global_overview'
        ? { recent: [], total: 0, statuses: [], situations: [] }
        : { items: [], total: 0 },
      error: null
    }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => {},
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) }
  }) };
})();`;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.pathname === '/supabase-config.js') {
      return route.fulfill({
        contentType: 'application/javascript',
        body: "window.ALDECKOT_SUPABASE_CONFIG = { url: 'https://example.supabase.co', publishableKey: 'test-public-key' };"
      });
    }
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/supabase-js@2')) {
      return route.fulfill({ contentType: 'application/javascript', body: sdk });
    }
    if (url.hostname === '127.0.0.1' && url.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    if (url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
});

for (const module of ['inventory', 'control', 'flux']) {
  test(`${module} deixa o estado inicial de conexão`, async ({ page }) => {
    await page.goto(`/${module}.html`);
    await expect(page.locator('html')).toHaveClass(/auth-ready/);
    await expect(page.locator('#app.inventory-shell')).toBeVisible();
    await expect(page.locator('.inventory-empty-state')).toHaveCount(0);
    await expect(page.locator('.inventory-global-workspace')).toBeVisible();
  });
}
