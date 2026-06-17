import { describe, expect, test } from 'bun:test';
import { proxyRequestForTool } from '../../src/mcp/http-proxy.ts';
import { mcpRestMap, remoteableMcpRestMap } from '../../src/tools/mcp-rest-map.ts';

const sampleArgs: Record<string, unknown> = {
  query: 'needle',
  file: 'a.md',
  id: 'oracle-main',
  type: 'note',
  limit: 2,
  offset: false,
  message: 'hello',
  threadId: 'thread-1',
  status: 'open',
  traceId: 'trace-1',
  prevTraceId: 'trace-0',
  nextTraceId: 'trace-1',
  direction: 'forward',
};

describe('HTTP proxy MCP REST map', () => {
  test('builds a proxy request for every remoteable pure-map entry', () => {
    const requests = remoteableMcpRestMap.map((entry) => [entry.name, proxyRequestForTool(entry.name, sampleArgs)] as const);

    expect(requests).not.toContainEqual(expect.arrayContaining([expect.any(String), null]));
    expect(Object.fromEntries(requests)).toMatchObject({
      oracle_search: { method: 'GET', path: '/api/search', query: { q: 'needle' } },
      oracle_thread_update: { method: 'PATCH', path: '/api/thread/thread-1/status', body: { status: 'open' } },
      oracle_trace_distill: { method: 'POST', path: '/api/traces/trace-1/distill' },
    });
  });

  test('does not proxy local-only pure-map entries', () => {
    const localOnly = mcpRestMap.filter((entry) => !entry.remoteable).map((entry) => entry.name);

    expect(localOnly).toContain('oracle_mcp_call');
    for (const name of localOnly) expect(proxyRequestForTool(name, sampleArgs)).toBeNull();
  });
});
