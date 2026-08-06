import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('GET /api/health keeps HTTP 200 and shaped health contract when checks throw', async () => {
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
      uptimeSeconds: () => 31,
      vectorRuntime: () => ({ vectorMode: 'embedded' as const }),
      embeddingProviderSelection: { provider: 'ollama' as const, source: 'env' as const, explicit: true },
      dbPing: () => { throw new Error('sqlite busy'); },
      vectorHealth: async () => { throw new Error('vector offline'); },
      vectorServerHealth: async () => { throw new Error('proxy offline'); },
      pluginStatuses: () => { throw new Error('plugin scan failed'); },
      embeddingProviders: async () => { throw new Error('ollama timeout'); },
    });

    const res = await app.handle(new Request('http://local/api/health'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.healthStatus).toBe('down');
    expect(body.state).toBe('down');
    expect(['healthy', 'starting', 'degraded', 'down']).toContain(body.healthStatus);
    expect(body.dbCheck).toMatchObject({ status: 'error', error: 'sqlite busy' });
    expect(body.vector).toMatchObject({ status: 'down', error: 'vector offline' });
    expect(body.vectorServer).toMatchObject({ status: 'down', error: 'proxy offline' });
    expect(body.plugins.items[0]).toMatchObject({ status: 'degraded', error: 'plugin scan failed' });
    expect(body.subsystems.db).toEqual(body.subsystems.database);
    expect(body.subsystems.plugin).toEqual(body.subsystems.plugins);
    for (const name of ['database', 'db', 'fts', 'vector', 'embedder', 'plugins', 'plugin']) {
      expect(['healthy', 'starting', 'degraded', 'down']).toContain(body.subsystems[name].status);
    }
  } finally {
    restoreEnv('ORACLE_EMBEDDER', previous.embedder);
    restoreEnv('ORACLE_EMBEDDING_PROVIDER', previous.legacy);
    restoreEnv('ORACLE_EMBEDDER_BACKEND', previous.backend);
    restoreEnv('EMBEDDER_TYPE', previous.type);
  }
});
