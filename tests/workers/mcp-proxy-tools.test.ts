import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { remoteableMcpRestMap } from '../../src/tools/mcp-rest-map.ts';
import { proxyRequestFromEntry, workerMcpToolEntries } from '../../workers/mcp/src/tools.ts';
import { buildProxyUrl, oracleProxyTool, resolveMcpTenantId, resolveOracleUrl } from '../../workers/mcp/src/proxy.ts';

describe('Cloudflare MCP proxy tools', () => {
  test('generates the Worker tool list from the pure MCP REST map', () => {
    const entry = readFileSync('workers/mcp/src/index.ts', 'utf8');
    const tools = readFileSync('workers/mcp/src/tools.ts', 'utf8');

    expect(entry).toContain('registerOracleMcpTools');
    expect(entry).toContain("OracleMCP.serve('/mcp')");
    expect(tools).toContain('remoteableMcpRestMap');
    expect(tools).not.toContain("'muninn_search'");
    expect(workerMcpToolEntries.map((tool) => tool.name).sort()).toEqual(remoteableMcpRestMap.map((tool) => tool.name).sort());
    expect(workerMcpToolEntries.some((tool) => tool.name === 'oracle_learn')).toBe(true);
  });

  test('prefers ORACLE_ORIGIN_URL and appends only present query values', () => {
    const base = resolveOracleUrl({
      ORACLE_ORIGIN_URL: 'https://origin.example.test/oracle/?x=1#hash',
      ORACLE_URL: 'https://legacy.example.test',
    });
    const url = buildProxyUrl(base, '/api/search', {
      q: 'vector safety',
      limit: 5,
      offset: 0,
      empty: '',
      missing: undefined,
    });

    expect(base).toBe('https://origin.example.test/oracle');
    expect(url).toBe('https://origin.example.test/oracle/api/search?q=vector+safety&limit=5&offset=0');
    expect(resolveOracleUrl({ ORACLE_ORIGIN_URL: 'https://user:pass@origin.example/root/?x=1#hash' })).toBe('https://origin.example/root');
  });

  test('allowlists request body fields before proxying to the backend', () => {
    const learn = workerMcpToolEntries.find((tool) => tool.name === 'oracle_learn')!;
    const distill = workerMcpToolEntries.find((tool) => tool.name === 'oracle_trace_distill')!;

    expect(proxyRequestFromEntry(learn, { pattern: 'p', concepts: ['c'], tenantId: 'tenant-a', extra: 'drop' })?.body)
      .toEqual({ pattern: 'p', concepts: ['c'] });
    expect(proxyRequestFromEntry(distill, { traceId: 'tr-1', awakening: 'a', metadata: { ok: true }, tenantId: 'tenant-a', extra: 'drop' })?.body)
      .toEqual({ awakening: 'a', metadata: { ok: true } });
  });

  test('rejects non-http backend origin URLs', () => {
    expect(() => resolveOracleUrl({ ORACLE_ORIGIN_URL: 'file:///tmp/oracle.sock' })).toThrow('ORACLE_ORIGIN_URL must be http(s).');
  });

  test('strips deploy-time URL credentials before proxying', () => {
    const base = resolveOracleUrl({
      ORACLE_ORIGIN_URL: 'https://user:pass@origin.example.test/root/?debug=1#secret',
    });

    expect(base).toBe('https://origin.example.test/root');
    expect(buildProxyUrl(base, '/api/stats')).toBe('https://origin.example.test/root/api/stats');
  });

  test('proxies oracle_stats with auth and tenant headers', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return Response.json({ total_docs: 12, by_type: { learning: 12 } });
    }) as typeof fetch;

    const result = await oracleProxyTool({
      ORACLE_URL: 'https://oracle.example.test',
      ARRA_API_TOKEN: 'secret',
    }, { path: '/api/stats', tenantId: 'tenant-a' }, fetcher);

    const headers = captured[0].init?.headers as Headers;
    expect(result.isError).toBeUndefined();
    expect(captured[0].url).toBe('https://oracle.example.test/api/stats');
    expect(headers.get('authorization')).toBe('Bearer secret');
    expect(headers.get('X-Tenant-ID')).toBe('tenant-a');
    expect(headers.get('X-Oracle-Tenant')).toBe('tenant-a');
    expect(result.content[0].text).toContain('"total_docs": 12');
  });

  test('resolves tenant ids from OAuth props before tool args', () => {
    expect(resolveMcpTenantId({ claims: { tenant_id: 'school-a' } }, 'spoofed')).toBe('school-a');
    expect(resolveMcpTenantId(undefined, 'tenant-b')).toBe('tenant-b');
    expect(() => resolveMcpTenantId(undefined, 'bad tenant')).toThrow('invalid tenant id');
  });

  test('proxies oracle_learn as JSON and marks backend errors', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: String(input), init });
      return Response.json({ error: 'Missing required field: pattern' }, { status: 400 });
    }) as typeof fetch;

    const result = await oracleProxyTool({ ORACLE_HTTP_URL: 'https://oracle.example.test/' }, {
      method: 'POST',
      path: '/api/learn',
      body: { pattern: '' },
    }, fetcher);

    expect(result.isError).toBe(true);
    expect(captured[0].url).toBe('https://oracle.example.test/api/learn');
    expect(captured[0].init?.method).toBe('POST');
    expect(await new Request('https://local', captured[0].init).json()).toEqual({ pattern: '' });
    expect(result.content[0].text).toContain('Missing required field');
  });
});
