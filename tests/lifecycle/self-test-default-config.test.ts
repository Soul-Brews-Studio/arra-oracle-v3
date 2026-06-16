import { describe, expect, test } from 'bun:test';
import { createStartupSelfTest, runStartupSelfTest } from '../../src/lifecycle/self-test.ts';

describe('startup self-test default vector config', () => {
  test('falls back to the generated vector config when no loader is supplied', async () => {
    const results = await runStartupSelfTest({
      checks: createStartupSelfTest({
        dbPing: () => undefined,
        healthFetch: async () => new Response('{}', { status: 200 }),
      }),
      log: () => undefined,
    });

    expect(results.find((result) => result.name === 'vector-config')).toMatchObject({
      status: 'pass',
      message: 'ok',
    });
  });
});
