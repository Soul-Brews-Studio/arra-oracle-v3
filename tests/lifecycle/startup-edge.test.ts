import { describe, expect, test } from 'bun:test';
import { readStartupDbStatus } from '../../src/lifecycle/startup-context.ts';
import { createStartupSelfTest, runStartupSelfTest } from '../../src/lifecycle/self-test.ts';

describe('startup lifecycle edge cases', () => {
  test('reports thrown db startup checks as degraded strings', () => {
    const status = readStartupDbStatus(() => {
      throw 'disk unavailable';
    });

    expect(status).toBe('degraded (disk unavailable)');
  });

  test('fails the health self-test clearly when the fetcher returns no response', async () => {
    const results = await runStartupSelfTest({
      checks: createStartupSelfTest({
        dbPing: () => 'ok',
        healthFetch: async () => undefined as unknown as Response,
        vectorConfig: () => validVectorConfig(),
      }),
      log: () => undefined,
    });

    expect(results.find((result) => result.name === 'health-endpoint')).toMatchObject({
      status: 'fail',
      message: 'health endpoint returned an invalid response',
    });
  });
});

function validVectorConfig() {
  return {
    version: '1.0',
    host: '0.0.0.0',
    port: 8081,
    collections: {
      main: { collection: 'oracle_knowledge', model: 'nomic-embed-text', provider: 'none' },
    },
    dataPath: '/tmp/lancedb',
  };
}
