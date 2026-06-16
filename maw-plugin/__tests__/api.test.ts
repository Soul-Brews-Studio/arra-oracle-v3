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
});
