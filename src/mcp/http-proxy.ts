import type { ToolResponse } from '../tools/types.ts';
import { currentTenantId } from '../middleware/tenant.ts';
import { mcpTenantHeaders, stripMcpTenantArgs, tenantIdFromMcpArgs } from './tenant.ts';
import { mcpRestMapByName, type RemoteableMcpRestEntry } from '../tools/mcp-rest-map.ts';

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
  return normalizeApiBase(trimmed);
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
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function normalizeApiBase(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '') || null;
  }
}

function queryFromMap(input: Record<string, unknown>, entry: RemoteableMcpRestEntry): Record<string, string> {
  const query: Record<string, string> = {};
  for (const binding of entry.query ?? []) {
    const value = cleanQueryValue(input[binding.arg]);
    if (value !== undefined) query[binding.param] = value;
  }
  for (const binding of entry.staticQuery ?? []) query[binding.param] = binding.value;
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

function bodyFromMap(entry: RemoteableMcpRestEntry, args: Record<string, unknown>): unknown {
  switch (entry.body) {
    case undefined: return undefined;
    case 'args': return args;
    case 'thread-message': {
      const body: Record<string, unknown> = { message: args.message, thread_id: args.threadId, title: args.title, role: args.role ?? 'claude', model: args.model };
      if (args.reopen !== undefined) body.reopen = args.reopen;
      return body;
    }
    case 'thread-status': return { status: args.status };
    case 'trace-link': return { nextId: args.nextTraceId };
    case 'trace-distill': {
      const { traceId: _traceId, ...body } = args;
      return body;
    }
  }
}

function pathForMap(entry: RemoteableMcpRestEntry, args: Record<string, unknown>): string | null {
  const template = entry.name === 'oracle_trace_get' && args.includeChain === true
    ? entry.pathVariants?.[0] ?? entry.path
    : entry.path;
  let path = template;
  for (const param of entry.pathParams ?? []) {
    const value = cleanQueryValue(args[param]);
    const required = path.includes(`:${param}`) && !path.includes(`:${param}?`);
    if (!value) {
      if (required) return null;
      path = path.replace(new RegExp(`/?:${param}\\?`), '');
      continue;
    }
    path = path.replace(`:${param}?`, encodeURIComponent(value)).replace(`:${param}`, encodeURIComponent(value));
  }
  return path || '/';
}

export function proxyRequestForTool(toolName: string, args: Record<string, unknown>): ProxyRequest | null {
  const entry = mcpRestMapByName.get(toolName);
  if (!entry?.remoteable) return null;
  const path = pathForMap(entry, args);
  return path ? { method: entry.method, path, query: queryFromMap(args, entry), body: bodyFromMap(entry, args) } : null;
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
