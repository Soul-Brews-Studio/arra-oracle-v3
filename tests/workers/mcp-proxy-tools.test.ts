import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildProxyUrl, oracleProxyTool, resolveMcpTenantId, resolveOracleUrl } from '../../workers/mcp/src/proxy.ts';

describe('Cloudflare MCP proxy tools', () => {
  test('registers search, stats, and learn tools in the Worker entry', () => {
    const entry = readFileSync('workers/mcp/src/index.ts', 'utf8');

    expect(entry).toContain("'muninn_search'");
    expect(entry).toContain("'muninn_stats'");
    expect(entry).toContain("'oracle_learn'");
    expect(entry).toContain("OracleMCP.serve('/mcp')");
  });

  test('normalizes backend URLs and appends only present query values', () => {
    const base = resolveOracleUrl({ ORACLE_URL: 'https://oracle.example.test/oracle/?x=1#hash' });
    const url = buildProxyUrl(base, '/api/search', {
      q: 'vector safety',
      limit: 5,
      offset: 0,
      empty: '',
      missing: undefined,
    });

    expect(base).toBe('https://oracle.example.test/oracle');
    expect(url).toBe('https://oracle.example.test/oracle/api/search?q=vector+safety&limit=5&offset=0');
  });

  test('proxies muninn_stats with auth and tenant headers', async () => {
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
