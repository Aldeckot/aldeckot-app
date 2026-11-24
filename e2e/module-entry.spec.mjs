import { expect, test } from '@playwright/test';

const sdk = `(() => {
  const user = { id: '00000000-0000-4000-8000-000000000001' };
  const profile = { id: user.id, full_name: 'Usuário de Teste', role: 'admin', status: 'active', module_permissions: {} };
  const fluxMonths = [
    { id: 'flux-sep', name: 'SETEMBRO 2026', flux_items: [
      { id: 'envio-set', equipment: 'Monitor', tag: 'MON-01', movement: 'Envio', status: 'Pendente', reason: 'Transferência', send_date: '2026-09-14' }
    ] },
    { id: 'flux-oct', name: 'OUTUBRO 2026', flux_items: [
      { id: 'envio-out', equipment: 'Impressora', tag: 'IMP-02', movement: 'Envio', status: 'Pendente', reason: 'Manutenção', send_date: '2026-10-14' }
    ] }
  ];
  const query = table => {
    const backupFailure = window.__moduleBackupFailure && /^(inventory|control|flux)_backups?$|^(inventory|control|flux)_backup_settings$/.test(table);
    const envelope = data => ({ data: backupFailure ? null : data,
      error: backupFailure ? { code: '503', message: 'Backup indisponível no ensaio' } : null, count: 0 });
    let chain;
    chain = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') return (resolve, reject) => Promise.resolve(envelope(
          table === 'profiles' ? profile : table === 'module_tables' && window.__testFluxMonths ? fluxMonths : []
        )).then(resolve, reject);
        if (property === 'single' || property === 'maybeSingle') return () => Promise.resolve(envelope(table === 'profiles' ? profile : null));
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
    await expect(page.locator('.module-home-navigation')).toBeVisible();
  });

  test(`${module} mantém a tela disponível quando o serviço de backup falha`, async ({ page }) => {
    await page.addInitScript(() => { window.__moduleBackupFailure = true; });
    await page.goto(`/${module}.html`);
    await expect(page.locator('.inventory-global-workspace')).toBeVisible({ timeout: 3500 });
    await page.getByRole('button', { name: 'Backup', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Backup em rede indisponível' })).toBeVisible();
    await expect(page.getByRole('switch').first()).toBeDisabled();
  });
}

test('Flux troca de mês com os filtros ativos e a casa retorna à Home', async ({ page }) => {
  await page.addInitScript(() => { window.__testFluxMonths = true; });
  await page.goto('/flux.html?table=flux-oct');
  const months = page.getByRole('combobox', { name: 'Mês e ano' });
  await expect(months).toHaveValue('flux-oct');
  await expect(page.getByRole('button', { name: 'Abrir histórico de Impressora' })).toBeVisible();
  const reason = page.getByRole('combobox', { name: 'Filtrar por motivo' });
  await reason.selectOption('Transferência');
  await page.getByRole('button', { name: 'Mês anterior disponível' }).click();
  await expect(months).toHaveValue('flux-sep');
  await expect(reason).toHaveValue('Transferência');
  await expect(page.getByRole('button', { name: 'Abrir histórico de Monitor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir histórico de Impressora' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Início do Flux' }).click();
  await expect(page.locator('.module-home-navigation')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Abrir mês' })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Abrir mês' }).selectOption('flux-oct');
  await expect(months).toHaveValue('flux-oct');
});

test('Home do Flux mostra cartões recentes e abre o mês selecionado', async ({ page }) => {
  await page.addInitScript(() => { window.__testFluxMonths = true; });
  await page.goto('/flux.html');
  await expect(page.locator('.module-home-navigation')).toBeVisible();
  await expect(page.locator('.flux-home-list .flux-card')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Abrir mês' })).toHaveValue('');
  await page.getByRole('combobox', { name: 'Abrir mês' }).selectOption('flux-oct');
  await expect(page.getByRole('combobox', { name: 'Mês e ano' })).toHaveValue('flux-oct');
});

test('Flux abre a ficha unificada e navega pelo histórico sem perder o equipamento', async ({ page }) => {
  await page.addInitScript(() => { window.__testFluxMonths = true; });
  await page.goto('/flux.html?table=flux-oct');
  await page.getByRole('button', { name: 'Abrir histórico de Impressora' }).click();
  const modal = page.locator('.eqd-modal');
  await expect(modal.getByText('Detalhes do Equipamento')).toBeVisible();
  await expect(modal.locator('.eqd-hero-copy h2')).toHaveText('Impressora');
  await modal.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(modal.getByRole('heading', { name: 'Histórico do equipamento' })).toBeVisible();
  await modal.getByRole('button', { name: 'Voltar aos detalhes' }).click();
  await expect(modal.locator('.eqd-hero-copy h2')).toHaveText('Impressora');
});
