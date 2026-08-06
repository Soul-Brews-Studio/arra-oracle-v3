import { Elysia } from 'elysia';
import { db, sqlite } from '../../db/index.ts';
import { activeTenantId, runWithTenant } from '../../middleware/tenant.ts';
import { auditLog } from '../../storage/audit-log.ts';
import { runSupersede } from '../../tools/supersede.ts';
import { runConsolidationWorker, type ConsolidationPlan } from '../../workers/consolidation.ts';
import { listQueuedConsolidationPlans } from '../../workers/consolidation-queue.ts';
import { parseMemoryLimit } from './model.ts';

type DocPreview = { id: string; title: string; sourceFile: string; type: string; content: string };
type Suggestion = {
  id: string; oldId: string; newId: string; tenantId: string; confidence: number; score: number;
  reason: string; source: string; model?: string; original: DocPreview; suggested: DocPreview;
  metrics: { cosine: number; ftsOverlap: number; oldConfidence: number; newConfidence: number };
};
type DocRow = { id: string; type: string; sourceFile: string; content: string | null };
type AuditPayload = {
  type: `memory_consolidation.${'approve' | 'reject'}`; suggestionId: string; oldId: string;
  newId: string; tenantId: string; who: string; when: number; reason?: string;
};

const ACTOR_HEADERS = ['x-oracle-actor', 'x-actor', 'x-user', 'x-user-id'];
const silentLogger = { log() {}, warn() {}, error() {} };

export function createMemoryConsolidationRoutes() {
  const routes = new Elysia({ prefix: '/memory/consolidation' })
    .get('/pending', ({ query }) => pendingResponse(parseMemoryLimit(query.limit, 50, 1000)))
    .get('/suggestions', ({ query }) => pendingResponse(parseMemoryLimit(query.limit, 50, 1000)))
    .post('/suggestions/:id/approve', ({ params, body, request, set }) => approve(params.id, body, request, set))
    .post('/suggestions/:id/reject', ({ params, body, request, set }) => reject(params.id, body, request, set))
    .post('/:id/approve', ({ params, body, request, set }) => approve(params.id, body, request, set))
    .post('/:id/reject', ({ params, body, request, set }) => reject(params.id, body, request, set));
  return routes;
}

async function pendingResponse(limit: number) {
  const tenantId = activeTenantId();
  const suggestions = await pendingSuggestions(limit, tenantId);
  return { success: true, total: suggestions.length, tenant: { id: tenantId, scope: 'tenant_id' }, suggestions, items: suggestions };
}

async function approve(rawId: string, body: unknown, request: Request, set: { status?: number | string }) {
  const tenantId = activeTenantId();
  const suggestion = await suggestionFor(rawId, tenantId);
  if (!suggestion) return notFound(set, rawId);

  const result = runWithTenant(tenantId, () => runSupersede(db, {
    oldId: suggestion.oldId,
    newId: suggestion.newId,
    reason: reasonFrom(body) ?? suggestion.reason,
  }));
  if (result.isError) {
    set.status = 400;
    return result.payload;
  }
  const audit = writeAudit('approve', suggestion, request, reasonFrom(body));
  return { success: true, suggestion, result: result.payload, audit };
}

async function reject(rawId: string, body: unknown, request: Request, set: { status?: number | string }) {
  const tenantId = activeTenantId();
  const suggestion = await suggestionFor(rawId, tenantId);
  if (!suggestion) return notFound(set, rawId);
  const audit = writeAudit('reject', suggestion, request, reasonFrom(body));
  return { success: true, suggestion, audit };
}

async function suggestionFor(rawId: string, tenantId: string): Promise<Suggestion | undefined> {
  const id = safeDecode(rawId);
  const bodyIds = idsFromSuggestionId(id);
  const limit = bodyIds ? 1000 : 250;
  const suggestions = await pendingSuggestions(limit, tenantId);
  return suggestions.find((item) => item.id === id || item.id === rawId);
}

async function pendingSuggestions(limit: number, tenantId: string): Promise<Suggestion[]> {
  const result = await runConsolidationWorker(db, sqlite, {
    dryRun: true,
    limit,
    tenantId,
    logger: silentLogger,
  });
  const rejected = rejectedSuggestionIds(tenantId);
  const plans = mergePlans(listQueuedConsolidationPlans(tenantId, limit), result.plans);
  const docs = docsFor(plans, tenantId);
  return plans
    .map((plan) => suggestionFromPlan(plan, docs))
    .filter((item) => !rejected.has(item.id));
}

function mergePlans(...groups: ConsolidationPlan[][]): ConsolidationPlan[] {
  const byId = new Map<string, ConsolidationPlan>();
  for (const plan of groups.flat()) {
    const id = suggestionId(plan.oldId, plan.newId);
    if (!byId.has(id)) byId.set(id, plan);
  }
  return [...byId.values()];
}

function suggestionFromPlan(plan: ConsolidationPlan, docs: Map<string, DocPreview>): Suggestion {
  const original = docs.get(plan.oldId) ?? fallbackDoc(plan.oldId);
  const suggested = docs.get(plan.newId) ?? fallbackDoc(plan.newId);
  const confidence = round((plan.cosine * 0.6) + (plan.ftsOverlap * 0.4));
  const model = modelFromPlan(plan);
  return {
    id: suggestionId(plan.oldId, plan.newId), oldId: plan.oldId, newId: plan.newId,
    tenantId: plan.tenantId, confidence, score: confidence, reason: plan.reason, source: sourceFromPlan(plan),
    ...(model ? { model } : {}), original, suggested,
    metrics: {
      cosine: plan.cosine, ftsOverlap: plan.ftsOverlap,
      oldConfidence: plan.oldConfidence, newConfidence: plan.newConfidence,
    },
  };
}

function docsFor(plans: ConsolidationPlan[], tenantId: string): Map<string, DocPreview> {
  const ids = [...new Set(plans.flatMap((plan) => [plan.oldId, plan.newId]))];
  if (!ids.length) return new Map();
  const fts = sqlite.query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE name = ? LIMIT 1').get('oracle_fts');
  const content = fts ? "coalesce(f.content, '')" : "''";
  const join = fts ? 'LEFT JOIN oracle_fts f ON f.id = d.id' : '';
  const placeholders = ids.map(() => '?').join(',');
  const rows = sqlite.query<DocRow, (string | number)[]>(`
    SELECT d.id, d.type, d.source_file AS sourceFile, ${content} AS content
    FROM oracle_documents d ${join}
    WHERE d.tenant_id = ? AND d.id IN (${placeholders})`,
  ).all(tenantId, ...ids);
  return new Map(rows.map((row) => [row.id, docPreview(row)]));
}

function docPreview(row: DocRow): DocPreview {
  return {
    id: row.id,
    title: titleFrom(row.sourceFile, row.id),
    sourceFile: row.sourceFile,
    type: row.type,
    content: preview(row.content ?? ''),
  };
}

function fallbackDoc(id: string): DocPreview {
  return { id, title: id, sourceFile: '', type: '', content: '' };
}

function writeAudit(action: 'approve' | 'reject', suggestion: Suggestion, request: Request, reason?: string) {
  const when = Date.now();
  const payload: AuditPayload = {
    type: `memory_consolidation.${action}`,
    suggestionId: suggestion.id,
    oldId: suggestion.oldId,
    newId: suggestion.newId,
    tenantId: suggestion.tenantId,
    who: actorFrom(request),
    when,
    ...(reason ? { reason } : {}),
  };
  db.insert(auditLog).values({
    who: payload.who,
    what: JSON.stringify(payload),
    when,
    requestId: request.headers.get('x-request-id'),
  }).run();
  return { ...payload, at: new Date(when).toISOString() };
}

function rejectedSuggestionIds(tenantId: string): Set<string> {
  try {
    const rows = sqlite.query<{ what: string }, [string]>('SELECT what FROM audit_log WHERE what LIKE ?')
      .all('%"type":"memory_consolidation.reject"%');
    return new Set(rows.flatMap((row) => {
      const parsed = parseAudit(row.what);
      return parsed?.tenantId === tenantId ? [parsed.suggestionId] : [];
    }));
  } catch { return new Set(); }
}

function parseAudit(value: string): AuditPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<AuditPayload>;
    return parsed.type === 'memory_consolidation.reject' && typeof parsed.suggestionId === 'string'
      ? parsed as AuditPayload
      : null;
  } catch { return null; }
}

function actorFrom(request: Request): string {
  for (const header of ACTOR_HEADERS) {
    const actor = request.headers.get(header)?.trim();
    if (actor) return actor.slice(0, 120);
  }
  return request.headers.has('authorization') ? 'api' : 'anonymous';
}

function reasonFrom(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as Record<string, unknown>).reason;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function notFound(set: { status?: number | string }, id: string) {
  set.status = 404;
  return { success: false, error: `Pending consolidation suggestion not found: ${safeDecode(id)}` };
}

function titleFrom(sourceFile: string, fallback: string): string {
  const leaf = sourceFile.split('/').filter(Boolean).at(-1)?.replace(/\.md$/i, '');
  return leaf || fallback;
}

function preview(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > 280 ? `${clean.slice(0, 277)}…` : clean;
}

function suggestionId(oldId: string, newId: string): string { return `${oldId}->${newId}`; }
function modelFromPlan(plan: ConsolidationPlan): string | undefined { return (plan as Record<string, unknown>).model as string | undefined ?? plan.reason.match(/model=([^,)]+)/)?.[1]; }
function sourceFromPlan(plan: ConsolidationPlan): string { return (plan as Record<string, unknown>).source as string | undefined ?? (plan.reason.toLowerCase().includes('llm') ? 'sleep-time-llm' : 'similarity-sweep'); }
function round(value: number): number { return Number(value.toFixed(4)); }
function safeDecode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
function idsFromSuggestionId(id: string): [string, string] | null {
  const index = id.indexOf('->');
  return index > 0 ? [id.slice(0, index), id.slice(index + 2)] : null;
}

export const memoryConsolidationRoutes = createMemoryConsolidationRoutes();
