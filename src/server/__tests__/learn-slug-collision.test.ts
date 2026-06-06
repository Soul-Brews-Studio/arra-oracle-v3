/**
 * Regression test — POST /api/learn slug collision must NOT 500.
 *
 * Bug: when two patterns share the same first-50-char prefix on the same
 * day, the slug+filename collide. The pre-fix handler bubbled the
 * "File already exists" throw from persistLearningDoc up to the Elysia
 * try/catch and returned HTTP 500.
 *
 * Fix: handleLearn appends `-2`, `-3`, … to the slug until the target
 * filename is unique. Second write succeeds with the suffixed slug.
 *
 * Hermetic: ORACLE_DATA_DIR + ORACLE_REPO_ROOT point at tmp dirs, set
 * BEFORE the dynamic import so config.ts module state captures them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP_REPO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-collision-repo-'));
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-collision-data-'));

const ORIGINAL_REPO_ROOT = process.env.ORACLE_REPO_ROOT;
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;
const ORIGINAL_DB_PATH = process.env.ORACLE_DB_PATH;

process.env.ORACLE_REPO_ROOT = TMP_REPO_ROOT;
process.env.ORACLE_DATA_DIR = TMP_DATA_DIR;

// Dynamic imports after env is set; reset DB in case raw bun test imported db earlier.
const { resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(path.join(TMP_DATA_DIR, 'oracle.db'));
const { handleLearn } = await import('../handlers.ts');

describe('handleLearn — slug collision', () => {
  // Slug is built from pattern.substring(0, 50). Use a 50-char prefix so any
  // tail variation does NOT affect the slug — that's exactly the collision
  // case reproduced in prod (different hot-write bodies, identical first
  // line, same generated slug).
  // Length check: 50 chars exactly.
  const PATTERN_PREFIX = 'collision test pattern shared first line very long';
  const EXPECTED_SLUG = 'collision-test-pattern-shared-first-line-very-long';

  it('first write succeeds with the bare slug', () => {
    const res = handleLearn(`${PATTERN_PREFIX}\nbody one`);
    expect(res.success).toBe(true);
    expect(res.file).toMatch(new RegExp(`ψ/memory/learnings/\\d{4}-\\d{2}-\\d{2}_${EXPECTED_SLUG}\\.md$`));
    expect(fs.existsSync(path.join(TMP_REPO_ROOT, res.file))).toBe(true);
  });

  it('second write with the SAME slug-producing prefix gets a -2 suffix (no 500)', () => {
    const res = handleLearn(`${PATTERN_PREFIX}\nbody two`);
    expect(res.success).toBe(true);
    expect(res.file).toMatch(new RegExp(`_${EXPECTED_SLUG}-2\\.md$`));
    expect(res.id).toMatch(/-2$/);
    expect(fs.existsSync(path.join(TMP_REPO_ROOT, res.file))).toBe(true);
  });

  it('third write bumps to -3', () => {
    const res = handleLearn(`${PATTERN_PREFIX}\nbody three`);
    expect(res.success).toBe(true);
    expect(res.file).toMatch(new RegExp(`_${EXPECTED_SLUG}-3\\.md$`));
    expect(res.id).toMatch(/-3$/);
  });

  it('unrelated pattern still uses bare slug', () => {
    const res = handleLearn('completely different pattern with own slug');
    expect(res.success).toBe(true);
    expect(res.file).toMatch(/_completely-different-pattern-with-own-slug\.md$/);
  });
});

afterAll(() => {
  try { fs.rmSync(TMP_REPO_ROOT, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true }); } catch {}
  if (ORIGINAL_REPO_ROOT) process.env.ORACLE_REPO_ROOT = ORIGINAL_REPO_ROOT;
  else delete process.env.ORACLE_REPO_ROOT;
  if (ORIGINAL_DATA_DIR) process.env.ORACLE_DATA_DIR = ORIGINAL_DATA_DIR;
  else delete process.env.ORACLE_DATA_DIR;
  if (ORIGINAL_DB_PATH) process.env.ORACLE_DB_PATH = ORIGINAL_DB_PATH;
  else delete process.env.ORACLE_DB_PATH;
  resetDefaultDatabaseForTests();
});
