import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Use .e2e.ts (not .spec.ts) so `bun test` doesn't try to load these —
  // bun's runner auto-discovers **/*.{test,spec}.ts and would fail to
  // import @playwright/test (a separate dep/runner).
  testMatch: /.*\.e2e\.ts$/,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:47778',
  },
  webServer: {
    command: 'bun run src/server.ts',
    url: 'http://127.0.0.1:47778/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
