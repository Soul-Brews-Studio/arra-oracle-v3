/**
 * #2803 (@tenzaitech) — `vault:migrate` swept all of `ψ/inbox/` into the shared vault.
 *
 * `ψ/inbox/` is fleet comms: messages addressed to this oracle. Copying it made one house's
 * unread mail part of another house's knowledge corpus. `migrate.ts` already imported
 * `isProjectCategory`, but used it only to decide whether to inject frontmatter — the copy
 * loop still took everything the walker returned.
 *
 * The carve-out that ships here is NOT "skip ψ/inbox except handoff/", which is the shape the
 * report proposed. `path-mapping.ts` lists `ψ/inbox/schedule.md` and
 * `ψ/inbox/focus-agent-main.md` in UNIVERSAL_CATEGORIES and maps them to the vault root on
 * purpose, so that shape would silently drop two files the vault is supposed to hold. The
 * final two tests below are the ones that catch that mistake.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { migratableFiles } from '../migrate.ts';
import { belongsInVault } from '../path-mapping.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vault-inbox-'));
const psi = path.join(root, 'ψ');

function put(relative: string, body = 'x'): void {
  const full = path.join(psi, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

put('memory/learnings/2026-07-25_lesson.md', '# lesson');
put('inbox/handoff/2026-07-25_19-51_handoff.md', '# handoff');
put('inbox/schedule.md', '# schedule');
put('inbox/focus-agent-main.md', '# focus');
put('inbox/2026-07-25_report-from-jan.md', '# a message, not knowledge');
put('inbox/tracks/INDEX.md', '# tracks');
put('memory/.gitkeep', '');

const copied = migratableFiles(psi, root).map((file) => file.relativePath).sort();

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('migrate skips fleet comms but keeps declared vault categories', () => {
  test('a message addressed to this oracle is not copied', () => {
    expect(copied).not.toContain('ψ/inbox/2026-07-25_report-from-jan.md');
  });

  test('an inbox subtree that is not a declared category is not copied', () => {
    expect(copied).not.toContain('ψ/inbox/tracks/INDEX.md');
  });

  test('handoffs are copied — they are a PROJECT_CATEGORY', () => {
    expect(copied).toContain('ψ/inbox/handoff/2026-07-25_19-51_handoff.md');
  });

  test('ψ/inbox/schedule.md survives — UNIVERSAL_CATEGORIES declares it vault-bound', () => {
    expect(copied).toContain('ψ/inbox/schedule.md');
  });

  test('ψ/inbox/focus-agent-main.md survives for the same reason', () => {
    expect(copied).toContain('ψ/inbox/focus-agent-main.md');
  });

  test('.gitkeep is still skipped', () => {
    expect(copied).not.toContain('ψ/memory/.gitkeep');
  });

  test('the exact copy set, so no leak passes by matching a count', () => {
    expect(copied).toEqual([
      'ψ/inbox/focus-agent-main.md',
      'ψ/inbox/handoff/2026-07-25_19-51_handoff.md',
      'ψ/inbox/schedule.md',
      'ψ/memory/learnings/2026-07-25_lesson.md',
    ]);
  });
});

describe('belongsInVault reads its answer off the category declarations', () => {
  test('non-inbox knowledge is unconditionally vault-bound', () => {
    expect(belongsInVault('ψ/memory/retrospectives/2026-07/25/20.00_r.md')).toBe(true);
    expect(belongsInVault('ψ/writing/draft.md')).toBe(true);
  });

  test('bare inbox files are not', () => {
    expect(belongsInVault('ψ/inbox/anything.md')).toBe(false);
    expect(belongsInVault('ψ/inbox/nested/deep/thing.md')).toBe(false);
  });

  test('a path with backslashes still resolves — normalisation happens first', () => {
    // The private walker this replaced did not normalise separators, so a prefix test
    // against 'ψ/inbox/handoff/' could not have matched on a platform using '\'.
    expect(belongsInVault('ψ\\inbox\\handoff\\x.md')).toBe(true);
  });

  test('traversal is rejected rather than silently mapped', () => {
    expect(() => belongsInVault('ψ/inbox/../../../etc/passwd')).toThrow();
  });
});
