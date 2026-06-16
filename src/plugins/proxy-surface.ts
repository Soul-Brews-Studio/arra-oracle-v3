import { Elysia } from 'elysia';
import type { UnifiedProxyManifest } from './unified-manifest.ts';
import { cloneRetryableBody, retryableRequestBody, retryUpstreamRequest } from '../middleware/retry.ts';

const DEFAULT_TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_PROXY_TIMEOUT_MS ?? 15_000);
type ElysiaApp = Elysia<any, any, any, any, any, any, any>;

export function createUnifiedProxyRoute(plugin: string, proxy: UnifiedProxyManifest): ElysiaApp {
  const app = new Elysia({ name: `unified:${plugin}:proxy:${proxy.path}` });
  (app as any).route('ALL', `${normalize(proxy.path)}*`, ({ request }: any) =>
    proxyRequestForManifest(request, [proxy]));
  return app;
}

export async function proxyRequestForManifest(
  request: Request,
  manifests: UnifiedProxyManifest[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const manifest = manifests.find((item) => pathMatches(url.pathname, item.path));
  if (!manifest) return undefined;

  const allowed = manifest.methods?.map((method) => method.toUpperCase());
  if (allowed?.length && !allowed.includes('ALL') && !allowed.includes(request.method.toUpperCase())) {
    return json({ ok: false, error: 'method not allowed' }, 405, { allow: allowed.join(', ') });
  }

  const targetBase = targetBaseFrom(env[manifest.targetEnv]);
  if (targetBase === null) {
    return json({ ok: false, error: `${manifest.targetEnv} is unset`, targetEnv: manifest.targetEnv }, 502);
  }
  if (targetBase === undefined) return json({ ok: false, error: `${manifest.targetEnv} must be an http(s) URL`, targetEnv: manifest.targetEnv }, 502);

  const targetPath = manifest.stripPrefix
    ? (url.pathname.slice(normalize(manifest.path).length) || '/')
    : url.pathname;
  return forward(request, `${targetBase}${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}${url.search}`);
}

function targetBaseFrom(raw: string | undefined): string | null | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function pathMatches(pathname: string, manifestPath: string): boolean {
  const base = normalize(manifestPath);
  return pathname === base || pathname.startsWith(`${base}/`);
}

function normalize(pathname: string): string {
  const rooted = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return rooted.length > 1 ? rooted.replace(/\/+$/, '') : rooted;
}

async function forward(request: Request, target: string): Promise<Response> {
  try {
    const headers = new Headers(request.headers);
    headers.delete('host');
    const body = await retryableRequestBody(request);
    const res = await retryUpstreamRequest(() => fetch(target, {
      method: request.method,
      headers: new Headers(headers),
      body: cloneRetryableBody(body),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      duplex: 'half',
    }));
    const responseHeaders = new Headers(res.headers);
    responseHeaders.set('x-unified-proxy-target', new URL(target).origin);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: responseHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = /timeout|aborted/i.test(message);
    return json({ ok: false, error: timeout ? 'gateway timeout' : message }, timeout ? 504 : 502);
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}
