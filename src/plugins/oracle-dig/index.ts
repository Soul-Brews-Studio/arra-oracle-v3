import { randomUUID } from 'node:crypto';
import type { CreateTraceInput } from '../../trace/types.ts';
import { getFinding } from './get.ts';
import { listFindings } from './list.ts';
import { oracleSessions, type OracleSessionsOptions, type OracleSessionsResult } from './sessions.ts';
import { insertEvidence, insertFinding } from './store.ts';
import { bridgeTraceToGithubEvidence } from './trace-bridge.ts';
import type { InsertEvidenceInput, InsertFindingInput, ListFindingsInput } from './types.ts';

type JsonRecord = Record<string, unknown>;
type Source = 'api' | 'mcp' | 'cli' | 'server' | 'init' | 'destroy';
type PluginContext = {
  source: Source;
  plugin: string;
  args?: unknown[] | JsonRecord;
  body?: unknown;
  query?: JsonRecord;
  request?: Request;
};
type PluginResult = { ok: boolean; body?: unknown; error?: string; status?: number };

const CONFIDENCE: Record<string, number> = { high: 0.9, confirmed: 0.9, medium: 0.6, plausible: 0.6, low: 0.3 };
const KINDS = new Set(['github', 'session', 'oracle-msg', 'web']);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputRecord(ctx: PluginContext): JsonRecord {
  if (isRecord(ctx.body)) return ctx.body;
  if (Array.isArray(ctx.args) && isRecord(ctx.args[0])) return ctx.args[0];
  if (isRecord(ctx.args)) return ctx.args;
  if (isRecord(ctx.query)) return ctx.query;
  return {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function required(value: unknown, label: string): string {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function timestamp(value: unknown, fallback?: number): number {
  const numeric = numberValue(value);
  if (numeric !== undefined) return numeric;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isNaN(parsed)) return parsed;
  if (fallback !== undefined) return fallback;
  throw new Error('timestamp is required');
}

function optionalTimestamp(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return timestamp(value);
}

function confidence(value: unknown): number {
  const numeric = numberValue(value);
  if (numeric !== undefined) return numeric;
  const named = text(value)?.toLowerCase();
  return named ? CONFIDENCE[named] ?? 0.5 : 0.5;
}

function nested(record: JsonRecord, key: string): JsonRecord {
  return isRecord(record[key]) ? record[key] as JsonRecord : {};
}

function findingInput(raw: JsonRecord, id: string): InsertFindingInput {
  return {
    id,
    tenantId: text(raw.tenantId) ?? text(raw.tenant_id) ?? 'default',
    subject: required(raw.subject, 'subject'),
    relation: text(raw.relation),
    object: text(raw.object),
    dugBy: required(raw.dugBy ?? raw.dug_by, 'dug_by'),
    asOfTs: timestamp(raw.asOfTs ?? raw.as_of_ts ?? raw.asOf ?? raw.as_of, Date.now()),
    asOfCommit: text(raw.asOfCommit) ?? text(raw.as_of_commit),
    confidence: confidence(raw.confidence),
    topic: text(raw.topic),
    frictionScore: numberValue(raw.frictionScore ?? raw.friction_score),
    commissionedBy: text(raw.commissionedBy) ?? text(raw.commissioned_by),
    iterations: numberValue(raw.iterations),
  };
}

function evidenceKind(value: unknown): InsertEvidenceInput['kind'] {
  const kind = text(value)?.replace('_', '-');
  if (!kind || !KINDS.has(kind)) throw new Error(`unsupported evidence kind: ${String(value)}`);
  return kind as InsertEvidenceInput['kind'];
}

function directEvidence(raw: JsonRecord, findingId: string, tenantId: string): InsertEvidenceInput[] {
  const items = Array.isArray(raw.evidence) ? raw.evidence : [];
  return items.map((item) => evidenceRow(item, findingId, tenantId));
}

function evidenceRow(item: unknown, findingId: string, tenantId: string): InsertEvidenceInput {
  if (!isRecord(item)) throw new Error('evidence entries must be objects');
  const github = nested(item, 'github');
  const session = nested(item, 'session');
  const oracleMsg = nested(item, 'oracleMsg').from ? nested(item, 'oracleMsg') : nested(item, 'oracle_msg');
  const web = nested(item, 'web');
  return {
    findingId,
    tenantId,
    kind: evidenceKind(item.kind ?? item.type),
    githubOwner: text(item.githubOwner) ?? text(item.github_owner) ?? text(github.owner),
    githubRepo: text(item.githubRepo) ?? text(item.github_repo) ?? text(github.repo),
    githubPath: text(item.githubPath) ?? text(item.github_path) ?? text(github.path),
    githubRef: text(item.githubRef) ?? text(item.github_ref) ?? text(github.ref),
    githubLine: numberValue(item.githubLine ?? item.github_line ?? github.line),
    sessionId: text(item.sessionId) ?? text(item.session_id) ?? text(session.sessionId) ?? text(session.session_id),
    sessionOracle: text(item.sessionOracle) ?? text(item.session_oracle) ?? text(session.oracle),
    oracleMsgFrom: text(item.oracleMsgFrom) ?? text(item.oracle_msg_from) ?? text(oracleMsg.from),
    oracleMsgAt: optionalTimestamp(item.oracleMsgAt ?? item.oracle_msg_at ?? oracleMsg.at),
    webUrl: text(item.webUrl) ?? text(item.web_url) ?? text(web.url),
    webFetchedAt: optionalTimestamp(item.webFetchedAt ?? item.web_fetched_at ?? web.fetched_at),
    commit: text(item.commit),
  };
}

function traceInput(raw: JsonRecord): CreateTraceInput | undefined {
  return isRecord(raw.trace) ? raw.trace as unknown as CreateTraceInput : undefined;
}

function wantsSessions(raw: JsonRecord): boolean {
  if (raw.sessions === false || raw.includeSessions === false || raw.include_sessions === false) return false;
  return isRecord(raw.sessions) || raw.includeSessions === true || raw.include_sessions === true;
}

function sessionOptions(raw: JsonRecord): OracleSessionsOptions {
  const source = isRecord(raw.sessions) ? raw.sessions : raw;
  return {
    homeDir: text(source.homeDir) ?? text(source.home_dir),
    projectsDir: text(source.projectsDir) ?? text(source.projects_dir),
    limit: numberValue(source.limit),
  };
}

function sessionEvidence(result: OracleSessionsResult, findingId: string, tenantId: string, dugBy: string): InsertEvidenceInput[] {
  return result.sessions.map((session) => ({
    findingId,
    tenantId,
    kind: 'session' as const,
    sessionId: session.sessionId,
    sessionOracle: session.oracle ?? dugBy,
  }));
}

function listInput(raw: JsonRecord): ListFindingsInput {
  return {
    subject: text(raw.subject),
    topic: text(raw.topic),
    dugBy: text(raw.dugBy),
    dug_by: text(raw.dug_by),
    confidence: numberValue(raw.confidence),
    limit: numberValue(raw.limit),
    offset: numberValue(raw.offset),
  };
}

function failure(error: unknown, status = 400): PluginResult {
  return { ok: false, status, error: error instanceof Error ? error.message : String(error) };
}

export async function oracleDig(ctx: PluginContext): Promise<PluginResult> {
  try {
    const raw = inputRecord(ctx);
    const id = randomUUID();
    const finding = findingInput(raw, id);
    const rows = directEvidence(raw, id, finding.tenantId ?? 'default');
    const trace = traceInput(raw);
    const traceResult = trace ? await bridgeTraceToGithubEvidence({
      findingId: id,
      tenantId: finding.tenantId,
      asOfCommit: finding.asOfCommit ?? undefined,
      trace,
    }) : undefined;
    if (traceResult) rows.push(...traceResult.evidenceRows as InsertEvidenceInput[]);
    const sessions = wantsSessions(raw) ? await oracleSessions(sessionOptions(raw)) : undefined;
    if (sessions) rows.push(...sessionEvidence(sessions, id, finding.tenantId ?? 'default', finding.dugBy));
    if (rows.length === 0) throw new Error('oracle_dig requires evidence[], trace dig points, or session results');

    const stored = insertFinding(finding);
    const evidence = rows.map((row) => insertEvidence(row));
    return { ok: true, body: { ok: true, finding: getFinding(stored.id), evidenceCount: evidence.length, trace: traceResult, sessions } };
  } catch (error) {
    return failure(error);
  }
}

export async function oracleSessionsTool(ctx: PluginContext): Promise<PluginResult> {
  try {
    return { ok: true, body: { ok: true, ...(await oracleSessions(sessionOptions(inputRecord(ctx)))) } };
  } catch (error) {
    return failure(error);
  }
}

export async function oracleDigApiRoute(ctx: PluginContext): Promise<PluginResult> {
  const method = ctx.request?.method.toUpperCase() ?? 'GET';
  if (method === 'GET') return { ok: true, body: { ok: true, ...listFindings(listInput(inputRecord(ctx))) } };
  if (method === 'POST') return oracleDig(ctx);
  return failure('method not allowed', 405);
}

export default function handler(ctx: PluginContext) {
  return ctx.source === 'mcp' ? oracleDig(ctx) : oracleDigApiRoute(ctx);
}
