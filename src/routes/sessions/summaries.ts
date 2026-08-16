/**
 * Which sessions have been summarised, by whom, and what superseded what.
 *
 * A summary is an ordinary `oracle_document` with `createdBy: 'session_summary'`
 * (`./store.ts:101`), so supersession, tenancy and FTS already apply to it. The only thing
 * missing was a way to *read* that state: the write path has existed for months and the live
 * corpus holds 0 rows, because the only caller would be an AI and the UI had nothing to show.
 *
 * Two details make this non-obvious:
 *
 *  1. **The document id is derived, not stored.** `store.ts` builds it as
 *     `session-summary_<safeSession>` (default tenant) or
 *     `session-summary_<tenant>_<safeSession>`. Rather than re-deriving the tenant here — which
 *     would silently miss summaries written under another tenant — we index every summary
 *     document by its trailing session segment and look up by that. A read that misses a row is
 *     worse than one that scans a small table.
 *  2. **The author is a claim, not an identity.** It is recorded in the document's `source:`
 *     line as `session-summary from <oracle>`. We surface it as `author` and never invent a
 *     value: a summary written without an oracle reports `null`, not `"unknown"`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { REPO_ROOT } from '../../config.ts';
import { db, oracleDocuments } from '../../db/index.ts';

/** Same resolution as `./store.ts:15` — the writer and the reader must agree on the root. */
function repoRoot(): string {
  return process.env.ORACLE_REPO_ROOT || REPO_ROOT;
}

export interface SummaryState {
  sessionId: string;
  documentId: string;
  sourceFile: string;
  author: string | null;
  createdAt: number;
  superseded: boolean;
  supersededBy: string | null;
  supersededAt: number | null;
  supersededReason: string | null;
}

/** Mirrors `store.ts` — the id is derived from this, so the two must agree. */
function safeSegment(value: string, limit: number): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  return normalized.slice(0, limit).replace(/^[._-]+|[._-]+$/g, '');
}

/** `source: session-summary from claude-opus-5` → `claude-opus-5`; absent → null. */
export function authorFromContent(content: string): string | null {
  const match = content.match(/^\s*(?:\*\*Source\*\*:|source:)\s*session-summary(?:\s+from\s+(.+))?\s*$/im);
  const claimed = match?.[1]?.trim();
  return claimed && claimed.length > 0 ? claimed : null;
}

function readContent(sourceFile: string): string {
  try {
    return fs.readFileSync(path.join(repoRoot(), sourceFile), 'utf-8');
  } catch {
    return '';
  }
}

function toState(sessionId: string, row: typeof oracleDocuments.$inferSelect): SummaryState {
  return {
    sessionId,
    documentId: row.id,
    sourceFile: row.sourceFile ?? '',
    author: authorFromContent(readContent(row.sourceFile ?? '')),
    createdAt: row.createdAt ?? 0,
    superseded: Boolean(row.supersededBy),
    supersededBy: row.supersededBy ?? null,
    supersededAt: row.supersededAt ?? null,
    supersededReason: row.supersededReason ?? null,
  };
}

/**
 * Summary state for the given sessions. Sessions with no summary are simply absent from the
 * map — the caller decides how to render "not summarised yet", which is the common case.
 */
export function summaryStates(sessionIds: string[]): Map<string, SummaryState> {
  const out = new Map<string, SummaryState>();
  if (sessionIds.length === 0) return out;

  const rows = db.select().from(oracleDocuments)
    .where(eq(oracleDocuments.createdBy, 'session_summary')).all();
  if (rows.length === 0) return out;

  // index by trailing session segment so a tenant prefix cannot hide a row
  const byTail = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const tail = row.id.replace(/^session-summary_/, '').split('_').pop();
    if (tail) byTail.set(tail, row);
  }

  for (const sessionId of sessionIds) {
    const row = byTail.get(safeSegment(sessionId, 120));
    if (row) out.set(sessionId, toState(sessionId, row));
  }
  return out;
}

/**
 * The prose a person came to read, without the storage wrapper.
 *
 * `buildLearningMarkdown` writes ~15 lines of frontmatter, then an `# H1` that is the summary's
 * own first line truncated mid-sentence by `firstSummaryLine`, then the summary, then a footer.
 * Rendering the file raw shows the reader a hash and an `arra_concepts` array before it shows
 * them a sentence, and repeats a broken version of that sentence as a heading. So we return both:
 * `text` for display, `content` for anyone who wants the document exactly as stored.
 */
export function summaryProse(content: string): string {
  const withoutFrontmatter = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const withoutFooter = withoutFrontmatter.replace(/\r?\n---\r?\n\*[^\n]*\*\s*$/, '');
  const withoutHeading = withoutFooter.replace(/^\s*#\s+[^\n]*\r?\n+/, '');
  return withoutHeading.trim();
}

/** One session's summary, with the text — for the detail view. */
export function summaryDetail(
  sessionId: string,
): (SummaryState & { content: string; text: string }) | null {
  const state = summaryStates([sessionId]).get(sessionId);
  if (!state) return null;
  const content = readContent(state.sourceFile);
  return { ...state, content, text: summaryProse(content) };
}
