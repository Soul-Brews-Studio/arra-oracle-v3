import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export type VectorPreflight = {
  configured: boolean;
  ok: boolean;
  line?: string;
  error?: string;
};

export async function probeVectorPreflight(env: Env, fetcher: Fetcher = fetch): Promise<VectorPreflight> {
  const resolved = resolveVectorEndpoint(env);
  if (resolved.error) return { configured: true, ok: false, error: resolved.error };
  if (!resolved.url) return { configured: false, ok: true };

  const health = await fetchVectorHealth(fetcher, resolved.url);
  if (!health.ok) {
    return {
      configured: true,
      ok: false,
      error: `vector preflight failed for ${resolved.url}: ${health.error}`,
    };
  }
  return { configured: true, ok: true, line: `vector preflight: ok ${resolved.url}` };
}

function resolveVectorEndpoint(env: Env): { url?: string; error?: string } {
  const direct = first(env.VECTOR_URL, env.ORACLE_PROXY_VECTOR_URL, env.VECTOR_DB_URL);
  if (direct) return normalizeUrl(direct, 'VECTOR_URL');
  return readVectorConfig(env);
}

function readVectorConfig(env: Env): { url?: string; error?: string } {
  const path = join(dataDir(env), 'vector-server.json');
  if (!existsSync(path)) return {};
  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as { vectorProxyUrl?: unknown; vectorUrl?: unknown };
    const url = typeof config.vectorProxyUrl === 'string' ? config.vectorProxyUrl : typeof config.vectorUrl === 'string' ? config.vectorUrl : '';
    return url.trim() ? normalizeUrl(url, 'vector-server.json vectorProxyUrl') : {};
  } catch (error) {
    return { error: `cannot read vector-server.json: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function fetchVectorHealth(fetcher: Fetcher, base: string): Promise<{ ok: boolean; error: string }> {
  for (const path of ['/health', '/']) {
    try {
      const res = await fetcher(new URL(path, `${base}/`), { signal: AbortSignal.timeout(1000) });
      const text = await res.text().catch(() => '');
      const body = text ? parseJson(text) : undefined;
      if (res.ok && bodyStatusOk(body)) return { ok: true, error: '' };
      if (res.status > 0) return { ok: false, error: `HTTP ${res.status}${statusText(body)}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { ok: false, error: 'unreachable' };
}

function normalizeUrl(value: string, label: string): { url?: string; error?: string } {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http(s)');
    url.search = '';
    url.hash = '';
    return { url: url.toString().replace(/\/+$/, '') };
  } catch {
    return { error: `${label} must be a valid http(s) URL` };
  }
}

const first = (...values: Array<string | undefined>) => values.map(v => v?.trim() ?? '').find(Boolean);
const dataDir = (env: Env) => env.ORACLE_DATA_DIR?.trim() || join(env.HOME || env.USERPROFILE || homedir(), '.arra-oracle-v2');
const parseJson = (text: string): unknown => { try { return JSON.parse(text); } catch { return text; } };
const bodyStatusOk = (body: unknown): boolean => !body || typeof body !== 'object' || !('status' in body) || ['ok', 'up'].includes(String((body as { status?: unknown }).status).toLowerCase());
const statusText = (body: unknown): string => body && typeof body === 'object' && 'status' in body ? ` status=${String((body as { status?: unknown }).status)}` : '';
