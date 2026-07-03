import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

function withEmbedder<T>(fn: () => Promise<T>) {
  const previous = {
    embedder: process.env.ORACLE_EMBEDDER,
    legacy: process.env.ORACLE_EMBEDDING_PROVIDER,
    backend: process.env.ORACLE_EMBEDDER_BACKEND,
    type: process.env.EMBEDDER_TYPE,
  };
  process.env.ORACLE_EMBEDDER = 'ollama';
  delete process.env.ORACLE_EMBEDDING_PROVIDER;
  delete process.env.ORACLE_EMBEDDER_BACKEND;
  delete process.env.EMBEDDER_TYPE;
  return fn().finally(() => {
    restore('ORACLE_EMBEDDER', previous.embedder);
    restore('ORACLE_EMBEDDING_PROVIDER', previous.legacy);
    restore('ORACLE_EMBEDDER_BACKEND', previous.backend);
    restore('EMBEDDER_TYPE', previous.type);
  });
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('GET /api/health exposes shared state and db/plugin subsystem aliases', async () => withEmbedder(async () => {
  const app = createHealthRoutes({
    pluginCount: 1,
    uptimeSeconds: () => 2,
    vectorHealth: async () => ({ status: 'ok', engines: [{ key: 'bge', model: 'bge', collection: 'docs', ok: true, count: 1 }], checked_at: 'now' }),
    vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
    embeddingProviders: async () => ({ checkedAt: 'now', providers: [{ type: 'ollama', available: true, configured: true, source: 'probe', models: ['bge'], capabilities: ['embed'] }] }),
  });

  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.healthStatus).toBe('healthy');
  expect(body.state).toBe('healthy');
  expect(body.checked_at).toBeTypeOf('string');
  expect(body.subsystems.db).toEqual(body.subsystems.database);
  expect(body.subsystems.plugin).toEqual(body.subsystems.plugins);
  expect(body.subsystems.vector).toMatchObject({ status: 'healthy', label: 'vector backend' });
  expect(body.subsystems.fts).toMatchObject({ status: 'healthy', label: 'FTS healthy' });
}));

test('GET /api/health maps draining to down with subsystem detail', async () => {
  let checked = false;
  const app = createHealthRoutes({
    isDraining: () => true,
    dbPing: () => { checked = true; return { status: 'connected' }; },
  });

  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(503);
  expect(checked).toBe(false);
  expect(body.status).toBe('draining');
  expect(body.healthStatus).toBe('down');
  expect(body.state).toBe('down');
  expect(body.subsystems.db).toMatchObject({ status: 'down', label: 'database writable' });
  expect(body.subsystems.plugin).toMatchObject({ status: 'down', label: 'plugins loaded' });
});
