/**
 * Behaviour: a tool's `readOnly` declaration matches what the tool actually does.
 *
 * WHY THIS IS NOT `expect(tool.readOnly).toBe(true)` — READ BEFORE EDITING
 * ------------------------------------------------------------------------
 * An early draft asserted `readOnly === true` on EVERY mcpTool. That took
 * arra's own design stance (its MCP surface exposes a read-only subset) and
 * imposed it on all plugins. src/plugins/oracle-dig/plugin.json failed, and it
 * failed CORRECTLY: `oracle_dig` is genuinely `readOnly: false` — "Store a
 * relationship finding with typed provenance evidence" writes to the DB.
 *
 * Keeping that assertion would have forced oracle-dig's manifest to declare
 * `readOnly: true` on a tool that writes, purely to turn the suite green. That
 * is not a cosmetic lie. `readOnly` is load-bearing at two places in
 * src/mcp/server.ts:
 *
 *   :188  .filter((tool) => !this.readOnly || tool.readOnly !== false)
 *   :207  if (this.readOnly && tool.readOnly === false) { ... }
 *
 * so flipping oracle_dig to `readOnly: true` would let a DB-writing tool survive
 * the ORACLE_READ_ONLY filter and stay callable. A live security regression,
 * manufactured by a test. (That enforcement path is already covered by
 * tests/mcp/server-available-tools-readonly-filter.test.ts — this file guards
 * the manifest side of the same contract.)
 *
 * Rule that follows: never mandate a VALUE for `readOnly`; check the value is
 * true to reality.
 *
 * WHY OMISSION IS NOT GOOD ENOUGH FOR A MUTATING TOOL
 * ---------------------------------------------------
 * Read :188 again. In read-only mode a tool is KEPT unless `readOnly === false`.
 * So omitting the field means "exposed under ORACLE_READ_ONLY" — the permissive
 * default, chosen silently. A tool that declares a mutation must therefore carry
 * an EXPLICIT `readOnly: false`; "not true" is not sufficient. This is the
 * assertion with teeth: it makes oracle_dig's `readOnly: false` mandatory rather
 * than merely tolerated, and it catches the next write-tool whose author forgets
 * the field.
 *
 * ON THE VERB LIST
 * ----------------
 * Deliberately conservative and word-boundary matched. A false positive here
 * would push someone to declare `readOnly: false` on a genuine read tool, which
 * at :188 HIDES that tool in read-only mode — the same class of harm, mirrored.
 * So ambiguous words are excluded on purpose: `set` (too common), `record` and
 * `register` (noun/adjective in "provenance record", "Inspect registered canvas
 * plugin metadata" — the latter is a real description in this corpus and must
 * not match). If a legitimately read-only tool ever trips this check, reword the
 * description rather than weakening the check: the description is what an agent
 * reads to decide whether calling the tool is safe, so a description that reads
 * as a mutation is itself the defect.
 */
import { describe, expect, test } from 'bun:test';
import { allMcpTools, loadCorpus } from './_manifest-corpus.ts';

const MUTATING_VERB =
  /\b(stores?|writes?|creates?|deletes?|removes?|updates?|inserts?|upserts?|modify|modifies|persists?|saves?|overwrites?|renames?|purges?|prunes?)\b/i;

describe('plugin manifest corpus readOnly honesty', () => {
  test('a tool declaring readOnly:true does not describe a mutation', async () => {
    const { ok } = await loadCorpus();
    const offenders = allMcpTools(ok)
      .filter(({ tool }) => tool.readOnly === true && MUTATING_VERB.test(tool.description))
      .map(({ path, tool }) => `${path}:${tool.name} (${MUTATING_VERB.exec(tool.description)?.[0]})`);
    expect(offenders).toEqual([]);
  });

  test('a tool describing a mutation declares an explicit readOnly:false', async () => {
    const { ok } = await loadCorpus();
    const offenders = allMcpTools(ok)
      .filter(({ tool }) => MUTATING_VERB.test(tool.description) && tool.readOnly !== false)
      .map(({ path, tool }) => `${path}:${tool.name} (${MUTATING_VERB.exec(tool.description)?.[0]})`);
    expect(offenders).toEqual([]);
  });
});
