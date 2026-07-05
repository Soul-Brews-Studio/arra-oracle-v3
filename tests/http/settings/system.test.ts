import { expect, test } from 'bun:test';
import { systemSettingsRoute } from '../../../src/routes/settings/system.ts';

test('GET /system returns runtime storage, embedder, and migration status', async () => {
  const res = await systemSettingsRoute.handle(new Request('http://local/system'));
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, any>;
  expect(body.storage.activeBackend).toBeTruthy();
  expect(body.storage.dbPath).toContain('oracle.db');
  expect(body.embedder.backend).toBeTruthy();
  expect(Array.isArray(body.embedder.collections)).toBe(true);
  expect(body.migrations.availableCount).toBeGreaterThan(0);
  expect(body.migrations.status).toMatch(/current|pending/);
});
