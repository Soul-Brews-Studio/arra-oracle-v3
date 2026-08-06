import { defineConfig } from '@playwright/test';

const backendPort = process.env.PLAYWRIGHT_BACKEND_PORT ?? '47789';
const frontendPort = process.env.PLAYWRIGHT_FRONTEND_PORT ?? '3310';
const vectorPort = process.env.PLAYWRIGHT_VECTOR_PORT ?? '47790';
const backendURL = process.env.PLAYWRIGHT_BACKEND_URL ?? `http://127.0.0.1:${backendPort}`;
const frontendURL = process.env.PLAYWRIGHT_FRONTEND_URL ?? `http://127.0.0.1:${frontendPort}`;
const vectorURL = process.env.PLAYWRIGHT_VECTOR_URL ?? `http://127.0.0.1:${vectorPort}`;
const reuseExistingServer = !process.env.CI;
const e2eDataDir = '.tmp/playwright-oracle-e2e';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [/.*\.e2e\.ts$/, /contrast\.spec\.ts$/],
  timeout: 30000,
  use: {
    baseURL: frontendURL,
  },
  webServer: [
    {
      command: 'bun run tests/e2e/vector-sidecar-fixture.ts',
      url: `${vectorURL}/api/vector/health`,
      reuseExistingServer,
      timeout: 30000,
      env: {
        ...process.env,
        PLAYWRIGHT_VECTOR_PORT: vectorPort,
      },
    },
    {
      command: 'bun run src/server.ts',
      url: `${backendURL}/api/health`,
      reuseExistingServer,
      timeout: 30000,
      env: {
        ...process.env,
        ORACLE_PORT: backendPort,
        ORACLE_DATA_DIR: e2eDataDir,
        ORACLE_DB_PATH: `${e2eDataDir}/oracle.db`,
        ORACLE_EMBEDDER: 'none',
        VECTOR_URL: vectorURL,
        ORACLE_FILE_WATCHER: '0',
        ORACLE_GATEWAY_HOT_RELOAD: '0',
      },
    },
    {
      command: 'cd frontend && bun run dev --host 127.0.0.1',
      url: frontendURL,
      reuseExistingServer,
      timeout: 30000,
      env: {
        ...process.env,
        FRONTEND_PROXY_TARGET: backendURL,
        VITE_PORT: frontendPort,
      },
    },
  ],
});
