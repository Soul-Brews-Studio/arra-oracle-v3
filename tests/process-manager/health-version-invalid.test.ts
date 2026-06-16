import { expect, test } from 'bun:test';
import { getWorkerVersion } from '../../src/process-manager/index.ts';

test('worker version returns null for malformed version payloads', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ version: 7 }) });
  try {
    expect(await getWorkerVersion(server.port)).toBeNull();
  } finally {
    await server.stop();
  }
});
