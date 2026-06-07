import { describe, expect, test } from 'bun:test';
import { authHeaders, buildFrontendUrl, listSubcommands, resolveBaseUrl, runArra } from '../index.ts';

type Call = { path: string; init?: RequestInit };
type RunCall = { cmd: string; args: string[]; options?: { cwd?: string; env?: Record<string, string | undefined>; inherit?: boolean; capture?: boolean } };

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
      'feed',
      'frontend',
      'handoff',
      'health',
      'inbox',
      'index',
      'learn',
      'list',
      'menu',
      'open',
      'plugins',
      'read',
      'reflect',
      'scan',
      'search',
      'settings',
      'stats',
      'studio',
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
      'ui',
      'vector',
      'vector_index',
      'vector_models',
      'vector_status',
      'vector_stop',
      'verify',
    ]);

    const help = await runArra(['help']);
    expect(help.output).toContain('frontend');
    expect(help.output).toContain('studio');
    expect(help.output).toContain('index');
    expect(help.output).toContain('vector');
    expect(help.output).toContain('vector-index');
    expect(help.output).toContain('trace_chain');
    expect(help.output).toContain('thread_update');
    expect(help.output).toContain('verify');
  });


  test('builds and optionally opens the frontend link', async () => {
    const env = { ORACLE_API: 'http://localhost:47778', ARRA_FRONTEND_URL: 'https://studio.buildwithoracle.com' };
    expect(buildFrontendUrl(env)).toBe('https://studio.buildwithoracle.com/?api=http://localhost:47778');

    const opened: string[] = [];
    const openResult = await runArra(['ui'], async () => ({}), url => opened.push(url), env);
    expect(openResult.ok).toBe(true);
    expect(openResult.output).toContain('https://studio.buildwithoracle.com/?api=http://localhost:47778');
    expect(opened).toEqual(['https://studio.buildwithoracle.com/?api=http://localhost:47778']);

    const noOpenResult = await runArra(['open', '--no-open'], async () => ({}), url => opened.push(url), env);
    expect(noOpenResult.output).toContain('not opened');
    expect(opened).toEqual(['https://studio.buildwithoracle.com/?api=http://localhost:47778']);
  });



  test('starts local Oracle Studio through ghq with default and custom ports', async () => {
    const calls: RunCall[] = [];
    const runner = async (cmd: string, args: string[], options?: RunCall['options']) => {
      calls.push({ cmd, args, options });
      return { code: 0, stdout: cmd === 'ghq' && args[0] === 'root' ? '/tmp/ghq\n' : '' };
    };

    const result = await runArra(['studio'], async () => ({}), () => {}, {}, runner);
    expect(result.ok).toBe(true);
    expect(result.output).toContain('port 4321');
    expect(calls.map(c => [c.cmd, c.args])).toEqual([
      ['ghq', ['get', '-u', 'Soul-Brews-Studio/oracle-studio']],
      ['ghq', ['root']],
      ['bun', ['install']],
      ['bun', ['run', 'dev', '--port', '4321']],
    ]);
    expect(calls[2]?.options?.cwd).toBe('/tmp/ghq/github.com/Soul-Brews-Studio/oracle-studio');
    expect(calls[3]?.options?.cwd).toBe('/tmp/ghq/github.com/Soul-Brews-Studio/oracle-studio');
    expect(calls[3]?.options?.env?.VITE_ARRA_API).toBe('http://localhost:47778');

    calls.length = 0;
    await runArra(['studio', '--port', '3000'], async () => ({}), () => {}, {}, runner);
    expect(calls[3]?.args).toEqual(['run', 'dev', '--port', '3000']);
  });

  test('rejects invalid studio ports', async () => {
    const result = await runArra(['studio', '--port', 'nope'], async () => ({}), () => {}, {}, async () => ({ code: 0 }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('--port');
  });


  test('routes read-only commands to the expected endpoints', async () => {
    const cases: Array<[string[], string, string]> = [
      [['search', 'hello', '--mode', 'vector', '--limit', '3'], 'GET', '/api/search?q=hello&limit=3&mode=vector'],
      [['stats'], 'GET', '/api/stats'],
      [['plugins'], 'GET', '/api/plugins'],
      [['settings'], 'GET', '/api/settings/tools'],
      [['feed'], 'GET', '/api/feed'],
      [['menu'], 'GET', '/api/menu'],
      [['vector'], 'GET', '/api/vector/config'],
      [['health'], 'GET', '/api/health'],
      [['vector-status'], 'GET', '/api/vector/index/status'],
      [['vector-models'], 'GET', '/api/vector/index/models'],
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
      [['index', '--project', 'demo', '--path', '/tmp/vault'], 'POST', '/api/indexer/reindex', { project: 'demo', path: '/tmp/vault' }],
      [['scan', '--path', '/tmp/vault'], 'POST', '/api/indexer/scan', { sourcePath: '/tmp/vault' }],
      [['trace', 'audit', '--scope', 'project'], 'POST', '/api/traces', { query: 'audit', scope: 'project' }],
      [['vector-index', '--model', 'all'], 'POST', '/api/vector/index/start', { model: 'all' }],
      [['vector-stop'], 'POST', '/api/vector/index/stop', undefined],
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
