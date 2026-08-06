import { describe, expect, test } from 'bun:test';
import { runArra } from '../index.ts';
import { runMcpCall } from '../mcp-client.ts';

describe('maw arra MCP-in client', () => {
  test('requires an explicit or configured MCP endpoint', async () => {
    const result = await runMcpCall(['remote_search'], {});

    expect(result).toEqual({ ok: false, error: 'MCP endpoint required: pass --url or set ARRA_MCP_URL' });
  });

  test('accepts the tool after flags', async () => {
    const fetcher = (async () => new Response(JSON.stringify({ result: { ok: true } }))) as typeof fetch;
    const result = await runMcpCall(['--url', 'http://mcp.test/rpc', 'remote_stats'], {}, fetcher);

    expect(result.ok).toBe(true);
  });

  test('posts JSON-RPC tools/call payloads and renders text results', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'found oracle' }] } }));
    }) as typeof fetch;

    const result = await runMcpCall(['remote_search', '--url', 'http://mcp.test/rpc', '--arg', 'q=oracle', '--arg', 'limit=3'], {}, fetcher);

    expect(result).toEqual({ ok: true, output: 'found oracle' });
    expect(calls).toEqual([{ url: 'http://mcp.test/rpc', body: { jsonrpc: '2.0', id: 'arra-maw-plugin', method: 'tools/call', params: { name: 'remote_search', arguments: { q: 'oracle', limit: '3' } } } }]);
  });

  test('dispatches mcp-call through the shared CLI command core', async () => {
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ result: { answer: 42 } }))) as typeof fetch;
    try {
      const result = await runArra(['mcp-call', 'remote_stats'], async () => ({}), () => {}, { ARRA_MCP_URL: 'http://mcp.test/rpc' });

      expect(result.ok).toBe(true);
      expect(result.output).toContain('42');
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});
