export interface OracleMcpEnv {
  ORACLE_HTTP_URL?: string;
  ORACLE_API_BASE?: string;
  ORACLE_API_TOKEN?: string;
  ARRA_API_TOKEN?: string;
  ORACLE_REMOTE_MCP_NAME?: string;
}

export interface McpTextResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

type SearchArgs = Record<string, unknown>;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
};

const SEARCH_MODES = new Set(['hybrid', 'fts', 'vector']);
const SEARCH_TYPES = new Set(['principle', 'pattern', 'learning', 'retro', 'all']);
const SEARCH_MODELS = new Set(['nomic', 'qwen3', 'bge-m3']);

export function resolveBackendBase(env: OracleMcpEnv): string | null {
  const raw = (env.ORACLE_HTTP_URL ?? env.ORACLE_API_BASE ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function oracleApiUrl(base: string, apiPath: string): URL {
  const url = new URL(base);
  const cleanBase = url.pathname.replace(/\/+$/, '');
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const suffix = cleanBase.endsWith('/api') && cleanPath.startsWith('/api/')
    ? cleanPath.slice('/api'.length)
    : cleanPath;
  url.pathname = `${cleanBase}${suffix}`.replace(/\/+/g, '/');
  return url;
}

export function jsonToolResult(payload: unknown, isError = false): McpTextResult {
  const result: McpTextResult = {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numberValue)));
}

function enumArg(value: unknown, allowed: Set<string>, fallback?: string): string | undefined {
  const candidate = stringArg(value);
  return candidate && allowed.has(candidate) ? candidate : fallback;
}

function authHeader(env: OracleMcpEnv): string | null {
  const token = stringArg(env.ORACLE_API_TOKEN) ?? stringArg(env.ARRA_API_TOKEN);
  if (!token) return null;
  return token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
}

async function responsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return { text: text.slice(0, 10_000) };
}

export function remoteMcpStatus(env: OracleMcpEnv) {
  const backend = resolveBackendBase(env);
  return {
    ok: true,
    service: env.ORACLE_REMOTE_MCP_NAME || 'Arra Oracle Remote MCP',
    tools: ['oracle_health', 'oracle_search', 'muninn_search'],
    transports: { streamableHttp: '/mcp', sse: '/sse' },
    backend: {
      configured: Boolean(backend),
      url: backend,
      strategy: backend ? 'HTTP proxy to an Arra Oracle API' : 'set ORACLE_HTTP_URL',
    },
    workersNotes: {
      localSqlite: 'Bun/SQLite/FTS local database is not available in Workers',
      nextStorage: ['Cloudflare D1 for metadata/FTS', 'Vectorize for embeddings'],
    },
  };
}

export function runRemoteOracleHealth(env: OracleMcpEnv): McpTextResult {
  return jsonToolResult(remoteMcpStatus(env));
}

export async function runRemoteOracleSearch(env: OracleMcpEnv, args: SearchArgs): Promise<McpTextResult> {
  const query = stringArg(args.query);
  if (!query) {
    return jsonToolResult({ success: false, error: 'oracle_search requires a non-empty query' }, true);
  }

  const base = resolveBackendBase(env);
  if (!base) {
    return jsonToolResult({
      success: false,
      error: 'ORACLE_HTTP_URL is not configured for this Cloudflare Worker',
      query,
      next: 'Set ORACLE_HTTP_URL to an Arra Oracle HTTP API, then redeploy or update Worker variables.',
    }, true);
  }

  const url = oracleApiUrl(base, '/api/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', enumArg(args.type, SEARCH_TYPES, 'all') ?? 'all');
  url.searchParams.set('limit', String(boundedInt(args.limit, 5, 1, 50)));
  url.searchParams.set('offset', String(boundedInt(args.offset, 0, 0, 10_000)));
  const mode = enumArg(args.mode, SEARCH_MODES);
  const project = stringArg(args.project);
  const cwd = stringArg(args.cwd);
  const model = enumArg(args.model, SEARCH_MODELS);
  if (mode) url.searchParams.set('mode', mode);
  if (project) url.searchParams.set('project', project);
  if (cwd) url.searchParams.set('cwd', cwd);
  if (model) url.searchParams.set('model', model);

  const headers = new Headers({ accept: 'application/json' });
  const authorization = authHeader(env);
  if (authorization) headers.set('authorization', authorization);

  try {
    const response = await fetch(url, { headers });
    const payload = await responsePayload(response);
    return jsonToolResult({
      success: response.ok,
      query,
      upstream: { status: response.status, url: `${base}/api/search` },
      result: payload,
    }, !response.ok);
  } catch (error) {
    return jsonToolResult({
      success: false,
      query,
      error: 'Oracle backend request failed',
      message: error instanceof Error ? error.message : String(error),
    }, true);
  }
}

export function healthResponse(env: OracleMcpEnv): Response {
  return new Response(JSON.stringify(remoteMcpStatus(env), null, 2), { headers: JSON_HEADERS });
}

export function landingResponse(request: Request, env: OracleMcpEnv): Response {
  const origin = new URL(request.url).origin;
  const status = remoteMcpStatus(env);
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${status.service}</title></head>
<body><main><h1>${status.service}</h1><p>Remote MCP is available at <code>${origin}/mcp</code>.</p>
<ul><li><code>GET /health</code> checks Worker and backend configuration.</li>
<li><code>/mcp</code> uses Streamable HTTP; <code>/sse</code> is available for legacy clients.</li>
<li>Configure <code>ORACLE_HTTP_URL</code> to proxy <code>oracle_search</code> to a full Oracle API.</li></ul>
<p><a href="https://github.com/Soul-Brews-Studio/arra-oracle-v3/blob/alpha/docs/deploy-cloudflare-mcp.md">Deployment docs</a></p></main></body></html>`;
  return new Response(body, { headers: HTML_HEADERS });
}
