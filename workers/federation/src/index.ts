export type FederationEnv = {
  TUNNEL_URL?: string;
  FEDERATION_TOKEN?: string;
  federationToken?: string;
};

type RelayRoute = {
  methods: readonly string[];
  path: string;
};

const RELAY_ROUTES: RelayRoute[] = [
  { methods: ['POST'], path: '/api/send' },
  { methods: ['GET'], path: '/api/sessions' },
  { methods: ['GET'], path: '/api/federation/status' },
];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function trim(value: string | undefined): string {
  return value?.trim() ?? '';
}

function relayRoute(method: string, pathname: string): RelayRoute | null {
  const upper = method.toUpperCase();
  return RELAY_ROUTES.find((route) => route.path === pathname && route.methods.includes(upper)) ?? null;
}

export function resolveTunnelUrl(env: Pick<FederationEnv, 'TUNNEL_URL'>): string | null {
  const raw = trim(env.TUNNEL_URL);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function buildTunnelUrl(baseUrl: string, requestUrl: string): string {
  const incoming = new URL(requestUrl);
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, '');
  base.pathname = `${basePath}${incoming.pathname}`;
  base.search = incoming.search;
  return base.toString();
}

function tokenFrom(env: FederationEnv): string {
  return trim(env.FEDERATION_TOKEN) || trim(env.federationToken);
}

async function sha256Hex(body: string): Promise<string> {
  if (!body) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(token: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

export async function signFederationHeaders(token: string, method: string, path: string, body = '', timestamp = Math.floor(Date.now() / 1000)): Promise<Record<string, string>> {
  const bodyHash = await sha256Hex(body);
  const payload = bodyHash ? `${method}:${path}:${timestamp}:${bodyHash}` : `${method}:${path}:${timestamp}`;
  const headers: Record<string, string> = {
    'X-Maw-Timestamp': String(timestamp),
    'X-Maw-Signature': await hmacHex(token, payload),
  };
  if (bodyHash) headers['X-Maw-Auth-Version'] = 'v2';
  return headers;
}

function responseJson(payload: unknown, status: number): Response {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store', 'x-oracle-federation-proxy': 'cloudflare-workers' } });
}

function forwardedHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const key of HOP_BY_HOP) headers.delete(key);
  headers.set('accept', headers.get('accept') || 'application/json');
  headers.set('x-oracle-federation-proxy', 'cloudflare-workers');
  return headers;
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-oracle-federation-proxy', 'cloudflare-workers');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function proxyFederationRequest(request: Request, env: FederationEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const route = relayRoute(request.method, url.pathname);
  if (!route) return responseJson({ error: 'not found' }, 404);
  const tunnelUrl = resolveTunnelUrl(env);
  if (!tunnelUrl) return responseJson({ error: 'tunnel unavailable', message: 'Set TUNNEL_URL to the cloudflared HTTPS tunnel.' }, 502);

  const method = request.method.toUpperCase();
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.clone().text();
  const headers = forwardedHeaders(request);
  const token = tokenFrom(env);
  if (!token) return responseJson({ error: 'token unavailable', message: 'Set FEDERATION_TOKEN as a Worker secret.' }, 502);
  for (const [key, value] of Object.entries(await signFederationHeaders(token, method, url.pathname, body))) headers.set(key, value);

  return noStore(await fetcher(new Request(buildTunnelUrl(tunnelUrl, request.url), { method, headers, body, redirect: 'manual' })));
}

export async function handleFederationRequest(request: Request, env: FederationEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/__health') return responseJson({ ok: true, app: 'arra-oracle-federation-proxy', tunnelConfigured: Boolean(resolveTunnelUrl(env)) }, 200);
  return proxyFederationRequest(request, env, fetcher);
}

export default {
  fetch: handleFederationRequest,
};
