import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import { clearEmbedderRuntimeStatusForTests, setEmbedderRuntimeStatus } from '../../../src/vector/embedder-config.ts';

test('unset ORACLE_EMBEDDER auto-selects ollama when probe is available', async () => {
  const previous = saveEmbedderEnv();
  clearEmbedderEnv();
  try {
    const app = createHealthRoutes({
      pluginCount: 1,
      uptimeSeconds: () => 5,
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: { provider: 'ollama', source: 'auto-default', explicit: false },
      vectorHealth: async () => vectorHealth(3),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
      embeddingProviders: async () => ({
        checkedAt: 'now',
        providers: [{ type: 'ollama', available: true, configured: false, source: 'probe', models: ['bge-m3'], capabilities: ['embed'] }],
      }),
    });

    const body = await json(app);
    expect(body.subsystems.embedder).toMatchObject({
      status: 'healthy',
      detail: 'ollama available',
    });
  } finally {
    restoreEmbedderEnv(previous);
  }
});

test('explicit none with existing vector docs reports embedder drift warning', async () => {
  const previous = saveEmbedderEnv();
  clearEmbedderEnv();
  process.env.ORACLE_EMBEDDER = 'none';
  try {
    const app = createHealthRoutes({
      pluginCount: 1,
      uptimeSeconds: () => 5,
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: { provider: 'none', source: 'env', explicit: true },
      vectorHealth: async () => vectorHealth(42),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
    });

    const body = await json(app);
    expect(body.subsystems.embedder.status).toBe('degraded');
    expect(body.subsystems.embedder.detail).toContain('drift warning');
    expect(body.subsystems.embedder.data).toMatchObject({
      warning: 'embedder_disabled_with_vector_docs',
      vectorDocs: 42,
    });
  } finally {
    restoreEmbedderEnv(previous);
  }
});

test('runtime embedder degradation is surfaced in health output', async () => {
  setEmbedderRuntimeStatus({
    status: 'degraded', provider: 'ollama', source: 'auto-default', explicit: false,
    reason: 'ECONNREFUSED 127.0.0.1:11434', checkedAt: 'now',
  });
  try {
    const app = createHealthRoutes({
      pluginCount: 1,
      uptimeSeconds: () => 5,
      vectorRuntime: embeddedRuntime,
      embeddingProviderSelection: { provider: 'ollama', source: 'auto-default', explicit: false },
      vectorHealth: async () => vectorHealth(3),
      vectorServerHealth: async () => ({ configured: false, status: 'unconfigured' }),
    });

    const body = await json(app);
    expect(body.vectorStatus).toBe('degraded');
    expect(body.vectorAvailable).toBe(false);
    expect(body.vectorReason).toBe('ECONNREFUSED 127.0.0.1:11434');
    expect(body.embedderStatus).toMatchObject({ status: 'degraded', provider: 'ollama' });
    expect(body.subsystems.embedder).toMatchObject({
      status: 'degraded',
      data: { reason: 'ECONNREFUSED 127.0.0.1:11434' },
    });
  } finally {
    clearEmbedderRuntimeStatusForTests();
  }
});

function vectorHealth(count: number) {
  return {
    status: 'ok' as const,
    engines: [{ key: 'bge-m3', model: 'bge-m3', collection: 'docs', adapter: 'lancedb', embeddingProvider: 'ollama', connectionStatus: 'connected' as const, ok: true, count }],
    checked_at: 'now',
  };
}

async function json(app: ReturnType<typeof createHealthRoutes>) {
  return await (await app.handle(new Request('http://local/api/health'))).json() as Record<string, any>;
}

function saveEmbedderEnv() {
  return {
    embedder: process.env.ORACLE_EMBEDDER,
    legacy: process.env.ORACLE_EMBEDDING_PROVIDER,
    backend: process.env.ORACLE_EMBEDDER_BACKEND,
    type: process.env.EMBEDDER_TYPE,
  };
}

function clearEmbedderEnv() {
  delete process.env.ORACLE_EMBEDDER;
  delete process.env.ORACLE_EMBEDDING_PROVIDER;
  delete process.env.ORACLE_EMBEDDER_BACKEND;
  delete process.env.EMBEDDER_TYPE;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function restoreEmbedderEnv(previous: ReturnType<typeof saveEmbedderEnv>) {
  restoreEnv('ORACLE_EMBEDDER', previous.embedder);
  restoreEnv('ORACLE_EMBEDDING_PROVIDER', previous.legacy);
  restoreEnv('ORACLE_EMBEDDER_BACKEND', previous.backend);
  restoreEnv('EMBEDDER_TYPE', previous.type);
}

const embeddedRuntime = () => ({ vectorMode: 'embedded' as const });
