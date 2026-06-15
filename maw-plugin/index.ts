import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { runServe, type ServeDeps } from './serve.ts';

type InvokeContext = { source?: string; args?: string[]; writer?: (...args: unknown[]) => void };
type InvokeResult = { ok: boolean; output?: string; error?: string };
type Requester = (path: string, init?: RequestInit) => Promise<unknown>;
type Opener = (url: string) => void;
type RunOptions = { cwd?: string; env?: Record<string, string | undefined>; inherit?: boolean; capture?: boolean };
type RunResult = { code: number | null; stdout?: string; stderr?: string };
type Runner = (cmd: string, args: string[], options?: RunOptions) => Promise<RunResult>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Parsed = { pos: string[]; flags: Record<string, string | boolean> };
type Built = { path: string; query?: Record<string, unknown>; body?: Record<string, unknown> };
type Spec = { tool: string; method: Method; help: string; write?: boolean; build: (p: Parsed) => Built; format?: (data: any, p: Parsed) => string };

const DEFAULT_ORACLE_API = 'http://localhost:47778';
const normalizeApiBase = (url: string) => url.replace(/\/+$/, '');

export const command = { name: 'arra', description: 'ARRA Oracle HTTP helper — 1:1 maw CLI surface for ARRA MCP tools.' };

export function resolveBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return normalizeApiBase(env.ORACLE_API?.trim() || DEFAULT_ORACLE_API);
}

export function resolveFrontendUrl(env: Record<string, string | undefined> = process.env): string {
  return normalizeApiBase(env.ARRA_FRONTEND_URL?.trim() || 'https://studio.buildwithoracle.com');
}

export function buildFrontendUrl(env: Record<string, string | undefined> = process.env): string {
  return `${resolveFrontendUrl(env)}/?api=${resolveBaseUrl(env)}`;
}


function runCommand(cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? 'inherit' : options.capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
    });
    if (options.capture && child.stdout) child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
    if (options.capture && child.stderr) child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }));
  });
}

async function mustRun(runner: Runner, cmd: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const result = await runner(cmd, args, options);
  if (result.code !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${result.code === null ? '' : ` (${result.code})`}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function parsePort(parsed: Parsed): string {
  const port = f(parsed, 'port') || '4321';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('--port must be a number from 1 to 65535');
  return port;
}

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref();
}

export function authHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const token = env.ARRA_API_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = { ...(init.body ? { 'content-type': 'application/json' } : {}), ...authHeaders(), ...(init.headers as Record<string, string> | undefined) };
  const base = resolveBaseUrl();
  let res: Response;
  try { res = await fetch(`${base}${path}`, { ...init, headers }); }
  catch (error) { throw new Error(`Cannot reach ARRA at ${base}: ${error instanceof Error ? error.message : String(error)}`); }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : text;
    throw new Error(`HTTP ${res.status}${message ? `: ${message}` : ''}`);
  }
  return data;
}

function parse(args: string[]): Parsed {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const raw = a.slice(2);
    const eq = raw.indexOf('=');
    const key = (eq >= 0 ? raw.slice(0, eq) : raw).replace(/-/g, '_');
    if (eq >= 0) flags[key] = raw.slice(eq + 1);
    else if (args[i + 1] && !args[i + 1].startsWith('--')) flags[key] = args[++i];
    else flags[key] = true;
  }
  return { pos, flags };
}

const key = (s: string) => s.toLowerCase().replace(/-/g, '_');
const enc = encodeURIComponent;
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const route = (path: string, query?: Record<string, unknown>, body?: Record<string, unknown>): Built => ({ path, query: query ? clean(query) : undefined, body: body ? clean(body) : undefined });
function f(p: Parsed, name: string): string | undefined { const v = p.flags[name.replace(/-/g, '_')]; return v === undefined || v === false ? undefined : v === true ? 'true' : String(v); }
function b(p: Parsed, name: string): boolean | undefined { const v = f(p, name); return v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : undefined; }
function n(p: Parsed, name: string): number | undefined { const v = f(p, name); if (!v) return undefined; const x = Number(v); return Number.isFinite(x) ? x : undefined; }
function first(p: Parsed, flag: string, label: string): string { const v = f(p, flag) || p.pos[0]; if (!v) throw new Error(`${label} required`); return v; }
function text(p: Parsed, flag: string, label: string): string { const v = f(p, flag) || p.pos.join(' ').trim(); if (!v) throw new Error(`${label} required`); return v; }
function qs(path: string, query?: Record<string, unknown>): string { const q = new URLSearchParams(); for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v)); const s = q.toString(); return s ? `${path}?${s}` : path; }
function one(v: unknown, max = 140): string { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; }
function preview(data: unknown, max = 700): string { return one(JSON.stringify(data), max); }

function formatSearch(data: any, p: Parsed): string {
  const query = f(p, 'query') || p.pos.join(' ');
  const results = Array.isArray(data?.results) ? data.results : [];
  const total = data?.total ?? results.length;
  if (!results.length) return `arra search: 0 results for "${query}"`;
  const lines = [`arra search: ${total} result${Number(total) === 1 ? '' : 's'} for "${query}"`];
  for (const [i, r] of results.slice(0, 8).entries()) lines.push(`${i + 1}. ${r.id ?? r.source_file ?? 'doc'} ${r.type ? `[${r.type}] ` : ''}score=${r.score ?? 'n/a'}\n   ${one(r.content ?? r.snippet ?? r.text ?? '')}`);
  return lines.join('\n');
}
function formatHealth(data: any): string { return [`arra health: ${data?.status ?? 'unknown'}`, data?.vectorMode && `vectorMode: ${data.vectorMode}`, data?.version && `version: ${data.version}`].filter(Boolean).join('\n'); }
function formatStats(data: any): string { return ['arra stats', data?.total_documents !== undefined && `docs: ${data.total_documents}`, data?.total_docs !== undefined && `docs: ${data.total_docs}`, data?.vector && `vector: ${one(JSON.stringify(data.vector), 180)}`].filter(Boolean).join('\n'); }
function formatRows(label: string, keys: string[]) { return (data: any) => { const rows = keys.map(k => data?.[k]).find(Array.isArray) ?? []; const total = data?.total ?? data?.chain_length ?? rows.length; return Array.isArray(rows) ? [`arra ${label}: ${total} item${Number(total) === 1 ? '' : 's'}`, ...rows.slice(0, 8).map((r: any) => `- ${r.id ?? r.trace_id ?? r.path ?? r.filename ?? r.name ?? '?'} ${one(r.title ?? r.query ?? r.content ?? r.preview ?? r.label ?? '')}`)].join('\n') : `arra ${label}: ${preview(data)}`; }; }
function formatOk(label: string) { return (data: any) => [`arra ${label}: ${data?.success === false ? 'failed' : 'ok'}`, data?.id && `id: ${data.id}`, data?.trace_id && `trace_id: ${data.trace_id}`, data?.thread_id && `thread_id: ${data.thread_id}`, data?.message && one(data.message), data?.error && `error: ${one(data.error)}`].filter(Boolean).join('\n') || `arra ${label}: ${preview(data)}`; }

export const COMMANDS: Record<string, Spec> = {
  search: { tool: 'oracle_search', method: 'GET', help: 'search <q> [--mode fts|hybrid|vector] [--limit N]', build: p => route('/api/search', { q: text(p, 'query', 'query'), type: f(p, 'type'), limit: f(p, 'limit') || '5', offset: f(p, 'offset'), mode: f(p, 'mode') || 'fts', project: f(p, 'project'), cwd: f(p, 'cwd'), model: f(p, 'model') }), format: formatSearch },
  learn: { tool: 'oracle_learn', method: 'POST', write: true, help: 'learn <text> [--project P] [--source S] [--concepts a,b]', build: p => route('/api/learn', undefined, { pattern: text(p, 'pattern', 'text'), project: f(p, 'project'), source: f(p, 'source'), concepts: f(p, 'concepts')?.split(',').map(s => s.trim()).filter(Boolean) }), format: formatOk('learn') },
  stats: { tool: 'oracle_stats', method: 'GET', help: 'stats', build: () => route('/api/stats'), format: formatStats },
  index: { tool: 'oracle_index', method: 'POST', write: true, help: 'index [--project P] [--path PATH]', build: p => route('/api/indexer/reindex', undefined, { project: f(p, 'project'), path: f(p, 'path') || p.pos[0] }), format: formatOk('index') },
  scan: { tool: 'oracle_scan', method: 'POST', help: 'scan [--path PATH]', build: p => route('/api/indexer/scan', undefined, { sourcePath: f(p, 'path') || p.pos[0] }), format: formatRows('scan', ['files', 'items']) },
  plugins: { tool: 'oracle_plugins', method: 'GET', help: 'plugins', build: () => route('/api/plugins'), format: formatRows('plugins', ['plugins']) },
  settings: { tool: 'oracle_settings', method: 'GET', help: 'settings', build: () => route('/api/settings/tools'), format: d => `arra settings: ${preview(d, 700)}` },
  feed: { tool: 'oracle_feed', method: 'GET', help: 'feed', build: () => route('/api/feed'), format: formatRows('feed', ['feed', 'items', 'entries']) },
  menu: { tool: 'oracle_menu', method: 'GET', help: 'menu', build: () => route('/api/menu'), format: formatRows('menu', ['items', 'menu']) },
  vector: { tool: 'oracle_vector', method: 'GET', help: 'vector', build: () => route('/api/vector/config'), format: d => `arra vector: ${preview(d, 700)}` },
  vector_index: { tool: 'oracle_vector_index', method: 'POST', write: true, help: 'vector-index [--model nomic|bge-m3|qwen3|all]', build: p => route('/api/vector/index/start', undefined, { model: f(p, 'model') }), format: formatOk('vector-index') },
  vector_status: { tool: 'oracle_vector_status', method: 'GET', help: 'vector-status', build: () => route('/api/vector/index/status'), format: d => `arra vector-status: ${preview(d, 700)}` },
  vector_stop: { tool: 'oracle_vector_stop', method: 'POST', write: true, help: 'vector-stop', build: () => route('/api/vector/index/stop'), format: formatOk('vector-stop') },
  vector_models: { tool: 'oracle_vector_models', method: 'GET', help: 'vector-models', build: () => route('/api/vector/index/models'), format: d => `arra vector-models: ${preview(d, 700)}` },
  health: { tool: 'oracle_health', method: 'GET', help: 'health', build: () => route('/api/health'), format: formatHealth },
  trace: { tool: 'oracle_trace', method: 'POST', write: true, help: 'trace <query> [--scope project|cross-project|human]', build: p => route('/api/traces', undefined, { query: text(p, 'query', 'query'), queryType: f(p, 'query_type'), scope: f(p, 'scope'), parentTraceId: f(p, 'parent_trace_id'), project: f(p, 'project'), agentCount: n(p, 'agent_count'), durationMs: n(p, 'duration_ms') }), format: formatOk('trace') },
  trace_list: { tool: 'oracle_trace_list', method: 'GET', help: 'trace_list [--query Q] [--status S] [--project P] [--limit N]', build: p => route('/api/traces', { query: f(p, 'query'), status: f(p, 'status'), project: f(p, 'project'), limit: f(p, 'limit'), offset: f(p, 'offset') }), format: formatRows('trace_list', ['traces']) },
  trace_get: { tool: 'oracle_trace_get', method: 'GET', help: 'trace_get <traceId> [--include-chain]', build: p => { const id = first(p, 'trace_id', 'traceId'); return route(`/api/traces/${enc(id)}${b(p, 'include_chain') ? '/chain' : ''}`); }, format: (d, p) => `arra trace: ${d?.trace_id ?? d?.traceId ?? d?.id ?? p.pos[0]}${d?.query ? `\nquery: ${one(d.query)}` : ''}` },
  trace_link: { tool: 'oracle_trace_link', method: 'POST', write: true, help: 'trace_link <prevTraceId> <nextTraceId>', build: p => { const prev = first(p, 'prev_trace_id', 'prevTraceId'); const next = f(p, 'next_trace_id') || p.pos[1]; if (!next) throw new Error('nextTraceId required'); return route(`/api/traces/${enc(prev)}/link`, undefined, { nextId: next }); }, format: formatOk('trace_link') },
  trace_unlink: { tool: 'oracle_trace_unlink', method: 'DELETE', write: true, help: 'trace_unlink <traceId> --direction prev|next', build: p => route(`/api/traces/${enc(first(p, 'trace_id', 'traceId'))}/link`, { direction: f(p, 'direction') || p.pos[1] }), format: formatOk('trace_unlink') },
  trace_chain: { tool: 'oracle_trace_chain', method: 'GET', help: 'trace_chain <traceId>', build: p => route(`/api/traces/${enc(first(p, 'trace_id', 'traceId'))}/linked-chain`), format: formatRows('trace_chain', ['chain']) },
  concepts: { tool: 'oracle_concepts', method: 'GET', help: 'concepts [--type all|learning|pattern] [--limit N]', build: p => route('/api/concepts', { type: f(p, 'type'), limit: f(p, 'limit') }), format: formatRows('concepts', ['concepts']) },
  handoff: { tool: 'oracle_handoff', method: 'POST', write: true, help: 'handoff <content> [--slug S]', build: p => route('/api/handoff', undefined, { content: text(p, 'content', 'content'), slug: f(p, 'slug') }), format: formatOk('handoff') },
  inbox: { tool: 'oracle_inbox', method: 'GET', help: 'inbox [--type handoff|all] [--limit N]', build: p => route('/api/inbox', { type: f(p, 'type'), limit: f(p, 'limit'), offset: f(p, 'offset') }), format: formatRows('inbox', ['files']) },
  list: { tool: 'oracle_list', method: 'GET', help: 'list [--type all|learning|pattern] [--limit N]', build: p => route('/api/list', { type: f(p, 'type'), limit: f(p, 'limit'), offset: f(p, 'offset'), group: 'false' }), format: formatRows('list', ['documents', 'results']) },
  read: { tool: 'oracle_read', method: 'GET', help: 'read <file-or-id> [--file F|--id ID]', build: p => route('/api/read', { file: f(p, 'file') || (!f(p, 'id') ? p.pos[0] : undefined), id: f(p, 'id') }), format: d => one(d?.content ?? d?.text ?? preview(d), 900) },
  reflect: { tool: 'oracle_reflect', method: 'GET', help: 'reflect', build: () => route('/api/reflect'), format: d => `arra reflect: ${one(d?.text ?? d?.reflection ?? preview(d), 500)}` },
  supersede: { tool: 'oracle_supersede', method: 'POST', write: true, help: 'supersede <oldId> <newId> [--reason R]', build: p => { const oldId = first(p, 'old_id', 'oldId'); const newId = f(p, 'new_id') || p.pos[1]; if (!newId) throw new Error('newId required'); return route('/api/supersede/document', undefined, { oldId, newId, reason: f(p, 'reason') }); }, format: formatOk('supersede') },
  thread: { tool: 'oracle_thread', method: 'POST', write: true, help: 'thread <message> [--thread-id N] [--title T]', build: p => route('/api/thread', undefined, { message: text(p, 'message', 'message'), thread_id: n(p, 'thread_id'), title: f(p, 'title'), role: f(p, 'role') || 'human', model: f(p, 'model') }), format: formatOk('thread') },
  threads: { tool: 'oracle_threads', method: 'GET', help: 'threads [--status active|closed] [--limit N]', build: p => route('/api/threads', { status: f(p, 'status'), limit: f(p, 'limit'), offset: f(p, 'offset') }), format: formatRows('threads', ['threads']) },
  thread_read: { tool: 'oracle_thread_read', method: 'GET', help: 'thread_read <threadId>', build: p => route(`/api/thread/${enc(first(p, 'thread_id', 'threadId'))}`), format: d => [`arra thread: ${d?.thread?.id ?? d?.thread_id ?? '?'}`, d?.thread?.title && `title: ${d.thread.title}`, Array.isArray(d?.messages) && `messages: ${d.messages.length}`].filter(Boolean).join('\n') },
  thread_update: { tool: 'oracle_thread_update', method: 'PATCH', write: true, help: 'thread_update <threadId> --status active|closed|answered|pending', build: p => route(`/api/thread/${enc(first(p, 'thread_id', 'threadId'))}/status`, undefined, { status: f(p, 'status') || p.pos[1] }), format: formatOk('thread_update') },
  verify: { tool: 'oracle_verify', method: 'POST', write: true, help: 'verify [--check true|false] [--type all|learning|pattern]', build: p => route('/api/verify', undefined, { check: b(p, 'check'), type: f(p, 'type') }), format: d => `arra verify: ${preview(d, 500)}` },
};

const LOCAL_COMMANDS = { frontend: 'frontend [--no-open]', ui: 'ui [--no-open]', open: 'open [--no-open]', serve: 'serve [--stop|--status] [--port N]', studio: 'studio [--port N]' } as const;

function usage(): InvokeResult {
  const commandNames = [...Object.keys(COMMANDS), ...Object.keys(LOCAL_COMMANDS)].sort();
  return { ok: false, error: 'usage', output: ['usage: maw arra <subcommand> [args]', `subcommands: ${commandNames.join('|')}`, '', ...Object.entries(LOCAL_COMMANDS).sort().map(([name, help]) => `  ${name}  ${help}`), ...Object.entries(COMMANDS).sort().map(([name, spec]) => `  ${name}  ${spec.help}`)].join('\n') };
}
export function listSubcommands(): string[] { return [...Object.keys(COMMANDS), ...Object.keys(LOCAL_COMMANDS)].sort(); }

function runFrontend(parsed: Parsed, opener: Opener, env: Record<string, string | undefined>): InvokeResult {
  const url = buildFrontendUrl(env);
  const shouldOpen = b(parsed, 'no_open') !== true;
  if (shouldOpen) opener(url);
  return { ok: true, output: [`arra frontend: ${url}`, shouldOpen ? 'opened browser' : 'not opened (--no-open)'].join('\n') };
}

async function runStudio(parsed: Parsed, runner: Runner, env: Record<string, string | undefined>): Promise<InvokeResult> {
  try {
    const port = parsePort(parsed);
    await mustRun(runner, 'ghq', ['get', '-u', 'Soul-Brews-Studio/oracle-studio'], { inherit: true });
    const root = (await mustRun(runner, 'ghq', ['root'], { capture: true })).stdout?.trim();
    if (!root) throw new Error('ghq root returned no path');
    const cwd = join(root, 'github.com', 'Soul-Brews-Studio', 'oracle-studio');
    await mustRun(runner, 'bun', ['install'], { cwd, inherit: true });
    await mustRun(runner, 'bun', ['run', 'dev', '--port', port], { cwd, inherit: true, env: { ...env, VITE_ARRA_API: 'http://localhost:47778' } });
    return { ok: true, output: `arra studio: stopped (port ${port})` };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export async function runArra(args: string[], request: Requester = requestJson, opener: Opener = openUrl, env: Record<string, string | undefined> = process.env, runner: Runner = runCommand, serveDeps: ServeDeps = {}): Promise<InvokeResult> {
  const sub = key(args[0] || '');
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') return usage();
  const parsed = parse(args.slice(1));
  if (sub === 'frontend' || sub === 'ui' || sub === 'open') return runFrontend(parsed, opener, env);
  if (sub === 'studio') return runStudio(parsed, runner, env);
  if (sub === 'serve') return runServe(parsed, runner, env, serveDeps);
  const spec = COMMANDS[sub];
  if (!spec) return usage();
  try {
    const built = spec.build(parsed);
    const init: RequestInit = { method: spec.method };
    if (built.body && Object.keys(built.body).length > 0) init.body = JSON.stringify(built.body);
    if (spec.write) init.headers = authHeaders();
    const data = await request(qs(built.path, built.query), init);
    return { ok: true, output: (spec.format ?? ((d) => preview(d)))(data, parsed) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> { return runArra(ctx.args ?? []); }
