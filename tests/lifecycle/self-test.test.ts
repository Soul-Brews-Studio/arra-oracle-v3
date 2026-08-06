import { describe, expect, test } from 'bun:test';
import {
  createStartupSelfTest,
  runStartupSelfTest,
  validateVectorConfig,
} from '../../src/lifecycle/self-test.ts';

describe('startup self-test', () => {
  test('logs pass and fail results without throwing', async () => {
    const logs: string[] = [];
    const results = await runStartupSelfTest({
      checks: [
        { name: 'db', run: () => undefined },
        { name: 'health-endpoint', run: () => { throw new Error('boom'); } },
      ],
      log: (message) => logs.push(message),
    });

    expect(results).toEqual([
      { name: 'db', status: 'pass', message: 'ok' },
      { name: 'health-endpoint', status: 'fail', message: 'boom' },
    ]);
    expect(logs).toContain('[SelfTest] PASS db');
    expect(logs).toContain('[SelfTest] FAIL health-endpoint — boom');
    expect(logs.at(-1)).toBe('[SelfTest] summary: 1 passed, 1 failed');
  });

  test('checks db ping, health endpoint, and vector config dependencies', async () => {
    const results = await runStartupSelfTest({
      checks: createStartupSelfTest({
        dbPing: () => 'ok',
        healthFetch: async () => new Response('{}', { status: 200 }),
        vectorConfig: () => validVectorConfig(),
      }),
      log: () => undefined,
    });

    expect(results.map((result) => result.name)).toEqual(['db', 'health-endpoint', 'vector-config']);
    expect(results.every((result) => result.status === 'pass')).toBe(true);
  });

  test('rejects incomplete vector config with a clear message', () => {
    expect(() => validateVectorConfig({ version: '1.0', host: '0.0.0.0', port: 8081, dataPath: '/tmp', collections: {} }))
      .toThrow(/collections must not be empty/);
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
    embeddingEndpoint: '',
  };
}
