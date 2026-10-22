import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4174';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: process.env.CI ? 1 : undefined,
  use: { baseURL, browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/local-preview-server.mjs',
    url: `${baseURL}/login.html`,
    env: {
      ALDECKOT_LOCAL_PORT: '4174',
      ALDECKOT_PREVIEW_API_ORIGIN: 'http://127.0.0.1:9'
    },
    reuseExistingServer: false,
    timeout: 30_000
  }
});
