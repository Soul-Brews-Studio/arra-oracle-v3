import { resolveVectorUrl } from '../../config.ts';

const TIMEOUT_MS = 15_000;

type StatusSetter = { status?: number | string };

async function responseBody(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return { body: await res.text() };
}

export async function proxyVectorIndexer(
  path: 'start' | 'status' | 'stop' | 'models',
  set: StatusSetter,
  init: RequestInit = {},
): Promise<unknown | null> {
  const vectorUrl = resolveVectorUrl();
  if (!vectorUrl) return null;
  const url = `${vectorUrl.replace(/\/+$/, '')}/api/vector/index/${path}`;

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    set.status = res.status;
    return await responseBody(res);
  } catch (e) {
      set.status = 503;
    return {
      error: 'Vector proxy unavailable',
      proxy: vectorUrl,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
