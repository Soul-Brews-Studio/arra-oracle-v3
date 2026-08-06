import { expect, test } from 'bun:test';
import { DB_PATH } from '../../../src/config.ts';
import { mcpTools } from '../../../src/tools/mcp-manifest.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health reports uptime, DB, vector, MCP, and plugin status', async () => {
  const previous = saveEmbedderEnv();
  const previousWorker = process.env.ORACLE_CONSOLIDATION_WORKER;
  process.env.ORACLE_EMBEDDER = 'none';
  delete process.env.ORACLE_CONSOLIDATION_WORKER;
  delete process.env.ORACLE_EMBEDDING_PROVIDER;
  delete process.env.ORACLE_EMBEDDER_BACKEND;
  delete process.env.EMBEDDER_TYPE;
  try {
    const app = createHealthRoutes({
      pluginCount: 5,
      pluginMcpToolCount: 2,
      uptimeSeconds: () => 42.125,
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: noneSelection,
      vectorHealth: async () => ({
        status: 'ok',
        engines: [{ key: 'bge-m3', model: 'bge-m3', collection: 'oracle_knowledge_bge_m3', ok: true }],
        checked_at: '2026-06-16T00:00:00.000Z',
      }),
    });

    const res = await app.handle(new Request('http://local/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;

    expect(body.status).toBe('ok');
    expect(body.healthStatus).toBe('degraded');
    expect(body.sandbox).toBe('dev');
    expect(body.uptime).toBe(42.125);
    expect(body.uptimeSeconds).toBe(42.125);
    expect(body.db).toBe('connected');
    expect(body.dbStatus).toBe('connected');
    expect(body.dbCheck).toMatchObject({ status: 'connected', path: DB_PATH });
    expect(body.subsystems.database).toMatchObject({ status: 'healthy', label: 'database writable' });
    expect(body.subsystems.fts).toMatchObject({ status: 'healthy', label: 'FTS healthy' });
    expect(body.vectorStatus).toBe('ok');
    expect(body.vector).toMatchObject({ status: 'ok', engines: [{ key: 'bge-m3', ok: true }] });
    expect(body.subsystems.vector).toMatchObject({ status: 'healthy', label: 'vector backend' });
    expect(body.subsystems.embedder.detail).toContain('FTS-only');
    expect(body.memory.fanoutReranking).toMatchObject({ strategy: 'confidence_weighted_rrf', confidenceSource: 'query-time-confidence' });
    expect(body.memory.fanoutReranking.enabled).toBe(body.memory.fanoutReranking.confidenceWeight > 0);
    expect(body.memory.fanoutReranking.confidenceWeight).toBeGreaterThanOrEqual(0);
    expect(body.memory.fanoutReranking.confidenceWeight).toBeLessThanOrEqual(1);
    expect(body.memory.consolidationWorker).toMatchObject({
      enabled: false,
      running: false,
      similarityThreshold: 0.95,
    });
    expect(body.memory.consolidationWorker.disabledReason).toContain('ORACLE_CONSOLIDATION_WORKER=1');
    expect(body.mcpToolCount).toBe(mcpTools.length + 2);
    expect(body.mcp.toolCount).toBe(mcpTools.length + 2);
    expect(body.pluginCount).toBe(5);
    expect(body.plugins.count).toBe(5);
    expect(body.db).toBe('connected');
    expect(body.version).toBeTypeOf('string');
    expect(typeof body.uptime).toBe('number');
  } finally {
    restoreEnv('ORACLE_CONSOLIDATION_WORKER', previousWorker);
    restoreEmbedderEnv(previous);
  }
});

test('GET /api/health reflects database ping result in status and db field', async () => {
  const previous = useExplicitNone();
  try {
    const app = createHealthRoutes({
      uptimeSeconds: () => 12.25,
      dbPing: () => ({ status: 'error', error: 'db offline' }),
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: noneSelection,
      vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
    });
    const res = await app.handle(new Request('http://local/api/health'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.healthStatus).toBe('down');
    expect(body.db).toBe('error');
    expect(body.oracle).toBe('degraded');
    expect(body.dbStatus).toBe('error');
    expect(body.dbCheck).toMatchObject({ status: 'error', error: 'db offline' });
    expect(body.subsystems.database).toMatchObject({ status: 'down', detail: 'db offline' });
  } finally {
    restoreEmbedderEnv(previous);
  }
});

test('GET /api/health catches dbPing exceptions and keeps response shaped', async () => {
  const previous = useExplicitNone();
  try {
    const app = createHealthRoutes({
      uptimeSeconds: () => 0.3333,
      dbPing: async () => { throw 'db locked'; },
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: noneSelection,
      vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
    });
    const res = await app.handle(new Request('http://local/api/health'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.healthStatus).toBe('down');
    expect(body.uptimeSeconds).toBe(0.333);
    expect(body.db).toBe('error');
    expect(body.oracle).toBe('degraded');
    expect(body.dbCheck).toMatchObject({ status: 'error', error: 'db locked' });
    expect(body.vectorStatus).toBe('ok');
  } finally {
    restoreEmbedderEnv(previous);
  }
});


test('GET /api/health reports healthy enum when every subsystem is available', async () => {
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
  try {
    const app = createHealthRoutes({
      pluginCount: 1,
      uptimeSeconds: () => 2,
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: ollamaSelection,
      vectorHealth: async () => ({ status: 'ok', engines: [{ key: 'bge', model: 'bge', collection: 'docs', ok: true, count: 1 }], checked_at: 'now' }),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
      embeddingProviders: async () => ({ checkedAt: 'now', providers: [{ type: 'ollama', available: true, configured: true, source: 'probe', models: ['bge'], capabilities: ['embed'] }] }),
    });
    const res = await app.handle(new Request('http://local/api/health'));
    const body = await res.json() as Record<string, any>;
    expect(body.healthStatus).toBe('healthy');
    expect(body.subsystems.embedder).toMatchObject({ status: 'healthy', label: 'embedder reachable' });
    expect(body.subsystems.mcp.status).toBe('healthy');
  } finally {
    restoreEnv('ORACLE_EMBEDDER', previous.embedder);
    restoreEnv('ORACLE_EMBEDDING_PROVIDER', previous.legacy);
    restoreEnv('ORACLE_EMBEDDER_BACKEND', previous.backend);
    restoreEnv('EMBEDDER_TYPE', previous.type);
  }
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function saveEmbedderEnv() {
  return {
    embedder: process.env.ORACLE_EMBEDDER,
    legacy: process.env.ORACLE_EMBEDDING_PROVIDER,
    backend: process.env.ORACLE_EMBEDDER_BACKEND,
    type: process.env.EMBEDDER_TYPE,
  };
}

function restoreEmbedderEnv(previous: ReturnType<typeof saveEmbedderEnv>) {
  restoreEnv('ORACLE_EMBEDDER', previous.embedder);
  restoreEnv('ORACLE_EMBEDDING_PROVIDER', previous.legacy);
  restoreEnv('ORACLE_EMBEDDER_BACKEND', previous.backend);
  restoreEnv('EMBEDDER_TYPE', previous.type);
}

function useExplicitNone() {
  const previous = saveEmbedderEnv();
  process.env.ORACLE_EMBEDDER = 'none';
  delete process.env.ORACLE_EMBEDDING_PROVIDER;
  delete process.env.ORACLE_EMBEDDER_BACKEND;
  delete process.env.EMBEDDER_TYPE;
  return previous;
}

const embeddedRuntime = () => ({ vectorMode: 'embedded' as const });
const noneSelection = { provider: 'none' as const, source: 'env' as const, explicit: true };
const ollamaSelection = { provider: 'ollama' as const, source: 'env' as const, explicit: true };
