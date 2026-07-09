import type { MenuItem } from '../routes/menu/model.ts';

export type GistMenu = {
  items?: MenuItem[];
  disable?: string[];
};

export type GistFetchResult = {
  data: GistMenu;
  hash: string | null;
  loadedAt: number;
  stale: boolean;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const GIST_FETCH_TIMEOUT_MS = 1_000;

type CacheEntry = { result: GistFetchResult | null; at: number };
const cache = new Map<string, CacheEntry>();
const lastKnownGood = new Map<string, GistFetchResult>();

let retryDelays: number[] = [200, 500, 1000];

const GIST_URL_RE =
  /^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)(?:\/([a-f0-9]{7,64}))?(?:\/?.*)?$/i;
const RAW_HASH_RE = /\/raw\/([a-f0-9]{7,64})(?:\/|$)/i;

export type ParsedGistUrl = { user: string; id: string; hash: string | null };

export function parseGistUrl(url: string): ParsedGistUrl | null {
  const m = url.match(GIST_URL_RE);
  if (!m) return null;
  return { user: m[1], id: m[2], hash: m[3] || null };
}

export function buildRawGistUrl(parsed: ParsedGistUrl): string {
  return parsed.hash
    ? `https://gist.githubusercontent.com/${parsed.user}/${parsed.id}/raw/${parsed.hash}/`
    : `https://gist.githubusercontent.com/${parsed.user}/${parsed.id}/raw/`;
}

export function toRawGistUrl(url: string): string {
  const parsed = parseGistUrl(url);
  return parsed ? buildRawGistUrl(parsed) : url;
}

function extractHashFromUrl(url: string): string | null {
  const m = url.match(RAW_HASH_RE);
  return m ? m[1] : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("fetch timeout")), GIST_FETCH_TIMEOUT_MS);
    try {
      const timeout = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), GIST_FETCH_TIMEOUT_MS);
      });
      const res = await Promise.race([fetch(url, { signal: controller.signal }), timeout]);
      if (!res) {
        continue;
      }
      if (res.ok) return res;
    } catch {
      // network error — fall through to retry
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retryDelays.length) {
      await sleep(retryDelays[attempt]);
    }
  }
  return null;
}

/**
 * Fetch gist menu JSON. Hash-pinned URLs cache indefinitely (immutable);
 * unpinned URLs use a 5-min TTL. On fetch failure (after 3 retries) falls
 * back to the last-known-good value and marks the result `stale: true`.
 */
export async function fetchGistMenu(url: string): Promise<GistFetchResult | null> {
  const parsed = parseGistUrl(url);
  const rawUrl = parsed ? buildRawGistUrl(parsed) : url;
  const pinned = !!parsed?.hash;

  const cached = cache.get(rawUrl);
  if (cached) {
    if (pinned && cached.result) return cached.result;
    if (!pinned && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;
  }

  const res = await fetchWithRetry(rawUrl);
  if (!res) {
    const lkg = lastKnownGood.get(rawUrl);
    if (lkg) {
      const staleResult: GistFetchResult = { ...lkg, stale: true };
      cache.set(rawUrl, { result: staleResult, at: Date.now() });
      return staleResult;
    }
    console.warn(`[menu/gist] fetch failed after retries: ${rawUrl}`);
    cache.set(rawUrl, { result: null, at: Date.now() });
    return null;
  }

  try {
    const data = (await res.json()) as GistMenu;
    const hash = parsed?.hash ?? extractHashFromUrl(res.url);
    const result: GistFetchResult = {
      data,
      hash,
      loadedAt: Date.now(),
      stale: false,
    };
    cache.set(rawUrl, { result, at: Date.now() });
    lastKnownGood.set(rawUrl, result);
    return result;
  } catch {
    const lkg = lastKnownGood.get(rawUrl);
    if (lkg) {
      const staleResult: GistFetchResult = { ...lkg, stale: true };
      cache.set(rawUrl, { result: staleResult, at: Date.now() });
      return staleResult;
    }
    cache.set(rawUrl, { result: null, at: Date.now() });
    return null;
  }
}

export function invalidateGistCache(url?: string): void {
  if (!url) {
    cache.clear();
    return;
  }
  const parsed = parseGistUrl(url);
  const rawUrl = parsed ? buildRawGistUrl(parsed) : url;
  cache.delete(rawUrl);
}

export function _clearGistCache(): void {
  cache.clear();
  lastKnownGood.clear();
}

export function _setRetryDelays(delays: number[]): void {
  retryDelays = delays;
}
