import { describe, expect, test } from 'bun:test';
import { authHeaders, buildFrontendUrl, listSubcommands, resolveBaseUrl, runArra } from '../index.ts';

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
    const subcommands = listSubcommands();
    expect(subcommands).toEqual([...subcommands].sort());
    expect(subcommands).toEqual(expect.arrayContaining([
      'backup',
      'canvas-plugins',
      'canvas-serve',
      'changelog',
      'config',
      'export',
      'export-obsidian',
      'import',
      'import-obsidian',
      'mcp_tools',
      'migrate',
      'schedule',
      'schedule_add',
      'supersede_chain',
      'supersede_list',
      'vault',
      'vault_sync',
      'vector_config',
    ]));

    const help = await runArra(['help']);
    expect(help.output).toContain('frontend');
    expect(help.output).toContain('export --format json|markdown');
    expect(help.output).toContain('index');
    expect(help.output).toContain('vector');
    expect(help.output).toContain('vector-config [--json]');
    expect(help.output).toContain('vector-config reload');
    expect(help.output).toContain('enabled <true|false>');
    expect(help.output).toContain('trace_chain');
    expect(help.output).toContain('thread_update');
    expect(help.output).toContain('serve [--stop|--status] [--port N]');
    expect(help.output).toContain('schedule-add');
    expect(help.output).toContain('vault-sync');
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



  test('serve starts, reports status, and stops by PID file', async () => {
    const home = await import('node:fs').then(({ mkdtempSync }) => mkdtempSync('/tmp/arra-serve-test-'));
    const calls: any[] = [];
    const runner = async (cmd: string, args: string[], options?: any) => {
      calls.push({ cmd, args, options });
      return { code: 0, stdout: '/repo/arra-oracle-v3\n', stderr: '' };
    };
    let alive = true;
    const env = { HOME: home };
    const start = await runArra(['serve', '--port', '49999'], async () => ({}), () => {}, env, runner, {
      start: (cwd, startEnv) => {
        calls.push({ cmd: 'start', cwd, env: startEnv });
        return 12345;
      },
      isAlive: () => alive,
    });
    expect(start.ok).toBe(true);
    expect(start.output).toContain('started pid=12345 port=49999');
    expect(calls).toContainEqual(expect.objectContaining({ cmd: 'ghq', args: ['locate', 'Soul-Brews-Studio/arra-oracle-v3'] }));
    expect(calls).toContainEqual(expect.objectContaining({ cmd: 'start', cwd: '/repo/arra-oracle-v3' }));

    const status = await runArra(['serve', '--status', '--port', '49999'], async () => ({}), () => {}, env, runner, {
      isAlive: () => true,
      fetch: async () => new Response('{"status":"ok"}', { status: 200 }),
    });
    expect(status.output).toContain('alive pid=12345');
    expect(status.output).toContain('health: ok 200');

    const stop = await runArra(['serve', '--stop'], async () => ({}), () => {}, env, runner, {
      isAlive: () => alive,
      kill: () => { alive = false; },
      sleep: async () => {},
    });
    expect(stop.output).toContain('stopped pid=12345');
  });

  test('routes read-only commands to the expected endpoints', async () => {
    const cases: Array<[string[], string, string]> = [
      [['search', 'hello', '--mode', 'vector', '--limit', '3'], 'GET', '/api/search?q=hello&limit=3&mode=vector'],
      [['stats'], 'GET', '/api/stats'],
      [['scan', '--path', '/tmp/vault'], 'POST', '/api/indexer/scan'],
      [['plugins'], 'GET', '/api/plugins'],
      [['settings'], 'GET', '/api/settings/tools'],
      [['feed'], 'GET', '/api/feed'],
      [['menu'], 'GET', '/api/menu'],
      [['vector'], 'GET', '/api/vector/config'],
      [['vector_status'], 'GET', '/api/vector/index/status'],
      [['vector_models'], 'GET', '/api/vector/index/models'],
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
      [['schedule', '--status', 'pending', '--limit', '2'], 'GET', '/api/schedule?status=pending&limit=2'],
      [['supersede-list', '--limit', '2'], 'GET', '/api/supersede?limit=2'],
      [['supersede-chain', 'ψ/demo.md'], 'GET', '/api/supersede/chain/%CF%88%2Fdemo.md'],
      [['mcp-tools'], 'GET', '/api/mcp/tools'],
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
      [['trace', 'audit', '--scope', 'project'], 'POST', '/api/traces', { query: 'audit', scope: 'project' }],
      [['trace_link', 'a', 'b'], 'POST', '/api/traces/a/link', { nextId: 'b' }],
      [['trace_unlink', 'a', '--direction', 'next'], 'DELETE', '/api/traces/a/link?direction=next', undefined],
      [['handoff', 'hello', '--slug', 'demo'], 'POST', '/api/handoff', { content: 'hello', slug: 'demo' }],
      [['supersede', 'old', 'new', '--reason', 'newer'], 'POST', '/api/supersede/document', { oldId: 'old', newId: 'new', reason: 'newer' }],
      [['thread', 'hello', '--thread-id', '42', '--title', 'T'], 'POST', '/api/thread', { message: 'hello', thread_id: 42, title: 'T', role: 'human' }],
      [['thread_update', '42', '--status', 'closed'], 'PATCH', '/api/thread/42/status', { status: 'closed' }],
      [['vector_index', '--model', 'nomic'], 'POST', '/api/vector/index/start', { model: 'nomic' }],
      [['vector_stop'], 'POST', '/api/vector/index/stop', undefined],
      [['vector-config', 'set', 'bge-m3', 'adapter', 'qdrant'], 'PUT', '/api/v1/vector/config/bge-m3', { adapter: 'qdrant' }],
      [['vector-config', 'set', 'bge-m3', 'enabled', 'false'], 'PUT', '/api/v1/vector/config/bge-m3', { enabled: false }],
      [['vector-config', 'reload'], 'POST', '/api/v1/vector/config/reload', undefined],
      [['vector-config', 'test', 'bge-m3'], 'POST', '/api/v1/vector/config/bge-m3/test', undefined],
      [['schedule-add', 'standup', '--date', '2026-06-16'], 'POST', '/api/schedule', { event: 'standup', date: '2026-06-16' }],
      [['vault-sync', '--dry-run', '--reindex'], 'POST', '/api/vault/sync', { dryRun: true, reindex: true }],
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
    const health = await runArra(['health'], async () => ({ status: 'ok', vectorMode: 'proxied', vectorStatus: 'ok', vector: { engines: [{ key: 'bge-m3', adapter: 'lancedb', model: 'bge-m3', ok: true, count: 12 }] } }));
    expect(health.output).toContain('vectorMode: proxied');
    expect(health.output).toContain('vector bge-m3: ok lancedb bge-m3 docs=12');

    const search = await runArra(['search', 'hello'], async () => ({ total: 1, results: [{ id: 'doc1', type: 'learning', content: 'hello memory', score: 0.9 }] }));
    expect(search.output).toContain('arra search: 1 result');
  });
});
