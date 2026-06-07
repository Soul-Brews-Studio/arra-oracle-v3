import { describe, expect, test } from 'bun:test';
import { authHeaders, listSubcommands, resolveBaseUrl, runArra } from '../index.ts';

type Call = { path: string; init?: RequestInit };

async function route(args: string[], response: unknown = { success: true }): Promise<{ result: Awaited<ReturnType<typeof runArra>>; calls: Call[] }> {
  const calls: Call[] = [];
  const result = await runArra(args, async (path, init) => {
    calls.push({ path, init });
    return response;
  });
  return { result, calls };
}

function body(call: Call): unknown {
  return call.init?.body ? JSON.parse(String(call.init.body)) : undefined;
}

describe('maw arra plugin', () => {
  test('resolves base URL from ORACLE_API with localhost fallback', () => {
    expect(resolveBaseUrl({})).toBe('http://localhost:47778');
    expect(resolveBaseUrl({ ORACLE_API: 'http://example.test:47778/' })).toBe('http://example.test:47778');
  });

  test('attaches ARRA_API_TOKEN as bearer auth', () => {
    expect(authHeaders({ ARRA_API_TOKEN: 'secret' })).toEqual({ Authorization: 'Bearer secret' });
  });

  test('help lists the full compact MCP surface', async () => {
    expect(listSubcommands()).toEqual([
      'concepts',
      'handoff',
      'health',
      'inbox',
      'learn',
      'list',
      'read',
      'reflect',
      'search',
      'stats',
      'supersede',
      'thread',
      'thread_read',
      'thread_update',
      'threads',
      'trace',
      'trace_chain',
      'trace_get',
      'trace_link',
      'trace_list',
      'trace_unlink',
      'verify',
    ]);

    const help = await runArra(['help']);
    expect(help.output).toContain('trace_chain');
    expect(help.output).toContain('thread_update');
    expect(help.output).toContain('verify');
  });

  test('routes read-only commands to the expected endpoints', async () => {
    const cases: Array<[string[], string, string]> = [
      [['search', 'hello', '--mode', 'vector', '--limit', '3'], 'GET', '/api/search?q=hello&limit=3&mode=vector'],
      [['stats'], 'GET', '/api/stats'],
      [['health'], 'GET', '/api/health'],
      [['trace_list', '--status', 'raw', '--limit', '2'], 'GET', '/api/traces?status=raw&limit=2'],
      [['trace_get', 'abc'], 'GET', '/api/traces/abc'],
      [['trace-get', 'abc', '--include-chain'], 'GET', '/api/traces/abc/chain'],
      [['trace_chain', 'abc'], 'GET', '/api/traces/abc/linked-chain'],
      [['concepts', '--limit', '4'], 'GET', '/api/concepts?limit=4'],
      [['inbox', '--type', 'handoff', '--limit', '1'], 'GET', '/api/inbox?type=handoff&limit=1'],
      [['list', '--type', 'learning', '--limit', '7'], 'GET', '/api/list?type=learning&limit=7&group=false'],
      [['read', '--id', 'doc1'], 'GET', '/api/read?id=doc1'],
      [['reflect'], 'GET', '/api/reflect'],
      [['threads', '--status', 'active', '--limit', '5'], 'GET', '/api/threads?status=active&limit=5'],
      [['thread_read', '42'], 'GET', '/api/thread/42'],
    ];

    for (const [args, method, path] of cases) {
      const { result, calls } = await route(args, { total: 0, results: [], traces: [], concepts: [], files: [], documents: [], threads: [] });
      expect(result.ok, args.join(' ')).toBe(true);
      expect(calls[0]?.init?.method, args.join(' ')).toBe(method);
      expect(calls[0]?.path, args.join(' ')).toBe(path);
    }
  });

  test('routes write commands with compact JSON bodies', async () => {
    const cases: Array<[string[], string, string, unknown]> = [
      [['learn', 'new', 'pattern', '--project', 'demo'], 'POST', '/api/learn', { pattern: 'new pattern', project: 'demo' }],
      [['trace', 'audit', '--scope', 'project'], 'POST', '/api/traces', { query: 'audit', scope: 'project' }],
      [['trace_link', 'a', 'b'], 'POST', '/api/traces/a/link', { nextId: 'b' }],
      [['trace_unlink', 'a', '--direction', 'next'], 'DELETE', '/api/traces/a/link?direction=next', undefined],
      [['handoff', 'hello', '--slug', 'demo'], 'POST', '/api/handoff', { content: 'hello', slug: 'demo' }],
      [['supersede', 'old', 'new', '--reason', 'newer'], 'POST', '/api/supersede/document', { oldId: 'old', newId: 'new', reason: 'newer' }],
      [['thread', 'hello', '--thread-id', '42', '--title', 'T'], 'POST', '/api/thread', { message: 'hello', thread_id: 42, title: 'T', role: 'human' }],
      [['thread_update', '42', '--status', 'closed'], 'PATCH', '/api/thread/42/status', { status: 'closed' }],
      [['verify', '--check', 'false', '--type', 'learning'], 'POST', '/api/verify', { check: false, type: 'learning' }],
    ];

    for (const [args, method, path, expectedBody] of cases) {
      const { result, calls } = await route(args, { success: true, id: 'ok' });
      expect(result.ok, args.join(' ')).toBe(true);
      expect(calls[0]?.init?.method, args.join(' ')).toBe(method);
      expect(calls[0]?.path, args.join(' ')).toBe(path);
      expect(body(calls[0]!), args.join(' ')).toEqual(expectedBody);
    }
  });

  test('write commands attach bearer token when configured', async () => {
    const oldToken = process.env.ARRA_API_TOKEN;
    process.env.ARRA_API_TOKEN = 'secret';
    try {
      const { calls } = await route(['handoff', 'hello'], { success: true });
      expect(calls[0]?.init?.headers).toEqual({ Authorization: 'Bearer secret' });
    } finally {
      if (oldToken === undefined) delete process.env.ARRA_API_TOKEN;
      else process.env.ARRA_API_TOKEN = oldToken;
    }
  });

  test('formats compact health and search output', async () => {
    const health = await runArra(['health'], async () => ({ status: 'ok', vectorMode: 'proxied' }));
    expect(health.output).toContain('vectorMode: proxied');

    const search = await runArra(['search', 'hello'], async () => ({ total: 1, results: [{ id: 'doc1', type: 'learning', content: 'hello memory', score: 0.9 }] }));
    expect(search.output).toContain('arra search: 1 result');
  });
});
