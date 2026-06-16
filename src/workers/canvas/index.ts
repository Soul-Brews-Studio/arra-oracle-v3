import {
  CANVAS_HOST,
  DEFAULT_CANVAS_PLUGIN,
  canvasPluginEntry,
  canvasPluginMetadataRegistry,
  canvasRegistry,
  listCanvasPlugins,
  parseCanvasKind,
} from '@soul-brews/canvas-plugins';
import { normalizePlugin, renderCanvasApp } from './render.ts';

export interface CanvasWorkerEnv {
  ORACLE_API_BASE?: string;
}

const DEFAULT_API_BASE = 'https://studio.buildwithoracle.com';
const WORKER_MARKER_HEADERS = {
  'X-Oracle-Canvas-Worker': CANVAS_HOST,
};
const API_CACHE_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, content-type, x-api-key, x-correlation-id',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'x-oracle-canvas-worker',
  'Cache-Control': 'no-store',
  ...WORKER_MARKER_HEADERS,
};
const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  ...WORKER_MARKER_HEADERS,
  'X-Content-Type-Options': 'nosniff',
};
const HTML_HEADERS = {
  ...SECURITY_HEADERS,
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

const REGISTRY_HEADERS = {
  ...SECURITY_HEADERS,
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  'Content-Type': 'application/json; charset=utf-8',
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
  headers.set('x-oracle-canvas-worker', CANVAS_HOST);
  headers.delete('host');
  const upstream = await fetch(proxyTarget(request, env), {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
  });
  const responseHeaders = new Headers(upstream.headers);
  for (const [key, value] of Object.entries(API_CACHE_HEADERS)) responseHeaders.set(key, value);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}



function healthResponse(env: CanvasWorkerEnv): Response {
  return Response.json({
    ok: true,
    app: 'ui-canvas-oracle-studio',
    host: CANVAS_HOST,
    apiBase: apiBase(env),
    defaultPlugin: DEFAULT_CANVAS_PLUGIN,
    pluginCount: listCanvasPlugins().length,
  }, { headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' } });
}

function registryResponse(url: URL): Response | null {
  if (url.pathname === '/api/plugins' && url.searchParams.get('kind') === 'canvas') {
    return Response.json(canvasPluginMetadataRegistry(), { headers: REGISTRY_HEADERS });
  }
  if (url.pathname === '/api/canvas/plugins' || url.pathname === '/api/canvas/registry' || url.pathname === '/api/plugins/canvas') {
    return Response.json(canvasRegistry(parseCanvasKind(url.searchParams.get('kind'))), { headers: REGISTRY_HEADERS });
  }
  const match = url.pathname.match(/^\/api\/(?:canvas\/plugins|plugins\/canvas)\/([^/]+)$/);
  if (!match) return null;
  const entry = canvasPluginEntry(decodeURIComponent(match[1]));
  if (!entry) return Response.json({ error: 'canvas plugin not found', id: match[1] }, { status: 404, headers: REGISTRY_HEADERS });
  return Response.json(entry, { headers: REGISTRY_HEADERS });
}

function requestedPluginFrom(url: URL): string | null {
  const pathPlugin = url.pathname.length > 1 ? url.pathname.slice(1).split('/')[0] : null;
  return url.searchParams.get('plugin') ?? pathPlugin;
}

function pluginFrom(url: URL) {
  const requested = requestedPluginFrom(url);
  return { plugin: normalizePlugin(requested), requested };
}

export async function handleCanvasRequest(request: Request, env: CanvasWorkerEnv = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__health' || url.pathname === '/healthz') return healthResponse(env);
  if (request.method === 'GET') {
    const registry = registryResponse(url);
    if (registry) return registry;
  }
  if (url.pathname.startsWith('/api/') && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: API_CACHE_HEADERS });
  if (url.pathname.startsWith('/api/')) return proxyApi(request, env);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const selection = pluginFrom(url);
  const html = renderCanvasApp(selection.plugin, apiBase(env), selection.requested);
  return new Response(request.method === 'HEAD' ? null : html, { headers: HTML_HEADERS });
}

export default {
  fetch: handleCanvasRequest,
};
