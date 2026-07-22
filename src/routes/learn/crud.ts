import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { db, learnLog, oracleDocuments, sqlite } from '../../db/index.ts';
import { REPO_ROOT } from '../../config.ts';
import { resolveProjectAuthority } from '../../learn/authority.ts';
import { buildLearningMarkdown, dateSlug } from '../../learn/markdown.ts';
import { reserveExplicitLearning, reserveGeneratedLearning, resolveVaultLearnTarget } from '../../learn/target.ts';
import { currentTenantId, tenantIdForWrite } from '../../middleware/tenant.ts';
import { replaceEntityLinks } from '../../search/entity-ranking.ts';
import { getVaultPsiRoot } from '../../vault/discovery.ts';
import { conceptsFrom, learningContent, slugFor } from './content.ts';
import {
  INVALID_LEARNING_ID,
  INVALID_LEARNING_SOURCE_FILE,
  safeLearningId,
} from './safety.ts';
type LearnDoc = typeof oracleDocuments.$inferSelect;
const oracleFts = sqliteTable('oracle_fts', {
  id: text('id'),
  content: text('content'),
  concepts: text('concepts'),
});
export type LearnCreateBody = {
  pattern?: string;
  concepts?: string[] | string;
  source?: string;
  origin?: string | null;
  project?: string | null;
  id?: string;
  sourceFile?: string;
};
type LearnUpdateBody = Partial<Pick<LearnCreateBody, 'pattern' | 'concepts' | 'origin' | 'project' | 'sourceFile'>> & {
  supersededBy?: string | null;
  supersededReason?: string | null;
};
const ConceptInput = t.Optional(t.Union([t.Array(t.String()), t.String()]));
const CreateBody = t.Object({
  pattern: t.Optional(t.String()),
  concepts: ConceptInput,
  source: t.Optional(t.String()),
  origin: t.Optional(t.Nullable(t.String())),
  project: t.Optional(t.Nullable(t.String())),
  id: t.Optional(t.String()),
  sourceFile: t.Optional(t.String()),
});
const UpdateBody = t.Object({
  pattern: t.Optional(t.String()),
  concepts: ConceptInput,
  origin: t.Optional(t.Nullable(t.String())),
  project: t.Optional(t.Nullable(t.String())),
  sourceFile: t.Optional(t.String()),
  supersededBy: t.Optional(t.Nullable(t.String())),
  supersededReason: t.Optional(t.Nullable(t.String())),
});
function ftsContent(id: string): string | null {
  return db.select({ content: oracleFts.content })
    .from(oracleFts)
    .where(eq(oracleFts.id, id))
    .get()?.content ?? null;
}
function upsertFts(id: string, content: string, concepts: string[]): void {
  db.delete(oracleFts).where(eq(oracleFts.id, id)).run();
  db.insert(oracleFts).values({ id, content, concepts: concepts.join(' ') }).run();
}
function globalIdExists(id: string): boolean {
  return !!db.select({ id: oracleDocuments.id }).from(oracleDocuments).where(eq(oracleDocuments.id, id)).get();
}
function rowById(id: string): LearnDoc | undefined {
  const tenantId = currentTenantId();
  const base = and(eq(oracleDocuments.id, id), eq(oracleDocuments.type, 'learning'));
  return db.select().from(oracleDocuments)
    .where(tenantId ? and(base, eq(oracleDocuments.tenantId, tenantId)) : base)
    .get();
}
function responseRow(row: LearnDoc) {
  return { ...row, concepts: conceptsFrom(row.concepts) };
}
export function createLearning(body: LearnCreateBody) {
  const pattern = body.pattern?.trim();
  if (!pattern) return { status: 400, body: { error: 'Missing required field: pattern' } };
  if (body.id !== undefined && !safeLearningId(body.id)) return { status: 400, body: { error: INVALID_LEARNING_ID } };
  if (body.sourceFile !== undefined && body.id === undefined) return { status: 400, body: { error: INVALID_LEARNING_SOURCE_FILE } };
  const authority = resolveProjectAuthority(body.project, {
    explicit: Object.prototype.hasOwnProperty.call(body, 'project'),
  });
  if ('invalid' in authority) return { status: 400, body: { error: 'Invalid project authority' } };
  const project = authority.project;
  const now = new Date();
  const concepts = conceptsFrom(body.concepts);
  const vault = getVaultPsiRoot();
  const vaultRoot = 'path' in vault ? vault.path : null;
  const target = resolveVaultLearnTarget(project, vaultRoot, 'ψ/memory/learnings', process.env.ORACLE_REPO_ROOT || REPO_ROOT);
  const markdown = ({ id }: { id: string }) => buildLearningMarkdown({
    id, pattern, title: pattern.split('\n')[0].slice(0, 80), concepts, createdAt: now,
    source: body.source, project,
  });
  let identity;
  try {
    identity = body.id
      ? reserveExplicitLearning({
        id: body.id,
        sourceFile: body.sourceFile ?? `ψ/memory/learnings/${body.id}.md`,
        target,
        idExists: globalIdExists,
        content: markdown,
      })
      : reserveGeneratedLearning({
        dateStr: dateSlug(now), slug: slugFor(pattern), target,
        idExists: globalIdExists, content: markdown,
      });
  } catch (error) {
    if (error instanceof TypeError) return { status: 400, body: { error: INVALID_LEARNING_SOURCE_FILE } };
    throw error;
  }
  if (!identity) return { status: 409, body: { error: 'Learning already exists or sourceFile already exists' } };
  const content = markdown(identity);
  const tenantId = tenantIdForWrite();
  try {
    db.insert(oracleDocuments).values({
      id: identity.id, tenantId, type: 'learning', sourceFile: identity.sourceFile,
      concepts: JSON.stringify(concepts), createdAt: now.getTime(), updatedAt: now.getTime(), indexedAt: now.getTime(),
      origin: body.origin ?? null, project, createdBy: 'oracle_learn',
    }).run();
    upsertFts(identity.id, content, concepts);
    replaceEntityLinks(sqlite, { documentId: identity.id, tenantId, content, concepts, now: now.getTime() });
    db.insert(learnLog).values({
      documentId: identity.id, tenantId, patternPreview: pattern.slice(0, 200),
      source: body.source ?? 'Oracle Learn', concepts: JSON.stringify(concepts), createdAt: now.getTime(), project,
    }).run();
  } catch (error) {
    throw new Error(`Learning persistence failed after file reservation; orphan file: ${identity.filePath}`, { cause: error });
  }
  return { status: 200, body: { success: true, file: identity.sourceFile, id: identity.id } };
}
function updateLearning(id: string, body: LearnUpdateBody) {
  const existing = rowById(id);
  if (!existing) return { status: 404, body: { error: 'Learning not found' } };
  const now = Date.now();
  const set: Partial<LearnDoc> = { updatedAt: now, indexedAt: now };
  if (body.sourceFile !== undefined) {
    if (body.sourceFile !== existing.sourceFile) return { status: 400, body: { error: 'Learning sourceFile is immutable' } };
  }
  if (body.concepts !== undefined) set.concepts = JSON.stringify(conceptsFrom(body.concepts));
  if (body.origin !== undefined) set.origin = body.origin;
  if (body.project !== undefined) {
    const authority = resolveProjectAuthority(body.project, { explicit: true });
    if ('invalid' in authority) return { status: 400, body: { error: 'Invalid project authority' } };
    if (authority.project !== existing.project) return { status: 400, body: { error: 'Learning project is immutable' } };
  }
  if (body.supersededBy !== undefined) set.supersededBy = body.supersededBy;
  if (body.supersededReason !== undefined) set.supersededReason = body.supersededReason;
  const nextConcepts = body.concepts === undefined ? conceptsFrom(existing.concepts) : conceptsFrom(body.concepts);
  const content = body.pattern?.trim()
    ? learningContent(body.pattern.trim(), nextConcepts)
    : ftsContent(id) ?? learningContent(existing.sourceFile, nextConcepts);
  upsertFts(id, content, nextConcepts);
  const row = db.update(oracleDocuments)
    .set(set)
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.type, 'learning'),
      ...(currentTenantId() ? [eq(oracleDocuments.tenantId, currentTenantId()!)] : [])))
    .returning()
    .get();
  replaceEntityLinks(sqlite, { documentId: id, tenantId: row.tenantId, content, concepts: nextConcepts, now });
  return { status: 200, body: responseRow(row) };
}
function softDeleteLearning(id: string) {
  const existing = rowById(id);
  if (!existing) return { status: 404, body: { error: 'Learning not found' } };
  const now = Date.now();
  const row = db.update(oracleDocuments)
    .set({
      updatedAt: now,
      indexedAt: now,
      supersededAt: now,
      supersededReason: existing.supersededReason ?? 'soft-deleted via DELETE /api/learn/:id',
    })
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.type, 'learning'),
      ...(currentTenantId() ? [eq(oracleDocuments.tenantId, currentTenantId()!)] : [])))
    .returning()
    .get();
  db.delete(oracleFts).where(eq(oracleFts.id, id)).run();
  replaceEntityLinks(sqlite, { documentId: id, tenantId: row.tenantId, content: '', concepts: [], now });
  return { status: 200, body: { id: row.id, deleted: 'soft', supersededAt: row.supersededAt } };
}
export function createLearnCrudRoutes() {
  return new Elysia()
    .post('/learn', ({ body, set }) => {
      const result = createLearning(body as LearnCreateBody);
      set.status = result.status;
      return result.body;
    }, { body: CreateBody, detail: { tags: ['knowledge'], menu: { group: 'hidden' }, summary: 'Create a learning' } })
    .get('/learn/:id', ({ params, set }) => {
      const row = rowById(params.id);
      if (!row) {
        set.status = 404;
        return { error: 'Learning not found' };
      }
      return responseRow(row);
    })
    .put('/learn/:id', ({ params, body, set }) => {
      const result = updateLearning(params.id, body as LearnUpdateBody);
      set.status = result.status;
      return result.body;
    }, { body: UpdateBody, detail: { tags: ['knowledge'], menu: { group: 'hidden' }, summary: 'Update a learning' } })
    .delete('/learn/:id', ({ params, set }) => {
      const result = softDeleteLearning(params.id);
      set.status = result.status;
      return result.body;
    }, { detail: { tags: ['knowledge'], menu: { group: 'hidden' }, summary: 'Soft-delete a learning' } });
}
export const learnCrudRoutes = createLearnCrudRoutes();
