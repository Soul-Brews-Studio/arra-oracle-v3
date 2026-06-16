import type { ToolResponse } from '../tools/types.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { mcpTenantHeaders, stripMcpTenantArgs, tenantIdFromMcpArgs } from './tenant.ts';

const EMBEDDED_API_VALUES = new Set(['embedded', 'embed', 'off', 'none', 'false', '0']);

type ProxyRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

class OracleApiUnavailableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(
      `Cannot reach ARRA Oracle at ${baseUrl}\n` +
      `  → Is the server running? Try: bun run server  (in arra-oracle-v3 repo)\n` +
      `  → Set ORACLE_HTTP_URL=http://localhost:<port> for HTTP-proxy mode\n` +
      `  → Or unset ORACLE_HTTP_URL to use direct embedded mode\n` +
      `  Original: ${msg}`,
    );
    this.name = 'OracleApiUnavailableError';
  }
}

export function resolveOracleApiBase(): string | null {
  const trimmed = configuredApiBase();
  if (!trimmed || EMBEDDED_API_VALUES.has(trimmed.toLowerCase())) return null;
  return trimmed.replace(/\/+$/, '');
}

function configuredApiBase(): string | null {
  for (const raw of [process.env.ORACLE_HTTP_URL, process.env.ORACLE_API, process.env.NEO_ARRA_API]) {
    const trimmed = raw?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function cleanQueryValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function queryFrom(input: Record<string, unknown>, fields: Record<string, string>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [sourceKey, targetKey] of Object.entries(fields)) {
    const value = cleanQueryValue(input[sourceKey]);
    if (value !== undefined) query[targetKey] = value;
  }
  return query;
}

function appendQuery(pathname: string, query?: Record<string, unknown>): string {
  if (!query || Object.keys(query).length === 0) return pathname;
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const value = cleanQueryValue(raw);
    if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function proxyRequestForTool(toolName: string, args: Record<string, unknown>): ProxyRequest | null {
  switch (toolName) {
    case 'oracle_search':
      return { method: 'GET', path: '/api/search', query: { q: args.query, ...queryFrom(args, { type: 'type', limit: 'limit', offset: 'offset', mode: 'mode', project: 'project', cwd: 'cwd', model: 'model' }) } };
    case 'oracle_learn': return { method: 'POST', path: '/api/learn', body: args };
    case 'oracle_verify': return { method: 'POST', path: '/api/verify', body: args };
    case 'oracle_stats': return { method: 'GET', path: '/api/stats' };
    case 'oracle_read': return { method: 'GET', path: '/api/read', query: queryFrom(args, { file: 'file', id: 'id' }) };
    case 'oracle_list': return { method: 'GET', path: '/api/list', query: { ...queryFrom(args, { type: 'type', limit: 'limit', offset: 'offset' }), group: 'false' } };
    case 'oracle_concepts': return { method: 'GET', path: '/api/concepts', query: queryFrom(args, { type: 'type', limit: 'limit' }) };
    case 'oracle_supersede': return { method: 'POST', path: '/api/supersede/document', body: args };
    case 'oracle_profile': {
      const id = cleanQueryValue(args.id);
      return { method: 'GET', path: id ? `/api/oracles/profiles/${encodeURIComponent(id)}` : '/api/oracles/profiles' };
    }
    case 'oracle_inbox': return { method: 'GET', path: '/api/inbox', query: queryFrom(args, { limit: 'limit', offset: 'offset', type: 'type' }) };
    case 'oracle_handoff': return { method: 'POST', path: '/api/handoff', body: args };
    case 'oracle_thread': return { method: 'POST', path: '/api/thread', body: { message: args.message, thread_id: args.threadId, title: args.title, role: args.role ?? 'claude', model: args.model } };
    case 'oracle_threads': return { method: 'GET', path: '/api/threads', query: queryFrom(args, { status: 'status', limit: 'limit', offset: 'offset' }) };
    case 'oracle_thread_read': {
      const threadId = cleanQueryValue(args.threadId);
      return threadId ? { method: 'GET', path: `/api/thread/${encodeURIComponent(threadId)}` } : null;
    }
    case 'oracle_thread_update': {
      const threadId = cleanQueryValue(args.threadId);
      return threadId ? { method: 'PATCH', path: `/api/thread/${encodeURIComponent(threadId)}/status`, body: { status: args.status } } : null;
    }
    case 'oracle_trace': return { method: 'POST', path: '/api/traces', body: args };
    case 'oracle_trace_distill': {
      const traceId = cleanQueryValue(args.traceId);
      if (!traceId) return null;
      const { traceId: _traceId, ...body } = args;
      return { method: 'POST', path: `/api/traces/${encodeURIComponent(traceId)}/distill`, body };
    }
    case 'oracle_trace_list': return { method: 'GET', path: '/api/traces', query: queryFrom(args, { query: 'query', status: 'status', project: 'project', limit: 'limit', offset: 'offset' }) };
    case 'oracle_trace_get': {
      const traceId = cleanQueryValue(args.traceId);
      if (!traceId) return null;
      return args.includeChain === true ? { method: 'GET', path: `/api/traces/${encodeURIComponent(traceId)}/chain` } : { method: 'GET', path: `/api/traces/${encodeURIComponent(traceId)}` };
    }
    case 'oracle_trace_link': {
      const prevTraceId = cleanQueryValue(args.prevTraceId);
      return prevTraceId ? { method: 'POST', path: `/api/traces/${encodeURIComponent(prevTraceId)}/link`, body: { nextId: args.nextTraceId } } : null;
    }
    case 'oracle_trace_unlink': {
      const traceId = cleanQueryValue(args.traceId);
      return traceId ? { method: 'DELETE', path: `/api/traces/${encodeURIComponent(traceId)}/link`, query: { direction: args.direction } } : null;
    }
    case 'oracle_trace_chain': {
      const traceId = cleanQueryValue(args.traceId);
      return traceId ? { method: 'GET', path: `/api/traces/${encodeURIComponent(traceId)}/linked-chain` } : null;
    }
    case 'oracle_reflect': return { method: 'GET', path: '/api/reflect' };
    default: return null;
  }
}

async function oracleApiFetch(baseUrl: string, apiPath: string, opts?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${baseUrl}${apiPath}`, opts);
  } catch (err) {
    throw new OracleApiUnavailableError(baseUrl, err);
  }
}

async function readHttpPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function toToolResponse(payload: unknown, isError = false): ToolResponse {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function proxyHeaders(hasBody: boolean, tenantId?: string): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...mcpTenantHeaders(tenantId ?? currentTenantId()) };
  if (hasBody) headers['content-type'] = 'application/json';
  const token = process.env.ARRA_API_TOKEN?.trim() || process.env.ARRA_API_KEY?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return Object.keys(headers).length ? headers : undefined;
}

export async function proxyToolCall(baseUrl: string | null, toolName: string, args: Record<string, unknown>, tenantId = tenantIdFromMcpArgs(args)): Promise<ToolResponse | null> {
  if (!baseUrl) return null;
  const cleanArgs = stripMcpTenantArgs(args);
  const proxyRequest = proxyRequestForTool(toolName, cleanArgs);
  if (!proxyRequest) return null;
  try {
    const response = await oracleApiFetch(baseUrl, appendQuery(proxyRequest.path, proxyRequest.query), {
      method: proxyRequest.method,
      headers: proxyHeaders(proxyRequest.body !== undefined, tenantId),
      body: proxyRequest.body === undefined ? undefined : JSON.stringify(proxyRequest.body),
    });
    return toToolResponse(await readHttpPayload(response), !response.ok);
  } catch (err) {
    if (err instanceof OracleApiUnavailableError) return toToolResponse(err.message, true);
    throw err;
  }
}
