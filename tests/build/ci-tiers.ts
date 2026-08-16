/**
 * Shared reading of the two CI tiers, for the pair of ratchets that guard them:
 * `ci-covers-the-suite.test.ts` (the union of the tiers is the whole suite) and
 * `ci-tier-contract.test.ts` (each tier runs it the way the docs say).
 *
 * Not a `*.test.ts`, so bun's runner does not pick it up as a test file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..', '..');
export const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8');

export const TIER1 = read('.github/workflows/test.yml');
export const TIER2 = read('.github/workflows/nightly.yml');
export const TAURI = read('.github/workflows/tauri.yml');
export const CLAUDE_MD = read('CLAUDE.md');

/**
 * The raw entries a workflow's `for group in ... do` loop passes to `bun test`, trailing
 * slash preserved — the slash is load-bearing and asserted by the contract ratchet.
 */
export function loopEntries(workflow: string): string[] {
  // Split on the shell keyword `do` at the start of its own line — a bare `.split('do')`
  // truncates the list at `tests/docs`, which contains the substring. That mistake reported
  // 20 phantom uncovered groups on the first run of this very ratchet.
  const after = workflow.split('for group in')[1] ?? '';
  const block = after.split(/\n\s*do\b/)[0] ?? '';
  return block
    .replace(/\\\s*\n/g, ' ')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('src') || entry.startsWith('tests'));
}

/**
 * Just the `on:` block — from the top-level `on:` to the next top-level key, comments
 * stripped.
 *
 * Asserting a trigger with a whole-file `toContain('pull_request')` cannot tell a trigger
 * from prose: nightly.yml's header says "there is deliberately no `pull_request:` trigger",
 * and that sentence alone failed the check on its first run. The comment is the part most
 * likely to survive a careless edit, so the assertion has to read the config.
 */
export function triggerBlock(workflow: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^on:/.test(line));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** `tests/http/menu/` -> `tests/http`; `src/integration/` -> `src`. */
export function groupOf(entry: string): string {
  const parts = entry.replace(/\/$/, '').split('/');
  return parts[0] === 'src' ? 'src' : `${parts[0]}/${parts[1]}`;
}

/** An entry that runs only PART of its group, e.g. `tests/http/menu/`. */
export function isPartial(entry: string): boolean {
  return entry.replace(/\/$/, '') !== groupOf(entry);
}

export const tier1Entries = loopEntries(TIER1);
export const tier2Entries = loopEntries(TIER2);
export const tier1Whole = new Set(tier1Entries.filter((e) => !isPartial(e)).map(groupOf));
export const tier2Whole = new Set(tier2Entries.filter((e) => !isPartial(e)).map(groupOf));
export const covered = new Set([...tier1Entries, ...tier2Entries].map(groupOf));

/**
 * Top-level groups that actually contain test files, from git — not from a glob, so
 * .gitignore is respected and an untracked scratch file cannot fail the gate.
 *
 * `Bun.spawnSync` rather than the `$` shell helper: the shell form took over 5 s on the CI
 * runner and tripped bun's default per-test timeout, failing this gate for a reason that had
 * nothing to do with coverage.
 */
function trackedGroups(pattern: RegExp): string[] {
  const proc = Bun.spawnSync(['git', '-C', ROOT, 'ls-files'], { stdout: 'pipe' });
  const tracked = new TextDecoder().decode(proc.stdout).split('\n');
  const groups = new Set<string>();
  for (const file of tracked) {
    if (!pattern.test(file)) continue;
    if (file.startsWith('agents/')) continue;
    const parts = file.split('/');
    if (parts[0] === 'tests') groups.add(`tests/${parts[1]}`);
    else if (parts[0] === 'src') groups.add('src');
  }
  return [...groups];
}

/** Groups holding bun tests. */
export const suiteGroups = (): string[] => trackedGroups(/\.test\.tsx?$/);
/** Groups holding Playwright specs — invisible to bun, so covered by a script instead. */
export const specGroups = (): string[] => trackedGroups(/\.spec\.ts$/);
