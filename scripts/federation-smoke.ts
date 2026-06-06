#!/usr/bin/env bun
/**
 * Federation smoke harness for source alpha.
 *
 * Pre-staged for oracle issue #44: after the federation migration lands, run
 * this against a live source server to verify the peer route namespace and auth
 * contract without clobbering the existing local/oraclenet `/api/feed` route.
 */

type SmokeStatus = 'pass' | 'fail' | 'pending';

export interface SmokeCheck {
  name: string;
  status: SmokeStatus;
  detail?: string;
}

export interface SmokeOptions {
  baseUrl: string;
  token?: string;
  requireFederation?: boolean;
  verbose?: boolean;
}

const FEDERATION_PATHS = ['/info', '/api/identity', '/api/peers', '/api/peer/feed', '/api/peer/search'] as const;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function requestJson(baseUrl: string, path: string, init?: RequestInit): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

function isMissingRoute(status: number): boolean {
  return status === 404 || status === 405;
}

function pass(name: string, detail?: string): SmokeCheck {
  return { name, status: 'pass', detail };
}

function fail(name: string, detail: string): SmokeCheck {
  return { name, status: 'fail', detail };
}

function pending(name: string, detail: string): SmokeCheck {
  return { name, status: 'pending', detail };
}

function expectObject(name: string, status: number, body: any, missingOk: boolean): SmokeCheck {
  if (isMissingRoute(status) && missingOk) return pending(name, `route not present yet (${status})`);
  if (status < 200 || status >= 300) return fail(name, `expected 2xx, got ${status}`);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(name, 'expected JSON object body');
  return pass(name, `HTTP ${status}`);
}

export async function runFederationSmoke(options: SmokeOptions): Promise<SmokeCheck[]> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const missingOk = !options.requireFederation;
  const checks: SmokeCheck[] = [];

  for (const path of FEDERATION_PATHS) {
    const method = path === '/api/peer/search' ? 'POST' : 'GET';
    const headers: Record<string, string> = {};
    if (path.startsWith('/api/peer/') && options.token) headers.authorization = `Bearer ${options.token}`;
    const init: RequestInit = method === 'POST'
      ? {
          method,
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ q: 'federation smoke', limit: 3 }),
        }
      : { method, headers };
    const res = await requestJson(baseUrl, path, init);
    checks.push(expectObject(`${method} ${path}`, res.status, res.body, missingOk));
  }

  const info = await requestJson(baseUrl, '/info');
  if (info.status >= 200 && info.status < 300 && info.body) {
    const capabilities = info.body.capabilities ?? info.body.maw?.capabilities ?? info.body.node?.capabilities ?? [];
    const hasSearch = JSON.stringify(capabilities).includes('arra-search');
    const hasFeed = JSON.stringify(capabilities).includes('feed');
    const hasSchema = Boolean(info.body.maw?.schema ?? info.body['maw.schema'] ?? info.body.schema);
    checks.push(hasSearch && hasFeed ? pass('/info capabilities', 'advertises arra-search + feed') : fail('/info capabilities', 'missing arra-search/feed capability'));
    checks.push(hasSchema ? pass('/info maw schema', 'schema advertised') : fail('/info maw schema', 'missing maw.schema/schema'));
  }

  const identity = await requestJson(baseUrl, '/api/identity');
  if (identity.status >= 200 && identity.status < 300 && identity.body) {
    const pubkey = String(identity.body.pubkey ?? identity.body.publicKey ?? identity.body.identity?.pubkey ?? '');
    checks.push(/^[a-f0-9]{64}$/i.test(pubkey) ? pass('/api/identity pubkey', '64 hex chars') : fail('/api/identity pubkey', 'pubkey is not 64-hex'));
  }

  // Namespace regression guard: source already owns `/api/feed`; federation must
  // live under `/api/peer/feed` and must not replace `/api/feed` semantics.
  const localFeed = await requestJson(baseUrl, '/api/feed?limit=1');
  const peerFeed = await requestJson(baseUrl, '/api/peer/feed?limit=1');
  if (!isMissingRoute(peerFeed.status) || options.requireFederation) {
    if (localFeed.status === peerFeed.status && JSON.stringify(localFeed.body) === JSON.stringify(peerFeed.body)) {
      checks.push(fail('feed namespace separation', '/api/feed and /api/peer/feed returned identical response'));
    } else if (isMissingRoute(peerFeed.status) && missingOk) {
      checks.push(pending('feed namespace separation', '/api/peer/feed not present yet'));
    } else {
      checks.push(pass('feed namespace separation', '/api/peer/feed is distinct from existing /api/feed'));
    }
  } else {
    checks.push(pending('feed namespace separation', '/api/peer/feed not present yet'));
  }

  if (options.token) {
    const unauthFeed = await requestJson(baseUrl, '/api/peer/feed?limit=1');
    const authFeed = await requestJson(baseUrl, '/api/peer/feed?limit=1', { headers: { authorization: `Bearer ${options.token}` } });
    const unauthSearch = await requestJson(baseUrl, '/api/peer/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'federation smoke' }),
    });
    const authSearch = await requestJson(baseUrl, '/api/peer/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
      body: JSON.stringify({ q: 'federation smoke' }),
    });

    if (isMissingRoute(unauthFeed.status) && missingOk) {
      checks.push(pending('peer auth feed', 'route not present yet'));
    } else {
      checks.push(unauthFeed.status === 401 && authFeed.status >= 200 && authFeed.status < 300
        ? pass('peer auth feed', 'Bearer token required')
        : fail('peer auth feed', `expected 401 without token + 2xx with token, got ${unauthFeed.status}/${authFeed.status}`));
    }

    if (isMissingRoute(unauthSearch.status) && missingOk) {
      checks.push(pending('peer auth search', 'route not present yet'));
    } else {
      checks.push(unauthSearch.status === 401 && authSearch.status >= 200 && authSearch.status < 300
        ? pass('peer auth search', 'Bearer token required')
        : fail('peer auth search', `expected 401 without token + 2xx with token, got ${unauthSearch.status}/${authSearch.status}`));
    }

    const openInfo = await requestJson(baseUrl, '/info');
    const openIdentity = await requestJson(baseUrl, '/api/identity');
    if (!isMissingRoute(openInfo.status) || options.requireFederation) {
      checks.push(openInfo.status >= 200 && openInfo.status < 300 ? pass('auth open /info', 'open without token') : fail('auth open /info', `got ${openInfo.status}`));
    }
    if (!isMissingRoute(openIdentity.status) || options.requireFederation) {
      checks.push(openIdentity.status >= 200 && openIdentity.status < 300 ? pass('auth open /api/identity', 'open without token') : fail('auth open /api/identity', `got ${openIdentity.status}`));
    }
  }

  return checks;
}

function printChecks(checks: SmokeCheck[]): void {
  for (const check of checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'pending' ? '…' : '✗';
    console.log(`${icon} ${check.status.toUpperCase()} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  const summary = checks.reduce<Record<SmokeStatus, number>>((acc, check) => {
    acc[check.status] += 1;
    return acc;
  }, { pass: 0, fail: 0, pending: 0 });
  console.log(`\nFederation smoke: ${summary.pass} pass, ${summary.pending} pending, ${summary.fail} fail`);
}

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = Bun.argv.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
}

if (import.meta.main) {
  const baseUrl = getArg('--base-url') || process.env.ORACLE_HTTP_URL || `http://localhost:${process.env.PORT || '3000'}`;
  const requireFederation = Bun.argv.includes('--require-federation') || Bun.argv.includes('--require');
  const token = getArg('--token') || process.env.ARRA_PEER_TOKEN;
  const checks = await runFederationSmoke({ baseUrl, token, requireFederation });
  printChecks(checks);
  const failures = checks.filter((check) => check.status === 'fail');
  const pendingChecks = checks.filter((check) => check.status === 'pending');
  if (failures.length > 0 || (requireFederation && pendingChecks.length > 0)) {
    process.exit(1);
  }
}
