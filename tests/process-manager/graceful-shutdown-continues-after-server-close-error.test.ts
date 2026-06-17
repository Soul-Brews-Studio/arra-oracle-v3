import { expect, test } from 'bun:test';
import { performGracefulShutdown } from '../../src/process-manager/index.ts';

test('graceful shutdown continues after HTTP server close errors', async () => {
  const calls: string[] = [];
  const server = {
    closeAllConnections: () => calls.push('connections'),
    close: (done: (error?: Error) => void) => {
      calls.push('server');
      done(new Error('already closed'));
    },
  };

  await performGracefulShutdown({
    server: server as any,
    services: [{ shutdown: async () => { calls.push('service'); } }],
    resources: [{ close: async () => { calls.push('resource'); } }],
    cleanup: async () => { calls.push('cleanup'); },
    removePid: false,
    killChildren: false,
  });

  expect(calls).toEqual(['connections', 'server', 'service', 'resource', 'cleanup']);
});

test('graceful shutdown still closes the server when connection cleanup fails', async () => {
  const calls: string[] = [];
  const server = {
    closeAllConnections: () => {
      calls.push('connections');
      throw new Error('socket sweep failed');
    },
    close: (done: (error?: Error) => void) => {
      calls.push('server');
      done();
    },
  };

  await performGracefulShutdown({
    server: server as any,
    services: [{ shutdown: async () => { calls.push('service'); } }],
    removePid: false,
    killChildren: false,
  });

  expect(calls).toEqual(['connections', 'server', 'service']);
});
