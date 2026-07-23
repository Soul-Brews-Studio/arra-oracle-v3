/**
 * Remote MCP transport — the modern Streamable HTTP transport (superseded
 * plain SSE) mounted at POST/GET/DELETE `/mcp`.
 *
 * This does NOT duplicate the ~20 tool handlers in src/index.ts. Each MCP
 * session gets a fresh `OracleMCPServer` (same class the stdio entrypoint
 * uses — src/index.ts's `run()` is untouched) wired to an SDK `Server`
 * instance via `getSdkServer()`, connected to a per-session
 * `WebStandardStreamableHTTPServerTransport` instead of `StdioServerTransport`.
 *
 * Auth: protected by the same bearer-token guard as /api/* — see
 * src/http/auth.ts (apiAuthGuard() path check includes '/mcp').
 *
 * Session model: stateful, per the SDK's documented pattern (see the SDK's
 * own examples/server/simpleStreamableHttp.js). The client's `initialize`
 * call (no Mcp-Session-Id header yet) spins up a new session; the server
 * hands back a session ID that the client must send as `Mcp-Session-Id` on
 * every subsequent POST/GET/DELETE. Sessions live in-memory for this
 * process's lifetime — fine for a single Railway instance, not for a
 * horizontally-scaled fleet (out of scope here).
 */
import { Elysia } from 'elysia';
import { randomUUID } from 'crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { OracleMCPServer } from '../index.ts';
import { loadToolGroupConfig } from '../config/tool-groups.ts';
import { REPO_ROOT, PORT } from '../config.ts';

// OracleMCPServer defaults to HTTP-client (proxy) mode via ORACLE_API, which
// avoids opening a second embedded sqlite/vector connection per MCP session
// (tool calls just fetch() back into this same process's /api/* routes).
// The hardcoded index.ts default (localhost:47778) only matches this
// process's actual PORT by coincidence in dev — pin it explicitly so a
// remapped ORACLE_PORT (e.g. on Railway) still proxies to the right place.
if (!process.env.ORACLE_API?.trim()) {
  process.env.ORACLE_API = `http://localhost:${PORT}`;
}

// Loaded once so every session's OracleMCPServer constructor skips its
// per-instance fs.watch(arra.config.json) hot-reload watcher (it's already
// documented to do so when `toolGroups` is passed explicitly) — otherwise
// every new remote session would leak a file watcher.
const sharedToolGroupConfig = loadToolGroupConfig(REPO_ROOT);

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

interface McpSession {
  oracle: OracleMCPServer;
  transport: WebStandardStreamableHTTPServerTransport;
}

const sessions = new Map<string, McpSession>();

async function createSession(): Promise<McpSession> {
  const oracle = new OracleMCPServer({ toolGroups: sharedToolGroupConfig });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { oracle, transport });
    },
  });
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && sessions.delete(sid)) {
      oracle.dispose().catch((e) => console.error('[mcp] dispose failed:', e));
    }
  };
  await oracle.getSdkServer().connect(transport);
  return { oracle, transport };
}

async function handleMcpPost(request: Request): Promise<Response> {
  const sessionId = request.headers.get('mcp-session-id');
  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return jsonRpcError(404, -32001, 'Session not found');
    return session.transport.handleRequest(request);
  }

  const parsedBody = await request.json().catch(() => null);
  if (!isInitializeRequest(parsedBody)) {
    return jsonRpcError(400, -32000, 'Bad Request: No valid session ID provided');
  }
  const session = await createSession();
  return session.transport.handleRequest(request, { parsedBody });
}

function handleSessionRequest(request: Request): Promise<Response> | Response {
  const sessionId = request.headers.get('mcp-session-id');
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    return new Response('Invalid or missing Mcp-Session-Id header', { status: 400 });
  }
  return session.transport.handleRequest(request);
}

/** Mounted in src/server.ts; runs behind apiAuthGuard() (Bearer token). */
export function mcpRoutes() {
  return new Elysia()
    .post('/mcp', ({ request }) => handleMcpPost(request))
    .get('/mcp', ({ request }) => handleSessionRequest(request))
    .delete('/mcp', ({ request }) => handleSessionRequest(request));
}
