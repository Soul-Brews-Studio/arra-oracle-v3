import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

export type OracleProxyEnv = Record<string, string | undefined> & {
  ORACLE_URL?: string;
  ORACLE_HTTP_URL?: string;
  ORACLE_API?: string;
}

const PROXY_HEADER = 'oracle-studio-vercel';
const API_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
]);

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if ((req.method ?? 'GET').toUpperCase() === 'OPTIONS') {
    writePreflight(res);
    return;
  }

  try {
    const target = buildProxyTarget(resolveOracleUrl(), req.url ?? '/');
    const upstream = await fetch(target, {
      method: req.method ?? 'GET',
      headers: proxyRequestHeaders(req.headers),
      body: hasRequestBody(req.method) ? await readBody(req) : undefined,
      redirect: 'manual',
    });

    res.statusCode = upstream.status;
    res.statusMessage = upstream.statusText;
    copyResponseHeaders(upstream.headers, res);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-oracle-studio-vercel', PROXY_HEADER);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    writeJson(res, 502, { error: 'api proxy failed', message: message(error) });
  }
}

export function resolveOracleUrl(env: OracleProxyEnv = process.env): string {
  const raw = env.ORACLE_URL ?? env.ORACLE_HTTP_URL ?? env.ORACLE_API;
  const value = raw?.trim();
  if (!value) throw new Error('Set ORACLE_URL to the Oracle backend.');

  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ORACLE_URL must be http(s).');
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}

export function buildProxyTarget(baseUrl: string, requestUrl: string): string {
  const incoming = new URL(requestUrl, 'https://vercel.local');
  const rewrittenPath = incoming.searchParams.get('path');
  incoming.searchParams.delete('path');

  const apiPath = rewrittenPath === null ? stripProxyPrefix(incoming.pathname) : cleanPath(rewrittenPath);
  const target = new URL(`${baseUrl}/api${apiPath ? `/${apiPath}` : ''}`);
  target.search = incoming.searchParams.toString();
  return target.toString();
}

export function proxyRequestHeaders(source: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  headers.set('x-oracle-studio-vercel', PROXY_HEADER);
  return headers;
}

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function stripProxyPrefix(pathname: string): string {
  return cleanPath(pathname.replace(/^\/api(?:\/proxy)?\/?/, ''));
}

function cleanPath(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}

function hasRequestBody(method = 'GET'): boolean {
  return !['GET', 'HEAD'].includes(method.toUpperCase());
}

function copyResponseHeaders(headers: Headers, res: ServerResponse): void {
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) res.setHeader(key, value);
  });
}

function writePreflight(res: ServerResponse): void {
  res.statusCode = 204;
  res.setHeader('allow', API_METHODS);
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', API_METHODS);
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-oracle-tenant, x-tenant-id');
  res.setHeader('access-control-expose-headers', 'x-oracle-studio-vercel');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-oracle-studio-vercel', PROXY_HEADER);
  res.end();
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-oracle-studio-vercel', PROXY_HEADER);
  res.end(JSON.stringify(payload));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
