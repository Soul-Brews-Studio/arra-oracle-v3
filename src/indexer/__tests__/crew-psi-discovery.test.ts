/**
 * #2800 (@Anurak112) — crew ψ-brains were never indexed.
 *
 * `ψ/crew/<member>/memory/{learnings,retrospectives,…}` satisfies the same
 * `{dir}/memory/{subdir}` contract as a project-first vault dir, so the existing collector
 * loop can walk it once discovery returns it.
 *
 * Two things these tests pin beyond "does it find the dir":
 *  - the `ORACLE_INDEX_CREW` lever honours more than the literal string "0". A flag that
 *    silently ignores `=false` is the defect class of #2822 / #2846.
 *  - crew documents get a real `project` attribution (`crew/<member>`). Without it every
 *    crew doc falls through to `null`, and the reason for indexing crew brains separately
 *    — knowing whose brain a result came from — is lost.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverCrewPsiDirs, inferProjectFromPath } from '../discovery.ts';

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-crew-'));
const crew = path.join(vault, 'ψ', 'crew');

// Two members with a memory/ brain, one without, and one plain file among them.
fs.mkdirSync(path.join(crew, 'omar', 'memory', 'learnings'), { recursive: true });
fs.mkdirSync(path.join(crew, 'jeera', 'memory', 'retrospectives'), { recursive: true });
fs.mkdirSync(path.join(crew, 'no-brain-yet'), { recursive: true });
fs.writeFileSync(path.join(crew, 'README.md'), '# crew');

const previous = process.env.ORACLE_INDEX_CREW;

afterEach(() => {
  if (previous === undefined) delete process.env.ORACLE_INDEX_CREW;
  else process.env.ORACLE_INDEX_CREW = previous;
});

afterAll(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

function members(): string[] {
  return discoverCrewPsiDirs(vault).map((dir) => path.basename(dir)).sort();
}

describe('discoverCrewPsiDirs', () => {
  test('returns only members that actually have a memory/ brain', () => {
    expect(members()).toEqual(['jeera', 'omar']);
  });

  test('a member directory without memory/ is not returned', () => {
    expect(members()).not.toContain('no-brain-yet');
  });

  test('a plain file under ψ/crew/ is not mistaken for a member', () => {
    expect(members()).not.toContain('README.md');
  });

  test('each returned dir satisfies the {dir}/memory/{subdir} collector contract', () => {
    for (const dir of discoverCrewPsiDirs(vault)) {
      expect(fs.existsSync(path.join(dir, 'memory'))).toBe(true);
    }
  });

  test('a vault with no ψ/crew at all is not an error', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-crew-empty-'));
    try {
      expect(discoverCrewPsiDirs(empty)).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('ORACLE_INDEX_CREW honours every plausible spelling of off', () => {
  test('indexed by default, matching discoverProjectPsiDirs', () => {
    delete process.env.ORACLE_INDEX_CREW;
    expect(members()).toEqual(['jeera', 'omar']);
  });

  for (const value of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) {
    test(`ORACLE_INDEX_CREW=${JSON.stringify(value)} disables it`, () => {
      process.env.ORACLE_INDEX_CREW = value;
      expect(discoverCrewPsiDirs(vault)).toEqual([]);
    });
  }

  for (const value of ['1', 'true', 'on', '']) {
    test(`ORACLE_INDEX_CREW=${JSON.stringify(value)} leaves it enabled`, () => {
      process.env.ORACLE_INDEX_CREW = value;
      expect(members()).toEqual(['jeera', 'omar']);
    });
  }
});

describe('crew documents are attributable to the member', () => {
  test('a crew path infers crew/<member>', () => {
    expect(inferProjectFromPath('ψ/crew/omar/memory/learnings/2026-07-25_a.md')).toBe('crew/omar');
  });

  test('the member name is lowercased like every other project value', () => {
    expect(inferProjectFromPath('ψ/crew/Omar/memory/learnings/a.md')).toBe('crew/omar');
  });

  test('a bare ψ/crew path with no member is not attributed', () => {
    expect(inferProjectFromPath('ψ/crew/README.md')).toBeNull();
  });

  test('existing project inference is unchanged', () => {
    expect(inferProjectFromPath('github.com/acme/app/ψ/memory/learnings/a.md')).toBe('github.com/acme/app');
    expect(inferProjectFromPath('ψ/learn/acme/app/notes.md')).toBe('github.com/acme/app');
    expect(inferProjectFromPath('ψ/memory/learnings/loose.md')).toBeNull();
  });
});
