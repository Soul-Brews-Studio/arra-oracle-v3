import { Elysia } from 'elysia';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { db, oracleDocuments } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';

type LearnDoc = typeof oracleDocuments.$inferSelect;

const oracleFts = sqliteTable('oracle_fts', {
  id: text('id'),
  content: text('content'),
  concepts: text('concepts'),
});

function conceptsFrom(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return value.split(',').map((concept) => concept.trim()).filter(Boolean);
}

function titleFrom(content: string, row: LearnDoc): string {
  const frontmatter = content.match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (frontmatter) return frontmatter;
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return row.sourceFile.split('/').pop()?.replace(/\.md$/, '') || row.id;
}

function displayContentFrom(content: string, title: string): string {
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n+/, '');
  const withoutHeading = withoutFrontmatter.replace(/^#\s+.+\n+/, '');
  const withoutFooter = withoutHeading.replace(/\n---\n\*Added via Oracle Learn\*\s*$/, '');
  const display = withoutFooter.trim();
  return display.startsWith(`${title}\n\n`) ? display.slice(title.length).trim() : display || content;
}

function contentById(id: string): string {
  return db.select({ content: oracleFts.content })
    .from(oracleFts)
    .where(eq(oracleFts.id, id))
    .get()?.content ?? '';
}

function learnEntry(row: LearnDoc) {
  const content = contentById(row.id);
  const title = titleFrom(content, row);
  return {
    id: row.id,
    title,
    content: displayContentFrom(content, title),
    concepts: conceptsFrom(row.concepts),
    sourceFile: row.sourceFile,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    origin: row.origin,
    project: row.project,
  };
}

function listLearnEntries() {
  const filters: SQL[] = [eq(oracleDocuments.type, 'learning'), isNull(oracleDocuments.supersededAt)];
  const tenantId = currentTenantId();
  if (tenantId) filters.push(eq(oracleDocuments.tenantId, tenantId));
  const rows = db.select().from(oracleDocuments)
    .where(and(...filters))
    .orderBy(desc(oracleDocuments.updatedAt))
    .all();
  const items = rows.map(learnEntry);
  return { items, total: items.length };
}

export function createLearnListRoutes() {
  return new Elysia().get('/learn', () => listLearnEntries(), {
    detail: { tags: ['knowledge'], menu: { group: 'main', label: 'Learn', order: 35 }, summary: 'List learn entries' },
  });
}

export const learnListRoutes = createLearnListRoutes();
