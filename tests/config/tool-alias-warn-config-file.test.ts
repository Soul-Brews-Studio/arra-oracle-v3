import { afterAll, beforeEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadToolGroupConfig } from '../../src/config/tool-groups.ts';
import { resetAliasWarnings } from '../../src/config/tool-alias-warn.ts';

// A repo-root arra.config.json wins resolution outright (first match wins), so
// seeding one here keeps this test off both the developer's global config and
// the real repo's. Read-only either way — nothing below writes config.
const tempRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-alias-cfg-'));
const repoConfig = path.join(tempRepo, 'arra.config.json');

afterAll(() => {
  fs.rmSync(tempRepo, { recursive: true });
});

beforeEach(() => {
  resetAliasWarnings();
});

function seed(config: Record<string, unknown>): void {
  fs.writeFileSync(repoConfig, JSON.stringify(config) + '\n');
}

/** Load the seeded config `times` over, returning only the deprecation lines. */
function loadCapturingWarnings(times = 1): { warnings: string[]; last: ReturnType<typeof loadToolGroupConfig> } {
  const lines: string[] = [];
  const real = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    let last = loadToolGroupConfig(tempRepo);
    for (let i = 1; i < times; i += 1) last = loadToolGroupConfig(tempRepo);
    // Matches both dialects from the single source: 'is deprecated' and 'was REMOVED'.
    const notice = (line: string) => line.includes('is deprecated') || line.includes('was REMOVED');
    return { warnings: lines.filter(notice), last };
  } finally {
    console.error = real;
  }
}

test('a muninn_ entry in arra.config.json is reported as REMOVED and no longer resolves', () => {
  // #2824: the prefix completed its deprecation cycle. A config file still naming it gets a
  // notice on every distinct entry — going silent here would leave the operator with a config
  // that quietly selects nothing.
  seed({ enabled_tools: ['muninn_search'], disabled_tools: ['muninn_read'] });
  const { warnings, last } = loadCapturingWarnings();

  // Order is incidental (mergeRaw happens to read disabled_tools first).
  expect(warnings).toHaveLength(2);
  expect(warnings.join(' ')).toContain('oracle_search');
  expect(warnings.join(' ')).toContain('oracle_read');
  expect(warnings.every((line) => line.includes('was REMOVED'))).toBe(true);

  // Unresolved: the names stay as written, so they match no known tool.
  expect(last.enabled_tools).toEqual(['muninn_search']);
  expect(last.disabled_tools).toEqual(['muninn_read']);
});

test('repeated loads do NOT re-warn — the watcher polls this path 10x/sec', () => {
  seed({ enabled_tools: ['muninn_search'] });

  // 20 loads stands in for two seconds of tool-groups-watch.ts polling. Without
  // the once-guard this is 20 lines, and a long-running server emits ~864k/day.
  const { warnings, last } = loadCapturingWarnings(20);
  expect(warnings).toHaveLength(1);
  expect(last.enabled_tools).toEqual(['muninn_search']);
});

test('an arra_ entry in arra.config.json resolves silently — arra_ is not deprecated', () => {
  seed({ enabled_tools: ['arra_read'] });
  const { warnings, last } = loadCapturingWarnings();

  expect(warnings).toEqual([]);
  expect(last.enabled_tools).toEqual(['oracle_read']);
});

test('canonical oracle_ names never warn', () => {
  seed({ enabled_tools: ['oracle_search'], disabled_tools: ['oracle_read'] });
  expect(loadCapturingWarnings().warnings).toEqual([]);
});

test('resetAliasWarnings clears the guard, so the notice can be observed again', () => {
  seed({ enabled_tools: ['muninn_search'] });
  expect(loadCapturingWarnings().warnings).toHaveLength(1);
  expect(loadCapturingWarnings().warnings).toHaveLength(0);

  resetAliasWarnings();
  expect(loadCapturingWarnings().warnings).toHaveLength(1);
});
