import { resolveVectorUrl } from '../../config.ts';
import { resolveVectorProxyContract } from '../../vector/proxy-contract.ts';

export type VectorServerHealth = {
  configured: boolean;
  status: 'ok' | 'down' | 'unconfigured';
  url?: string;
  httpStatus?: number;
  protocol?: string;
  name?: string;
  version?: string;
  error?: string;
};

type Fetcher = typeof fetch;

export async function readVectorServerHealth(
  fetcher: Fetcher = fetch,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv,
): Promise<VectorServerHealth> {
  const baseUrl = normalizeBase(resolveVectorUrl(env, argv))
    ?? resolveVectorProxyContract({ env })?.baseUrl;
  if (!baseUrl) return { configured: false, status: 'unconfigured' };

  const health = await fetchHealth(fetcher, baseUrl, '/health')
    ?? await fetchHealth(fetcher, baseUrl, '/');
  if (!health) return { configured: true, status: 'down', url: baseUrl, error: 'unreachable' };

  const ok = health.httpStatus >= 200 && health.httpStatus < 300 && bodyOk(health.body);
  return {
    configured: true,
    status: ok ? 'ok' : 'down',
    url: baseUrl,
    httpStatus: health.httpStatus,
    ...bodySummary(health.body),
    ...(ok ? {} : { error: health.error ?? statusText(health.body) }),
  };
}

async function fetchHealth(fetcher: Fetcher, baseUrl: string, path: string) {
  try {
    const response = await fetcher(new URL(path, `${baseUrl}/`), {
      signal: AbortSignal.timeout(Number(process.env.ORACLE_VECTOR_SERVER_HEALTH_TIMEOUT_MS ?? 1000)),
    });
    const body = await readBody(response);
    return { httpStatus: response.status, body };
  } catch (error) {
    return { httpStatus: 0, body: undefined, error: error instanceof Error ? error.message : String(error) };
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

function normalizeBase(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch { return undefined; }
}

function bodyOk(body: unknown): boolean {
  if (!body || typeof body !== 'object') return true;
  const status = String((body as { status?: unknown }).status ?? '').toLowerCase();
  return !status || status === 'ok' || status === 'up';
}

function bodySummary(body: unknown) {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  return {
    ...(typeof record.protocol === 'string' && { protocol: record.protocol }),
    ...(typeof record.name === 'string' && { name: record.name }),
    ...(typeof record.server === 'string' && { name: record.server }),
    ...(typeof record.version === 'string' && { version: record.version }),
  };
}

function statusText(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const status = (body as { status?: unknown }).status;
  return status ? `vector server status: ${String(status)}` : undefined;
}
