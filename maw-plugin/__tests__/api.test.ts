import { describe, expect, test } from 'bun:test';
import handler from '../index.ts';
import { apiArgsToCliArgs } from '../api.ts';

describe('maw arra API surface', () => {
  test('manifest API query args map to CLI argv', () => {
    expect(apiArgsToCliArgs({ command: 'search', query: 'hello world', limit: '3' })).toEqual([
      'search',
      '--query',
      'hello world',
      '--limit',
      '3',
    ]);
    expect(apiArgsToCliArgs({ subcommand: 'vector-config', args: ['set', 'bge-m3', 'adapter', 'qdrant'] })).toEqual([
      'vector-config',
      'set',
      'bge-m3',
      'adapter',
      'qdrant',
    ]);
  });

  test('default handler accepts maw-js API object args', async () => {
    const oldFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ status: 'ok', version: 'test' }), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await handler({ source: 'api', args: { command: 'health' } });
      expect(result.ok).toBe(true);
      expect(result.output).toContain('arra health: ok');
      expect(calls[0]).toMatchObject({ url: 'http://localhost:47778/api/health' });
      expect(calls[0]?.init?.method).toBe('GET');
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  test('default handler streams CLI output through maw-js writer', async () => {
    const oldFetch = globalThis.fetch;
    const writes: string[] = [];
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as typeof fetch;
    try {
      const result = await handler({
        source: 'cli',
        args: ['health'],
        writer: (line) => writes.push(String(line)),
      });

      expect(result).toEqual({ ok: true });
      expect(writes.join('\n')).toContain('arra health: ok');
    } finally {
      globalThis.fetch = oldFetch;
    }
  });

  test('MCP source dispatches read-only commands and blocks writes', async () => {
    const oldFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }) as typeof fetch;
    try {
      const health = await handler({ source: 'mcp', args: { command: 'health' } });
      const denied = await handler({ source: 'mcp', args: { command: 'learn', args: ['secret'] } });

      expect(health.ok).toBe(true);
      expect(health.output).toContain('arra health: ok');
      expect(denied).toEqual({ ok: false, error: 'MCP surface exposes read-only commands only' });
      expect(calls).toEqual(['http://localhost:47778/api/health']);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});
