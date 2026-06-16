import { afterEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../../src/db/schema.ts';
import { createDbContextFetch, currentDbRequestContext, currentDbRequestId, setDbQueryTraceObserverForTests, type DbQueryTrace } from '../../../src/middleware/db-context.ts';
import { createCorrelationMiddleware, REQUEST_ID_HEADER } from '../../../src/middleware/correlation.ts';
import { createStorageBackend } from '../../../src/storage/registry.ts';
import type { StorageBackend } from '../../../src/storage/types.ts';

let tempDir = '';
let restoreTraceObserver: (() => void) | undefined;
let backend: StorageBackend | undefined;

afterEach(() => {
  restoreTraceObserver?.();
  restoreTraceObserver = undefined;
  backend?.close();
  backend = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function createBackend(): StorageBackend {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-db-context-'));
  backend = createStorageBackend({ dbPath: path.join(tempDir, 'oracle.db') });
  return backend;
}

function createApp(storage: StorageBackend) {
  return new Elysia()
    .use(createCorrelationMiddleware())
    .get('/db-write', ({ requestId }) => {
      const key = 'db_context_request_trace';
      storage.db.insert(settings)
        .values({ key, value: requestId, updatedAt: Date.now() })
        .onConflictDoUpdate({ target: settings.key, set: { value: requestId, updatedAt: Date.now() } })
        .run();
      const row = storage.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get();
      return { requestId, stored: row?.value, dbContext: currentDbRequestContext() };
    });
}

test('db context attaches the X-Request-Id to Drizzle query traces', async () => {
  const storage = createBackend();
  const traces: DbQueryTrace[] = [];
  restoreTraceObserver = setDbQueryTraceObserverForTests((trace) => traces.push(trace));
  const app = createApp(storage);
  const handle = createDbContextFetch((request) => app.handle(request));

  const response = await handle(new Request('http://local/db-write', {
    headers: { [REQUEST_ID_HEADER]: 'request-trace-test-id' },
  }));
  const body = await response.json() as { requestId: string; stored: string; dbContext: { requestId: string } };

  expect(response.status).toBe(200);
  expect(response.headers.get(REQUEST_ID_HEADER)).toBe('request-trace-test-id');
  expect(body).toEqual({
    requestId: 'request-trace-test-id',
    stored: 'request-trace-test-id',
    dbContext: { requestId: 'request-trace-test-id' },
  });
  expect(currentDbRequestId()).toBeUndefined();
  expect(traces.length).toBeGreaterThanOrEqual(2);
  expect(traces.every((trace) => trace.requestId === 'request-trace-test-id')).toBe(true);
  expect(traces.some((trace) => trace.query.toLowerCase().includes('settings'))).toBe(true);
  expect(traces.every((trace) => Array.isArray(trace.params))).toBe(true);
});
