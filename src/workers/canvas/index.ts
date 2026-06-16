import { normalizePlugin, renderCanvasApp } from './render.ts';

export interface CanvasWorkerEnv {
  ORACLE_API_BASE?: string;
}

const DEFAULT_API_BASE = 'https://studio.buildwithoracle.com';
const API_CACHE_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, x-correlation-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

function apiBase(env: CanvasWorkerEnv): string {
  return (env.ORACLE_API_BASE || DEFAULT_API_BASE).replace(/\/$/, '');
}

function proxyTarget(request: Request, env: CanvasWorkerEnv): URL {
  const source = new URL(request.url);
  const target = new URL(source.pathname + source.search, apiBase(env));
  return target;
}

async function proxyApi(request: Request, env: CanvasWorkerEnv): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set('x-oracle-canvas-worker', 'canvas.buildwithoracle.com');
  headers.delete('host');
  const upstream = await fetch(proxyTarget(request, env), { ...request, headers });
  const responseHeaders = new Headers(upstream.headers);
  for (const [key, value] of Object.entries(API_CACHE_HEADERS)) responseHeaders.set(key, value);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

function pluginFrom(url: URL) {
  const pathPlugin = url.pathname === '/map' || url.pathname === '/planets' ? url.pathname.slice(1) : null;
  return normalizePlugin(url.searchParams.get('plugin') ?? pathPlugin);
}

export async function handleCanvasRequest(request: Request, env: CanvasWorkerEnv = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: API_CACHE_HEADERS });
  if (url.pathname.startsWith('/api/')) return proxyApi(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const html = renderCanvasApp(pluginFrom(url), apiBase(env));
  return new Response(request.method === 'HEAD' ? null : html, { headers: HTML_HEADERS });
}

export default {
  fetch: handleCanvasRequest,
};
