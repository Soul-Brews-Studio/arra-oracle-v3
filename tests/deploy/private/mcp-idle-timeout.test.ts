import { expect, test } from 'bun:test';

test('private HTTP listener tolerates bounded LLM requests beyond Bun default ten seconds', async () => {
  const server = await Bun.file('src/server.ts').text();
  expect(server).toContain('hostname: bindHost, port: app.port, fetch: app.fetch, idleTimeout: 120');
});
