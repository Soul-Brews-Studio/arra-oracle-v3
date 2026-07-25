import { Elysia } from 'elysia';
import { and, count, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
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

export const DEFAULT_LEARN_LIMIT = 50;
export const MAX_LEARN_LIMIT = 500;

/** Blank/absent means "not supplied" — `Number('')` is 0, which is finite. */
function numeric(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clampLimit(raw: unknown): number {
  const n = numeric(raw);
  if (n === null) return DEFAULT_LEARN_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_LEARN_LIMIT);
}

export function clampOffset(raw: unknown): number {
  const n = numeric(raw);
  if (n === null || n < 0) return 0;
  return Math.trunc(n);
}

function learnEntry(row: LearnDoc & { ftsContent: string | null }) {
  const content = row.ftsContent ?? '';
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

function learnFilters(): SQL[] {
  const filters: SQL[] = [eq(oracleDocuments.type, 'learning'), isNull(oracleDocuments.supersededAt)];
  const tenantId = currentTenantId();
  if (tenantId) filters.push(eq(oracleDocuments.tenantId, tenantId));
  return filters;
}

/**
 * Content for a page of ids, in ONE query.
 *
 * `oracle_fts` is an FTS5 virtual table whose `id` column is UNINDEXED, so any
 * lookup by id costs a full scan of the FTS content (~20ms here). The shape that
 * matters is therefore *how many scans*, not how many rows come back:
 *
 *   per-row `WHERE id = ?`   17,500 scans  ≈ 350s   (the original — a wedged server)
 *   LEFT JOIN on f.id = d.id  did not finish in 2 minutes even with LIMIT 50
 *   `WHERE id IN (…50 ids)`   ONE scan     ≈ 25ms   ← this
 *
 * Measured against the reference corpus (35,179 docs / 17,500 learnings).
 */
function contentByIds(ids: string[]): Map<string, string> {
  if (ids.length === 0) return new Map();
  const rows = db.select({ id: oracleFts.id, content: oracleFts.content })
    .from(oracleFts)
    .where(inArray(oracleFts.id, ids))
    .all();
  return new Map(rows.flatMap((row) => (row.id ? [[row.id, row.content ?? '']] as const : [])));
}

/**
 * Paginated listing: page the real (indexed) table first, then fetch content for
 * just that page. Never touches the FTS table more than once per request.
 *
 * The previous version selected EVERY matching row with no LIMIT and then issued
 * one further synchronous FTS query per row. On the reference corpus that is
 * ~17,500 full scans in a single request on Elysia's one event loop — it pinned
 * the server at 100% CPU indefinitely, so a plain GET was a denial of service.
 */
export function listLearnEntries(limit = DEFAULT_LEARN_LIMIT, offset = 0) {
  const filters = learnFilters();
  const rows = db.select().from(oracleDocuments)
    .where(and(...filters))
    .orderBy(desc(oracleDocuments.updatedAt))
    .limit(limit)
    .offset(offset)
    .all();

  const contents = contentByIds(rows.map((row) => row.id));
  const total = db.select({ value: count() })
    .from(oracleDocuments)
    .where(and(...filters))
    .get()?.value ?? 0;

  return {
    items: rows.map((row) => learnEntry({ ...row, ftsContent: contents.get(row.id) ?? '' })),
    total,
    limit,
    offset,
  };
}

export function createLearnListRoutes() {
  return new Elysia().get(
    '/learn',
    ({ query }) => listLearnEntries(clampLimit(query?.limit), clampOffset(query?.offset)),
    {
      detail: {
        tags: ['knowledge'],
        menu: { group: 'main', label: 'Learn', order: 35 },
        summary: 'List learn entries (paginated)',
      },
    },
  );
}

export const learnListRoutes = createLearnListRoutes();
