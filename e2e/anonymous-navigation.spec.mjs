import { expect, test } from '@playwright/test';

// These tests deliberately avoid Supabase and every live API endpoint.
const sdk = `window.supabase = {
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: null }) }
  })
};`;

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

test('a entrada permite alternar entre login e cadastro', async ({ page }) => {
  await page.goto('/login.html');
  await expect(page.locator('#signInForm')).toBeVisible();
  await expect(page.locator('#signInForm input[name="password"]')).toHaveAttribute('type', 'password');
  await page.locator('#openSignUp').click();
  await expect(page.locator('#signUpForm')).toBeVisible();
  await page.locator('#openSignIn').click();
  await expect(page.locator('#signInForm')).toBeVisible();
});

test('uma falha pontual de estilo recupera o CSS sem perder a entrada', async ({ page }) => {
  await page.goto('/login.html');
  const stylesheet = page.locator('link[rel="stylesheet"][href*="login.css"]').first();
  await expect(stylesheet).toHaveCount(1);
  await stylesheet.evaluate(link => link.dispatchEvent(new Event('error')));
  await expect(stylesheet).toHaveAttribute('href', /uiRetry=/);
  await expect(page.locator('#signInForm')).toBeVisible();
  await expect(page).toHaveURL(/\/login\.html$/);
});

for (const module of ['index', 'inventory', 'management', 'control', 'flux', 'nfe', 'supplies', 'settings']) {
  test(`${module} protege a página sem sessão`, async ({ page }) => {
    await page.goto(`/${module}.html`);
    await expect(page).toHaveURL(/\/login\.html(?:\?.*)?$/);
    await expect(page.locator('#signInForm')).toBeVisible();
  });
}
