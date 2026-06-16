export interface OracleMcpWorkerEnv {
  ORACLE_MCP_PATH?: string;
  ORACLE_STORAGE_BACKEND?: string;
  ORACLE_VECTOR_BACKEND?: string;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Oracle-Worker': 'arra-oracle-remote-mcp',
};

function mcpPath(env: OracleMcpWorkerEnv): string {
  const raw = env.ORACLE_MCP_PATH?.trim() || '/mcp';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function health(env: OracleMcpWorkerEnv): Response {
  return json({
    ok: true,
    app: 'arra-oracle-remote-mcp',
    mcpPath: mcpPath(env),
    storage: env.ORACLE_STORAGE_BACKEND || 'd1',
    vector: env.ORACLE_VECTOR_BACKEND || 'cloudflare-vectorize',
  });
}

async function mcp(request: Request, env: OracleMcpWorkerEnv): Promise<Response> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return json({
      ok: true,
      transport: 'streamable-http',
      path: mcpPath(env),
      capabilities: { tools: {} },
    });
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const payload = await request.json().catch(() => null) as { id?: unknown; method?: string } | null;
  if (payload?.method === 'initialize') {
    return json({
      jsonrpc: '2.0',
      id: payload.id ?? null,
      result: {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'arra-oracle-remote-mcp', version: '0.1.0' },
        capabilities: { tools: {} },
      },
    });
  }
  return json({ jsonrpc: '2.0', id: payload?.id ?? null, error: { code: -32601, message: 'Method not found' } }, 404);
}

export async function handleOracleMcpRequest(request: Request, env: OracleMcpWorkerEnv = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/health' || url.pathname === '/__health') return health(env);
  if (url.pathname === mcpPath(env)) return mcp(request, env);
  return json({ error: 'not found' }, 404);
}

export default {
  fetch: handleOracleMcpRequest,
};
