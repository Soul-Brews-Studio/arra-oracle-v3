import { afterEach, describe, expect, it } from 'bun:test';
import {
  healthResponse,
  oracleApiUrl,
  resolveBackendBase,
  runRemoteOracleHealth,
  runRemoteOracleSearch,
} from '../../src/workers/cloudflare-mcp/tools.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Cloudflare remote MCP worker helpers', () => {
  it('normalizes HTTP backend URLs and rejects non-http values', () => {
    expect(resolveBackendBase({ ORACLE_HTTP_URL: 'https://oracle.example/api/' })).toBe('https://oracle.example/api');
    expect(resolveBackendBase({ ORACLE_HTTP_URL: 'file:///tmp/oracle.db' })).toBeNull();
    expect(oracleApiUrl('https://oracle.example/api', '/api/search').toString()).toBe('https://oracle.example/api/search');
  });

  it('reports transport and backend configuration through health output', async () => {
    const result = runRemoteOracleHealth({ ORACLE_HTTP_URL: 'https://oracle.example' });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.tools).toContain('oracle_search');
    expect(payload.transports.streamableHttp).toBe('/mcp');
    expect(payload.backend.configured).toBe(true);

    const response = healthResponse({});
    expect(response.headers.get('content-type')).toContain('application/json');
    const health = await response.json() as { backend: { configured: boolean } };
    expect(health.backend.configured).toBe(false);
  });

  it('returns a clear MCP tool error when search backend is not configured', async () => {
    const result = await runRemoteOracleSearch({}, { query: 'force push safety' });
    const payload = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(payload.error).toContain('ORACLE_HTTP_URL');
  });

  it('proxies oracle_search to the configured Oracle HTTP API', async () => {
    let seen: Request | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = new Request(input, init);
      return Response.json({ results: [{ id: 'doc-1', title: 'Nothing is deleted' }], total: 1 });
    }) as typeof fetch;

    const result = await runRemoteOracleSearch(
      { ORACLE_HTTP_URL: 'https://oracle.example/api', ORACLE_API_TOKEN: 'secret' },
      { query: 'nothing deleted', limit: 99, mode: 'hybrid', type: 'all' },
    );

    expect(seen).toBeDefined();
    const url = new URL(seen!.url);
    expect(url.origin + url.pathname).toBe('https://oracle.example/api/search');
    expect(url.searchParams.get('q')).toBe('nothing deleted');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(seen!.headers.get('authorization')).toBe('Bearer secret');

    const payload = JSON.parse(result.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.result.total).toBe(1);
  });
});
