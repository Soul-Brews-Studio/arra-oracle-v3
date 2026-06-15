import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { db, learnLog, oracleDocuments } from '../../db/index.ts';
type LearnDoc = typeof oracleDocuments.$inferSelect;
const oracleFts = sqliteTable('oracle_fts', {
  id: text('id'),
  content: text('content'),
  concepts: text('concepts'),
});
const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;
type LearnCreateBody = {
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
function cleanConcepts(values: unknown[]): string[] {
  return values.map(String).map((c) => c.trim()).filter(Boolean);
}
function conceptsFrom(value: LearnCreateBody['concepts']): string[] {
  if (Array.isArray(value)) return cleanConcepts(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return cleanConcepts(parsed);
    } catch {}
    return value.split(',').map((c) => c.trim()).filter(Boolean);
  }
  return [];
}
function slugFor(pattern: string): string {
  const slug = pattern
    .slice(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'learning';
}
function learningContent(pattern: string, concepts: string[], source?: string): string {
  const title = pattern.split('\n')[0].slice(0, 80);
  const today = new Date().toISOString().slice(0, 10);
  return [
    '---',
    `title: ${title}`,
    concepts.length ? `tags: [${concepts.join(', ')}]` : 'tags: []',
    `created: ${today}`,
    `source: ${source || 'Oracle Learn'}`,
    '---',
    '',
    `# ${title}`,
    '',
    pattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    '',
  ].join('\n');
}
function writeLearningFile(sourceFile: string, content: string): void {
  const filePath = path.join(repoRoot(), sourceFile);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}
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
function nextIdentity(pattern: string, requestedId?: string, requestedSourceFile?: string) {
  if (requestedId) {
    return {
      id: requestedId,
      sourceFile: requestedSourceFile ?? `ψ/memory/learnings/${requestedId}.md`,
    };
  }
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugFor(pattern);
  let suffix = 1;
  while (true) {
    const tail = suffix === 1 ? slug : `${slug}-${suffix}`;
    const id = `learning_${date}_${tail}`;
    const sourceFile = requestedSourceFile ?? `ψ/memory/learnings/${date}_${tail}.md`;
    const existing = db.select({ id: oracleDocuments.id })
      .from(oracleDocuments)
      .where(eq(oracleDocuments.id, id))
      .get();
    if (!existing && !fs.existsSync(path.join(repoRoot(), sourceFile))) {
      return {
        id,
        sourceFile,
      };
    }
    suffix += 1;
  }
}
function rowById(id: string): LearnDoc | undefined {
  return db.select().from(oracleDocuments)
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.type, 'learning')))
    .get();
}
function responseRow(row: LearnDoc) {
  return { ...row, concepts: conceptsFrom(row.concepts) };
}
function createLearning(body: LearnCreateBody) {
  const pattern = body.pattern?.trim();
  if (!pattern) return { status: 400, body: { error: 'Missing required field: pattern' } };
  const now = Date.now();
  const concepts = conceptsFrom(body.concepts);
  const identity = nextIdentity(pattern, body.id, body.sourceFile);
  if (rowById(identity.id)) return { status: 409, body: { error: 'Learning already exists' } };
  const content = learningContent(pattern, concepts, body.source);
  writeLearningFile(identity.sourceFile, content);
  db.insert(oracleDocuments).values({
    id: identity.id,
    type: 'learning',
    sourceFile: identity.sourceFile,
    concepts: JSON.stringify(concepts),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    origin: body.origin ?? null,
    project: body.project?.toLowerCase() ?? null,
    createdBy: 'oracle_learn',
  }).run();
  upsertFts(identity.id, content, concepts);
  db.insert(learnLog).values({
    documentId: identity.id,
    patternPreview: pattern.slice(0, 200),
    source: body.source ?? 'Oracle Learn',
    concepts: JSON.stringify(concepts),
    createdAt: now,
    project: body.project?.toLowerCase() ?? null,
  }).run();
  return { status: 200, body: { success: true, file: identity.sourceFile, id: identity.id } };
}
function updateLearning(id: string, body: LearnUpdateBody) {
  const existing = rowById(id);
  if (!existing) return { status: 404, body: { error: 'Learning not found' } };
  const now = Date.now();
  const set: Partial<LearnDoc> = { updatedAt: now, indexedAt: now };
  if (body.sourceFile !== undefined) set.sourceFile = body.sourceFile;
  if (body.concepts !== undefined) set.concepts = JSON.stringify(conceptsFrom(body.concepts));
  if (body.origin !== undefined) set.origin = body.origin;
  if (body.project !== undefined) set.project = body.project?.toLowerCase() ?? null;
  if (body.supersededBy !== undefined) set.supersededBy = body.supersededBy;
  if (body.supersededReason !== undefined) set.supersededReason = body.supersededReason;
  const nextConcepts = body.concepts === undefined ? conceptsFrom(existing.concepts) : conceptsFrom(body.concepts);
  const content = body.pattern?.trim()
    ? learningContent(body.pattern.trim(), nextConcepts)
    : ftsContent(id) ?? learningContent(existing.sourceFile, nextConcepts);
  upsertFts(id, content, nextConcepts);
  const row = db.update(oracleDocuments)
    .set(set)
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.type, 'learning')))
    .returning()
    .get();
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
    .where(and(eq(oracleDocuments.id, id), eq(oracleDocuments.type, 'learning')))
    .returning()
    .get();
  db.delete(oracleFts).where(eq(oracleFts.id, id)).run();
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
