import { defineConfig } from '@playwright/test';

const port = process.env.ALDECKOT_E2E_PORT || '4174';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/local-preview-server.mjs',
    url: `${baseURL}/login.html`,
    env: {
      ALDECKOT_LOCAL_PORT: port,
      ALDECKOT_PREVIEW_API_ORIGIN: 'http://127.0.0.1:9'
    },
    reuseExistingServer: false,
    timeout: 30_000
  }
});
