/**
 * Behaviour: maw-plugin's advertised MCP verb enum equals the verb set its
 * runtime guard actually accepts.
 *
 * This is the "19 of 40 `tool:` fields named MCP tools that never existed" bug
 * class, caught at the manifest boundary: the manifest promises a vocabulary,
 * the runtime enforces one, and nothing today makes them agree.
 *
 * WHY THIS IS NAMED FOR ONE PLUGIN INSTEAD OF LOOPED OVER THE CORPUS
 * ------------------------------------------------------------------
 * Measured 2026-07-25 over all 30 shipped manifests: exactly ONE declares a
 * command-enum verb vocabulary (maw-plugin, 25 verbs), and ZERO declare more
 * than one cliSubcommand. A generic per-plugin loop with `cliOnly`/`writeVerbs`
 * annotation machinery would be ~60% of the suite operating on a corpus of one,
 * and would require hand-annotating 29 manifests with empty arrays to stay
 * green. Worse, the write information already exists in code as `spec.write` in
 * the COMMANDS table — copying it into JSON creates the second source of truth
 * this suite exists to detect. So: no annotation, no `surfaces`, no `cliOnly`,
 * no `writeVerbs`. When a second plugin grows a verb enum, generalise then.
 *
 * WHY IT IMPORTS MCP_COMMANDS INSTEAD OF RE-DERIVING IT
 * -----------------------------------------------------
 * The allowlist is built at maw-plugin/index.ts:181 and enforced at :241:
 *
 *   :241  if (ctx.source === 'mcp' && args.length && !MCP_COMMANDS.has(key(args[0])))
 *           return { ok: false, error: 'MCP surface exposes read-only commands only' };
 *
 * Re-implementing the `!spec.write && spec.method === 'GET'` filter in this file
 * would mean the test keeps passing when the real filter changes — precisely the
 * drift it is supposed to catch. `MCP_COMMANDS` was therefore given an `export`
 * keyword (a zero-line edit; maw-plugin/index.ts sits at 249 of its 250-line
 * budget, so nothing else would fit). The behavioural alternative — driving the
 * exported default handler with `ctx.source: 'mcp'` across all 68 verbs — was
 * measured at ~15s because each accepted verb races a 250ms network timeout.
 * Too slow for a unit test, and it proves the same thing.
 *
 * EDITING maw-plugin/index.ts AT ALL INVALIDATES A SUPPLY-CHAIN HASH
 * ------------------------------------------------------------------
 * maw-plugin/plugin.json carries `artifact: { path: './index.ts', sha256 }`, and
 * maw-plugin/__tests__/manifest.test.ts:32 re-hashes the file and compares. So
 * even a one-keyword edit turns that test red until the recorded hash is
 * updated. Adding `export` here cost exactly that: verified 41 pass/1 fail
 * before, 40/2 after, back to 41/1 once the sha256 was corrected to the file's
 * true digest. That record is hand-maintained — maw-plugin/scripts/build.ts:103
 * only computes a hash for the DIST manifest (`./index.js`), never for the
 * source one. If you touch index.ts, re-run `shasum -a 256 maw-plugin/index.ts`
 * and update plugin.json.
 *
 * A NOTE ON `scan`, WHICH THIS TEST DELIBERATELY DOES NOT FAIL ON
 * ---------------------------------------------------------------
 * `scan` is a non-write command (index.ts:142 declares no `write: true`) that is
 * nonetheless absent from the MCP surface, because the filter at :181 keys on
 * `spec.method === 'GET'` and `scan` is a POST. That is a read verb dropped by
 * TRANSPORT rather than by intent. The manifest honestly mirrors the runtime, so
 * parity holds and this test passes. Whether `scan` SHOULD be reachable over MCP
 * is a product decision about the filter at :181 — it is recorded here so the
 * observation is not lost, but a conformance test must not silently legislate it.
 */
import { describe, expect, test } from 'bun:test';
import { MCP_COMMANDS } from '../../maw-plugin/index.ts';
import { commandEnum, key, loadCorpus } from './_manifest-corpus.ts';

const MANIFEST_PATH = 'maw-plugin/plugin.json';

async function manifestVerbs(): Promise<string[]> {
  const { ok } = await loadCorpus();
  const entry = ok.find(({ path }) => path === MANIFEST_PATH);
  if (!entry) throw new Error(`${MANIFEST_PATH} missing from the manifest corpus`);
  return entry.manifest.mcpTools.flatMap(commandEnum).map(key);
}

describe('maw-plugin mcp verb parity', () => {
  test('every advertised verb is accepted by the runtime MCP guard', async () => {
    const advertised = await manifestVerbs();
    expect(advertised.filter((verb) => !MCP_COMMANDS.has(verb))).toEqual([]);
  });

  test('every verb the runtime MCP guard accepts is advertised', async () => {
    const advertised = new Set(await manifestVerbs());
    expect([...MCP_COMMANDS].filter((verb) => !advertised.has(verb)).sort()).toEqual([]);
  });

  test('the advertised enum has no duplicates', async () => {
    const advertised = await manifestVerbs();
    expect(advertised.length).toBe(new Set(advertised).size);
  });
});
