import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [/.*\.e2e\.ts$/, /contrast\.spec\.ts$/],
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: [
    {
      command: 'bun run src/server.ts',
      url: 'http://127.0.0.1:47778/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      command: 'cd frontend && bun run dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
