import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

async function gate(broken: 'none' | 'docs' | 'mcp') {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/health') return Response.json({ plugins: { items: [{ name: 'arra' }, { name: 'oracle-dig' }] } });
    if (path === '/health') return Response.json({ ok: true });
    if (request.headers.get('authorization') !== 'Bearer gate-fixture') return new Response('', { status: 401 });
    if (path === '/api/docs/json') return Response.json(broken === 'docs'
      ? { success: false, error: 'api_key_auth_required', paths: {} }
      : { openapi: '3.0.3', paths: { '/api/search': { get: {} } } });
    if (path === '/mcp') return Response.json(broken === 'mcp'
      ? { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid params' } }
      : { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '1' } } });
    return Response.json({ results: [] });
  } });
  try {
    const url = `http://127.0.0.1:${server.port}`;
    const process = Bun.spawn(['bash', resolve('deploy/private/arra-full-stack/health-gate.sh')], {
      env: { ...Bun.env, ARRA_BASE_URL: url, ARRA_LLM_ADAPTER_URL: url, ARRA_API_TOKEN: 'gate-fixture', ORACLE_MCP_HTTP_TOKEN: 'gate-fixture' },
      stdout: 'pipe', stderr: 'pipe',
    });
    return await process.exited;
  } finally { server.stop(true); }
}

test('health gate accepts valid authenticated API and MCP responses', async () => { expect(await gate('none')).toBe(0); });
test('health gate rejects authorization errors disguised as successful OpenAPI responses', async () => { expect(await gate('docs')).not.toBe(0); });
test('health gate rejects HTTP-success MCP error responses', async () => { expect(await gate('mcp')).not.toBe(0); });
