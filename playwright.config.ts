import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:47778',
  },
  webServer: {
    command: 'bun run src/server.ts',
    url: 'http://localhost:47778/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
