/**
 * The MCP write path for session summaries.
 *
 * The route it wraps had zero rows in the live corpus despite being mounted and working — the
 * only plausible caller is an AI, and an AI arrives over MCP, where no tool existed. These tests
 * pin the three things that make the tool trustworthy rather than merely present: it writes a real
 * document, it refuses to record an unattributed author, and a second summary is reported as a
 * supersession decision rather than an opaque filesystem error.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'session-summarize-'));
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;
const ORIGINAL_REPO_ROOT = process.env.ORACLE_REPO_ROOT;
const ctx = {} as Parameters<typeof import('../session-summary.ts').handleSessionSummarize>[0];

beforeAll(() => {
  process.env.ORACLE_DATA_DIR = TMP;
  process.env.ORACLE_REPO_ROOT = TMP;
});

afterAll(() => {
  if (ORIGINAL_DATA_DIR) process.env.ORACLE_DATA_DIR = ORIGINAL_DATA_DIR;
  else delete process.env.ORACLE_DATA_DIR;
  if (ORIGINAL_REPO_ROOT) process.env.ORACLE_REPO_ROOT = ORIGINAL_REPO_ROOT;
  else delete process.env.ORACLE_REPO_ROOT;
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0]!.text);

describe('oracle_session_summarize', () => {
  test('writes a summary and returns the document it created', async () => {
    const { handleSessionSummarize } = await import('../session-summary.ts');
    const sessionId = `sess-${Date.now()}`;

    const res = await handleSessionSummarize(ctx, {
      sessionId,
      summary: 'Chose two database files because the indexer backs up the whole DB each run.',
      author: 'claude-opus-5',
    });

    const body = parse(res);
    expect(res.isError).toBeUndefined();
    expect(body.success).toBe(true);
    expect(body.sessionId).toBe(sessionId);
    expect(body.author).toBe('claude-opus-5');
    expect(body.documentId).toContain(sessionId);
    expect(body.sourceFile).toContain(sessionId);
  });

  test('the summary is a real, retrievable oracle_document — not just a file', async () => {
    const { handleSessionSummarize } = await import('../session-summary.ts');
    const { db, oracleDocuments } = await import('../../db/index.ts');
    const { eq } = await import('drizzle-orm');
    const sessionId = `sess-doc-${Date.now()}`;

    const body = parse(await handleSessionSummarize(ctx, {
      sessionId, summary: 'A durable summary.', author: 'claude-sonnet-5',
    }));

    const row = db.select().from(oracleDocuments).where(eq(oracleDocuments.id, body.documentId)).get();
    expect(row).toBeDefined();
    // createdBy marks the write path; the claimed author lives in the document body.
    expect(row!.createdBy).toBe('session_summary');
    expect(row!.supersededBy).toBeNull();   // a fresh summary is the live one
  });

  test('refuses an unattributed summary rather than recording "unknown"', async () => {
    const { handleSessionSummarize } = await import('../session-summary.ts');
    const res = await handleSessionSummarize(ctx, {
      sessionId: `sess-anon-${Date.now()}`,
      summary: 'Who wrote this?',
    });
    expect(res.isError).toBe(true);
    expect(parse(res).error).toContain('author');
  });

  test('a second summary is a supersession decision, not an opaque error', async () => {
    const { handleSessionSummarize } = await import('../session-summary.ts');
    const sessionId = `sess-dup-${Date.now()}`;
    const first = await handleSessionSummarize(ctx, { sessionId, summary: 'First.', author: 'a' });
    expect(parse(first).success).toBe(true);

    const second = await handleSessionSummarize(ctx, { sessionId, summary: 'Second.', author: 'b' });
    const body = parse(second);
    expect(second.isError).toBe(true);
    expect(body.error).toContain('already exists');
    // the caller is told what to do, not just what failed
    expect(body.hint).toContain('supersede');
  });

  test('missing sessionId and summary are rejected before any write', async () => {
    const { handleSessionSummarize } = await import('../session-summary.ts');
    expect(parse(await handleSessionSummarize(ctx, { summary: 'x', author: 'a' })).error).toContain('sessionId');
    expect(parse(await handleSessionSummarize(ctx, { sessionId: 's', author: 'a' })).error).toContain('summary');
  });
});
