type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
type Parsed = { pos: string[]; flags: Record<string, string | boolean> };
type Built = { path: string; query?: Record<string, unknown>; body?: Record<string, unknown> };
type Requester = (path: string, init?: RequestInit) => Promise<unknown>;
type Auth = () => Record<string, string>;
type InvokeResult = { ok: boolean; output?: string; error?: string };

export const VECTOR_CONFIG_HELP = 'vector-config [--json] | vector-config set <collection> adapter <adapter> | vector-config set <collection> enabled <true|false> | vector-config reload | vector-config add|remove|set-primary|test';

const enc = encodeURIComponent;
const key = (s: string) => s.toLowerCase().replace(/-/g, '_');
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const route = (path: string, query?: Record<string, unknown>, body?: Record<string, unknown>): Built => ({ path, query: query ? clean(query) : undefined, body: body ? clean(body) : undefined });
const bool = (v: string | undefined) => v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : undefined;
function f(p: Parsed, name: string): string | undefined { const v = p.flags[name.replace(/-/g, '_')]; return v === undefined || v === false ? undefined : v === true ? 'true' : String(v); }
function b(p: Parsed, name: string): boolean | undefined { return bool(f(p, name)); }
function qs(path: string, query?: Record<string, unknown>): string { const q = new URLSearchParams(); for (const [k, v] of Object.entries(query ?? {})) q.set(k, String(v)); const s = q.toString(); return s ? `${path}?${s}` : path; }
function one(v: unknown, max = 140): string { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; }

function collectionName(p: Parsed): string {
  const name = p.pos[1];
  if (!name) throw new Error('collection required');
  return name;
}

function adapter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = key(value) === 'cloudflare' ? 'cloudflare-vectorize' : value;
  if (!['lancedb', 'qdrant', 'sqlite-vec', 'chroma', 'cloudflare-vectorize', 'proxy'].includes(normalized)) {
    throw new Error('adapter must be lancedb, qdrant, sqlite-vec, chroma, cloudflare-vectorize, or proxy');
  }
  return normalized;
}

function updateBody(p: Parsed): Record<string, unknown> {
  const field = p.pos[2] ? key(p.pos[2]) : undefined;
  const value = p.pos[3];
  const body: Record<string, unknown> = {
    adapter: adapter(f(p, 'adapter')),
    model: f(p, 'model'),
    provider: f(p, 'provider'),
    service: f(p, 'service'),
    endpoint: f(p, 'endpoint') || f(p, 'url'),
    enabled: b(p, 'enabled'),
    primary: b(p, 'primary'),
  };
  if (field) {
    if (!value) throw new Error('value required');
    body[field] = field === 'adapter' ? adapter(value) : field === 'enabled' || field === 'primary' ? bool(value) : value;
  }
  return clean(body);
}

function createBody(p: Parsed): Record<string, unknown> {
  const body = updateBody({ ...p, pos: [] });
  body.collection = f(p, 'collection');
  if (!body.model) throw new Error('--model required');
  return clean(body);
}

function buildVectorConfig(p: Parsed): { method: Method; built: Built } | undefined {
  const action = key(p.pos[0] || 'list');
  if (action === 'list' || action === 'get' || action === 'stats') return { method: 'GET', built: route('/api/v1/vector/config') };
  if (action === 'reload') return { method: 'POST', built: route('/api/v1/vector/config/reload') };
  if (action === 'test') return { method: 'POST', built: route(`/api/v1/vector/config/${enc(collectionName(p))}/test`) };
  if (action === 'set_primary') return { method: 'POST', built: route(`/api/v1/vector/config/${enc(collectionName(p))}/primary`) };
  if (action === 'remove') {
    if (b(p, 'yes') !== true) throw new Error('remove requires --yes');
    return { method: 'DELETE', built: route(`/api/v1/vector/config/${enc(collectionName(p))}`) };
  }
  if (action === 'add') return { method: 'POST', built: route(`/api/v1/vector/config/${enc(collectionName(p))}`, undefined, createBody(p)) };
  if (action === 'set') return { method: 'PUT', built: route(`/api/v1/vector/config/${enc(collectionName(p))}`, undefined, updateBody(p)) };
  throw new Error(VECTOR_CONFIG_HELP);
}

function rows(data: any): any[] {
  const configRows = Object.entries(data?.config?.collections ?? {}).map(([key, col]: any) => ({
    key,
    ...col,
    count: data?.doc_counts?.[key] ?? 0,
    status: data?.health?.[key]?.status ?? 'unknown',
  }));
  const listed = Array.isArray(data?.collections) ? data.collections : configRows;
  return listed.map((row: any) => {
    const configured = configRows.find((item: any) => item.key === row.key || item.collection === row.collection) ?? {};
    return { ...configured, ...row, primary: row.primary ?? configured.primary };
  });
}

function pickCollection(data: any, collection: string): any | undefined {
  return rows(data).find((row) => row.key === collection || row.collection === collection);
}

function formatList(data: any): string {
  const lines = ['Collection | Adapter | Model | Docs | Status'];
  for (const row of rows(data)) {
    const label = `${row.collection ?? row.key}${row.primary ? ' ★' : ''}`;
    lines.push(`${label} | ${row.adapter ?? 'lancedb'} | ${row.model ?? row.key} | ${row.count ?? 0} | ${row.status ?? (row.ok === false ? 'down' : 'ok')}`);
  }
  if (lines.length === 1) lines.push('(none) | - | - | 0 | unknown');
  return [lines.join('\n'), '★ = primary'].join('\n');
}

function formatRead(data: any, p: Parsed): string {
  const action = key(p.pos[0] || 'list');
  if (f(p, 'json')) return JSON.stringify(data, null, 2);
  if (action === 'get') return one(JSON.stringify(pickCollection(data, collectionName(p)) ?? {}), 900);
  if (action === 'stats') {
    const name = p.pos[1];
    const counts = data?.doc_counts ?? {};
    return name ? `${name}: ${counts[name] ?? pickCollection(data, name)?.count ?? 0}` : Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  return formatList(data);
}

function formatWrite(data: any): string {
  return ['arra vector-config: ' + (data?.success === false ? 'failed' : 'ok'), data?.collection && `collection: ${data.collection}`, data?.removed && `removed: ${data.removed}`, data?.path && `path: ${data.path}`, data?.status && `status: ${data.status}`, data?.error && `error: ${one(data.error)}`].filter(Boolean).join('\n');
}

export async function runVectorConfig(parsed: Parsed, request: Requester, authHeaders: Auth): Promise<InvokeResult> {
  try {
    const { method, built } = buildVectorConfig(parsed) ?? { method: 'GET' as Method, built: route('/api/v1/vector/config') };
    const init: RequestInit = { method };
    if (method !== 'GET') init.headers = authHeaders();
    if (built.body) init.body = JSON.stringify(built.body);
    const data = await request(qs(built.path, built.query), init);
    return { ok: true, output: method === 'GET' ? formatRead(data, parsed) : formatWrite(data) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
