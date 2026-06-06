import { DEFAULT_ORACLE_API, normalizeApiBase } from '../cli/src/lib/config.ts';

type InvokeContext = {
  source?: string;
  args?: string[];
  writer?: (...args: unknown[]) => void;
};

type InvokeResult = {
  ok: boolean;
  output?: string;
  error?: string;
};

type Requester = (path: string, init?: RequestInit) => Promise<unknown>;

export const command = {
  name: 'arra',
  description: 'ARRA Oracle HTTP helper — search, learn, stats, health, trace.',
};

export function resolveBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return normalizeApiBase(env.ORACLE_API?.trim() || env.NEO_ARRA_API?.trim() || DEFAULT_ORACLE_API);
}

export function authHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const token = env.ARRA_API_TOKEN?.trim() || env.NEO_ARRA_API_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = {
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...authHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  const base = resolveBaseUrl();
  let res: Response;
  try {
    // Reuse arra-cli's default URL + normalization helpers; keep maw plugin
    // routing intentionally simple: ORACLE_API/NEO_ARRA_API or localhost.
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch (error) {
    throw new Error(`Cannot reach ARRA at ${base}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : text;
    throw new Error(`HTTP ${res.status}${message ? `: ${message}` : ''}`);
  }
  return data;
}

function usage(): InvokeResult {
  return {
    ok: false,
    error: 'usage',
    output: [
      'usage: maw arra <search|learn|stats|health|trace>',
      '  search <q> [--mode fts|hybrid|vector] [--limit N]',
      '  learn <text> [--project P]',
      '  stats',
      '  health',
      '  trace [id]',
    ].join('\n'),
  };
}

function takeFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) { i++; continue; }
    out.push(a);
  }
  return out;
}

function oneLine(value: unknown, max = 140): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatSearch(data: any, query: string): string {
  const results = Array.isArray(data?.results) ? data.results : [];
  const total = data?.total ?? results.length;
  if (!results.length) return `arra search: 0 results for "${query}"`;
  const lines = [`arra search: ${total} result${Number(total) === 1 ? '' : 's'} for "${query}"`];
  for (const [i, r] of results.slice(0, 8).entries()) {
    const label = [r.type, r.source ?? r.mode].filter(Boolean).join('/');
    lines.push(`${i + 1}. ${label ? `[${label}] ` : ''}${r.id ?? r.source_file ?? 'doc'} score=${r.score ?? 'n/a'}`);
    lines.push(`   ${oneLine(r.content ?? r.snippet ?? r.text ?? '')}`);
    if (r.source_file) lines.push(`   → ${r.source_file}`);
  }
  return lines.join('\n');
}

function formatLearn(data: any): string {
  return [
    `arra learn: ${data?.success === false ? 'failed' : 'ok'}`,
    data?.id ? `id: ${data.id}` : undefined,
    data?.path || data?.file ? `file: ${data.path ?? data.file}` : undefined,
    data?.message ? oneLine(data.message) : undefined,
  ].filter(Boolean).join('\n');
}

function formatStats(data: any): string {
  const docs = data?.total_documents ?? data?.totalDocuments ?? data?.documents ?? data?.stats?.documents;
  const fts = data?.fts_count ?? data?.ftsCount ?? data?.stats?.fts;
  const vector = data?.vector ?? data?.vectors ?? data?.vector_status;
  return [
    'arra stats',
    docs !== undefined ? `docs: ${docs}` : undefined,
    fts !== undefined ? `fts: ${fts}` : undefined,
    vector !== undefined ? `vector: ${typeof vector === 'string' ? vector : oneLine(JSON.stringify(vector), 180)}` : undefined,
  ].filter(Boolean).join('\n');
}

function formatHealth(data: any): string {
  return [
    `arra health: ${data?.status ?? 'unknown'}`,
    data?.server ? `server: ${data.server}` : undefined,
    data?.version ? `version: ${data.version}` : undefined,
    data?.port ? `port: ${data.port}` : undefined,
    data?.vectorMode ? `vectorMode: ${data.vectorMode}` : undefined,
    data?.vectorUrl ? `vectorUrl: ${data.vectorUrl}` : undefined,
    data?.vectorDisabledReason ? `vectorDisabledReason: ${oneLine(data.vectorDisabledReason)}` : undefined,
  ].filter(Boolean).join('\n');
}

function formatTrace(data: any, id?: string): string {
  if (id) {
    const trace = data?.trace ?? data;
    return [
      `arra trace: ${trace?.trace_id ?? trace?.id ?? id}`,
      trace?.query ? `query: ${oneLine(trace.query)}` : undefined,
      trace?.status ? `status: ${trace.status}` : undefined,
      trace?.created_at || trace?.createdAt ? `at: ${trace.created_at ?? trace.createdAt}` : undefined,
    ].filter(Boolean).join('\n');
  }
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  const traces = Array.isArray(data?.traces) ? data.traces : [];
  const rows = logs.length ? logs : traces;
  if (!rows.length) return 'arra trace: no audit rows';
  const kind = logs.length ? 'search logs' : 'traces';
  const lines = [`arra trace: latest ${Math.min(rows.length, 8)} ${kind}`];
  for (const row of rows.slice(0, 8)) {
    lines.push(`- ${row.id ?? row.trace_id ?? '?'} ${oneLine(row.query ?? row.title ?? row.mode ?? row.type ?? '')}`);
  }
  return lines.join('\n');
}

export async function runArra(args: string[], request: Requester = requestJson): Promise<InvokeResult> {
  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);
  try {
    if (sub === 'search') {
      const mode = takeFlag(rest, '--mode') || 'fts';
      if (!['fts', 'hybrid', 'vector'].includes(mode)) return { ok: false, error: `invalid mode: ${mode}` };
      const limit = takeFlag(rest, '--limit') || '5';
      const q = positional(rest).join(' ').trim();
      if (!q) return { ok: false, error: 'query required', output: 'usage: maw arra search <q> [--mode fts|hybrid|vector] [--limit N]' };
      const params = new URLSearchParams({ q, mode, limit });
      const data = await request(`/api/search?${params}`);
      return { ok: true, output: formatSearch(data, q) };
    }

    if (sub === 'learn') {
      const project = takeFlag(rest, '--project');
      const text = positional(rest).join(' ').trim();
      if (!text) return { ok: false, error: 'text required', output: 'usage: maw arra learn <text> [--project P]' };
      const data = await request('/api/learn', {
        method: 'POST',
        body: JSON.stringify({ pattern: text, ...(project ? { project } : {}) }),
      });
      return { ok: true, output: formatLearn(data) };
    }

    if (sub === 'stats') return { ok: true, output: formatStats(await request('/api/stats')) };
    if (sub === 'health') return { ok: true, output: formatHealth(await request('/api/health')) };
    if (sub === 'trace') {
      const id = rest[0];
      const data = await request(id ? `/api/traces/${encodeURIComponent(id)}` : '/api/logs?limit=8');
      return { ok: true, output: formatTrace(data, id) };
    }

    return usage();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  return runArra(ctx.args ?? []);
}
