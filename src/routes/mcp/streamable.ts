import { Elysia } from 'elysia';
import { WebStandardStreamableHTTPServerTransport, type WebStandardStreamableHTTPServerTransportOptions } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { HttpOracleMcpServerOptions } from '../../mcp/http-server.ts';
import { OracleMCPServer } from '../../mcp/server.ts';
import { createHttpOracleMcpServer } from '../../mcp/http-server.ts';
import { requireMcpBearerAuth } from '../../mcp/http-auth.ts';
import { loadToolGroupConfig } from '../../config/tool-groups-core.ts';

type Session = { transport: WebStandardStreamableHTTPServerTransport; oracle: OracleMCPServer };
export type McpStreamableRoutesOptions =
  Pick<WebStandardStreamableHTTPServerTransportOptions, 'enableJsonResponse'> & HttpOracleMcpServerOptions;

export function createMcpStreamableRoutes(options: McpStreamableRoutesOptions = {}) {
  const manager = new McpHttpSessionManager(options);
  return new Elysia({ name: 'mcp-streamable-http' }).all('/mcp', ({ request, set }) => {
    if (!isMcpStreamableEnabled(options)) {
      set.status = 404;
      return { error: 'Not Found' };
    }
    return manager.handle(request);
  }, {
    detail: { tags: ['mcp'], menu: { group: 'hidden' }, summary: 'Streamable HTTP MCP endpoint' },
  });
}

function isMcpStreamableEnabled(options: McpStreamableRoutesOptions): boolean {
  const repoRoot = options.env?.ORACLE_REPO_ROOT;
  return loadToolGroupConfig(repoRoot).mcp !== false;
}

class McpHttpSessionManager {
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly options: McpStreamableRoutesOptions) {}

  async handle(request: Request): Promise<Response> {
    const auth = await requireMcpBearerAuth(request, this.options.env);
    if (!auth.ok) return auth.response;
    const sessionId = request.headers.get('mcp-session-id') ?? undefined;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session) return session.transport.handleRequest(request, { authInfo: auth.authInfo });
    if (sessionId) return jsonRpcError(404, -32001, 'Session not found');
    if (request.method !== 'POST') return jsonRpcError(400, -32000, 'Bad Request: No valid session ID provided');
    const parsed = await parseJsonRpcBody(request);
    if (!parsed.ok) return parsed.response;
    if (!containsInitializeRequest(parsed.body)) return jsonRpcError(400, -32000, 'Bad Request: No valid session ID provided');
    return this.initialize(request, auth.authInfo, parsed.body);
  }

  private async initialize(request: Request, authInfo: AuthInfo, parsedBody: unknown): Promise<Response> {
    let session: Session | undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: this.options.enableJsonResponse,
      onsessioninitialized: (sessionId) => { if (session) this.sessions.set(sessionId, session); },
      onsessionclosed: (sessionId) => this.releaseSession(sessionId, false),
    });
    const oracle = this.createOracleServer();
    session = { transport, oracle };
    transport.onclose = () => { if (transport.sessionId) void this.releaseSession(transport.sessionId, false); };
    try {
      await oracle.connect(transport);
      return await transport.handleRequest(request, { authInfo, parsedBody });
    } catch (error) {
      if (transport.sessionId) await this.releaseSession(transport.sessionId, true);
      else {
        await oracle.cleanup();
        await transport.close().catch(() => {});
      }
      console.error('[MCP HTTP Error]', error);
      return jsonRpcError(500, -32603, 'Internal server error');
    }
  }

  private createOracleServer(): OracleMCPServer {
    return createHttpOracleMcpServer(this.options);
  }

  private async releaseSession(sessionId: string, closeTransport: boolean): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (closeTransport) await session.transport.close().catch(() => {});
    await session.oracle.cleanup();
  }
}

async function parseJsonRpcBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try { return { ok: true, body: await request.clone().json() }; }
  catch { return { ok: false, response: jsonRpcError(400, -32700, 'Parse error: Invalid JSON') }; }
}

function containsInitializeRequest(body: unknown): boolean {
  return Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body);
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status });
}
