/**
 * A Thai learning saved over HTTP keeps its title in the filename.
 *
 * `learningSlug` being Unicode-preserving is proved in `tests/util/`. This file proves the
 * part that unit test cannot: that `handleLearn` — the POST /api/learn path — actually
 * calls it. PR #2838 fixed the identical bug in `src/tools/learn.ts` (the MCP path) and
 * touched no other file, so this handler kept a private copy of the old rule for months
 * while the MCP path was green. A helper with no caller is not a fix.
 *
 * Against the pre-change handler these writes produced `<date>_fallback.md` and
 * `<date>_-2.md`: the collision guard (issue #2819) kept them from throwing, and the
 * titles were gone. See PR #2934, salvaged in #3001.
 *
 * Hermetic: ORACLE_DATA_DIR + ORACLE_REPO_ROOT point at tmp dirs, set BEFORE the dynamic
 * import so config.ts module state captures them — same harness as its sibling
 * `learn-slug-collision.test.ts`.
 */

import { describe, it, expect, afterAll } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP_REPO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-nonlatin-repo-'));
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-nonlatin-data-'));

const ORIGINAL_REPO_ROOT = process.env.ORACLE_REPO_ROOT;
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;

process.env.ORACLE_REPO_ROOT = TMP_REPO_ROOT;
process.env.ORACLE_DATA_DIR = TMP_DATA_DIR;

const { resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(path.join(TMP_DATA_DIR, 'oracle.db'));
const { handleLearn } = await import('../handlers.ts');

/** The two patterns from the report, verbatim. */
const PURE_THAI = 'ทดสอบไทยล้วนไม่มีอังกฤษ';
const MIXED = 'ทดสอบ fallback ไทยล้วน';

describe('handleLearn — a non-Latin pattern keeps its title', () => {
  it('a wholly Thai pattern names its file after itself, not `<date>_.md`', () => {
    const res = handleLearn(PURE_THAI);
    expect(res.success).toBe(true);
    expect(res.file).toMatch(new RegExp(`/\\d{4}-\\d{2}-\\d{2}_${PURE_THAI}\\.md$`));
    // The pre-change failure was an EMPTY slug, so pin the shape that produced it.
    expect(res.file).not.toMatch(/_\.md$/);
    expect(fs.existsSync(path.join(TMP_REPO_ROOT, res.file))).toBe(true);
  });

  it('a mixed pattern keeps the Thai instead of only the Latin token', () => {
    // The dangerous case: `fallback` alone looked like a working filename.
    const res = handleLearn(MIXED);
    expect(res.success).toBe(true);
    expect(res.file).toMatch(/_ทดสอบ-fallback-ไทยล้วน\.md$/);
    expect(res.file).not.toMatch(/_fallback\.md$/);
  });

  it('two different Thai patterns get two different names, with no -2 suffix', () => {
    // Both slugged to '' before, so the second was only saved by the collision guard —
    // as `<date>_-2.md`, a filename that says nothing about either learning.
    const first = handleLearn('บันทึกแรกของวันนี้');
    const second = handleLearn('บันทึกที่สองของวันนี้');
    expect(first.file).not.toBe(second.file);
    expect(first.file).not.toMatch(/-2\.md$/);
    expect(second.file).not.toMatch(/-2\.md$/);
  });

  it('the id on the returned row matches the file that was written', () => {
    // The slug is half of the document id too, so a Thai slug must survive into the DB
    // row and the frontmatter, not just onto the filesystem.
    const res = handleLearn('บันทึกภาษาไทยสำหรับ oracle');
    expect(res.id).toContain('บันทึกภาษาไทยสำหรับ-oracle');
    const markdown = fs.readFileSync(path.join(TMP_REPO_ROOT, res.file), 'utf-8');
    // Non-ASCII fails buildLearningMarkdown's bare-scalar test, so it is quoted YAML.
    expect(markdown).toContain(`id: ${JSON.stringify(res.id)}`);
  });

  it('an ASCII pattern is written exactly as it was before', () => {
    const res = handleLearn('deploy checklist for the release');
    expect(res.file).toMatch(/_deploy-checklist-for-the-release\.md$/);
  });

  it('a pattern with NO letters or digits now falls back instead of naming a file `<date>_.md`', () => {
    /**
     * The one deliberate ASCII behaviour change in #3001, pinned so it reads as a decision
     * rather than an accident. This handler had no fallback at all: '!!!' slugged to '' and
     * the file was literally `<date>_.md`, the exact symptom in the report. Routing through
     * `learningSlug` gives it the `|| 'learning'` fallback every other slug site has had
     * since #2838. Any ASCII pattern that produced a NON-empty slug is untouched —
     * `tests/util/slug-ascii-identity.test.ts` proves that exhaustively.
     */
    const res = handleLearn('!!!');
    expect(res.file).toMatch(/_learning\.md$/);
    expect(res.file).not.toMatch(/_\.md$/);
  });
});

afterAll(() => {
  try { fs.rmSync(TMP_REPO_ROOT, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true }); } catch {}
  if (ORIGINAL_REPO_ROOT) process.env.ORACLE_REPO_ROOT = ORIGINAL_REPO_ROOT;
  else delete process.env.ORACLE_REPO_ROOT;
  if (ORIGINAL_DATA_DIR) process.env.ORACLE_DATA_DIR = ORIGINAL_DATA_DIR;
  else delete process.env.ORACLE_DATA_DIR;
});
