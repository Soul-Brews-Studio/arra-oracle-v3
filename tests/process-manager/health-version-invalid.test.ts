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

test('worker version tolerates normalized base URLs and paths', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ version: ' 1.2.3 ' }) });
  try {
    expect(await getWorkerVersion(server.port, 'version', { baseUrl: 'http://127.0.0.1/' }))
      .toBe('1.2.3');
  } finally {
    await server.stop();
  }
});
