import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server cleanup stops watchers and closes embedded resources', async () => {
  const calls: string[] = [];
  const server = withProxyServer();
  (server as any).stopToolGroupsWatch = () => calls.push('watch');
  (server as any).sqlite = { close: () => calls.push('sqlite') };
  (server as any).vectorStore = { close: async () => calls.push('vector') };
  await server.cleanup();
  expect(calls).toEqual(['watch', 'sqlite', 'vector']);
});
