import { describe, expect, test } from 'bun:test';
import { authHeaders, resolveBaseUrl, runArra } from '../index.ts';

describe('maw arra plugin', () => {
  test('resolves base URL from ORACLE_API with localhost fallback', () => {
    expect(resolveBaseUrl({})).toBe('http://localhost:47778');
    expect(resolveBaseUrl({ ORACLE_API: 'http://example.test:47778/' })).toBe('http://example.test:47778');
  });

  test('routes search with fts default mode and limit', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const result = await runArra(['search', 'hello', 'world'], async (path, init) => {
      calls.push({ path, init });
      return { total: 1, results: [{ id: 'doc1', type: 'learning', content: 'hello world memory', score: 0.9 }] };
    });

    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe('/api/search?q=hello+world&mode=fts&limit=5');
    expect(result.output).toContain('arra search: 1 result');
  });

  test('attaches ARRA_API_TOKEN as bearer auth', () => {
    expect(authHeaders({ ARRA_API_TOKEN: 'secret' })).toEqual({ Authorization: 'Bearer secret' });
  });

  test('routes learn to POST /api/learn with project', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const result = await runArra(['learn', 'new', 'pattern', '--project', 'demo'], async (path, init) => {
      calls.push({ path, init });
      return { success: true, id: 'learning_demo' };
    });

    expect(result.ok).toBe(true);
    expect(calls[0]?.path).toBe('/api/learn');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ pattern: 'new pattern', project: 'demo' });
  });

  test('routes compact health and trace commands', async () => {
    const health = await runArra(['health'], async () => ({ status: 'ok', vectorMode: 'proxied' }));
    expect(health.output).toContain('vectorMode: proxied');

    const trace = await runArra(['trace', 'abc123'], async (path) => ({ trace_id: path.split('/').pop(), query: 'audit me' }));
    expect(trace.output).toContain('abc123');
  });
});
