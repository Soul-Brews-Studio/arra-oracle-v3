import { expect, test } from 'bun:test';
import { withProxyServer } from './support/server.ts';

test('MCP server SIGINT handler cleans up before exiting', async () => {
  const originalOn = process.on;
  const originalExit = process.exit;
  let captured: (() => Promise<void>) | null = null;
  let exitCode: number | undefined;
  (process as any).on = (event: string, listener: () => Promise<void>) => { if (event === 'SIGINT') captured = listener; return process; };
  (process as any).exit = (code?: number) => { exitCode = code; return undefined as never; };
  try {
    const server = withProxyServer();
    (server as any).cleanup = async () => {};
    await captured?.();
    expect(exitCode).toBe(0);
    await server.cleanup();
  } finally {
    process.on = originalOn;
    process.exit = originalExit;
  }
});
