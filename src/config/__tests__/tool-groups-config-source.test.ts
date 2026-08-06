/**
 * Where `loadToolGroupConfig` reads from — the file-resolution tier, not the
 * group algebra (that lives in tool-groups.test.ts).
 *
 * Resolution is FIRST-MATCH-WINS across four locations: two under the repo root,
 * then two under the global data dir. That last tier is the trap these tests
 * exist for: passing a nonexistent repoRoot does NOT isolate a test, because the
 * lookup falls through to the developer's own ~/.arra-oracle-v2/config.json.
 */
import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadToolGroupConfig } from '../tool-groups.ts';

describe('tool-groups config source', () => {
  it('defaults to all groups enabled', () => {
    // A nonexistent repoRoot is NOT isolation: the lookup is first-match-wins and
    // falls through to the DEVELOPER'S OWN ~/.arra-oracle-v2/config.json. This
    // passed for years only because that file had no `tools` key — the day one
    // was added it went red on pristine alpha with nothing in the diff to explain it.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-defaults-'));
    const config = loadToolGroupConfig('/nonexistent/path', empty);
    expect(config.search).toBe(true);
    expect(config.knowledge).toBe(true);
    expect(config.session).toBe(true);
    expect(config.forum).toBe(true);
    expect(config.oracle).toBe(true);
    expect(config.trace).toBe(true);
    expect(config.mcp).toBe(true);
  });

  it('reads the injected data dir, never the developer machine config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-isolation-'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ tools: { forum: false } }));
    const config = loadToolGroupConfig('/nonexistent/path', dir);
    expect(config.forum).toBe(false);
    expect(config.search).toBe(true);
  });

});
