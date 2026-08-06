/**
 * Behaviour: every shipped maw plugin manifest is loadable and declares a surface.
 *
 * This is the floor the rest of the conformance suite stands on. It is also how
 * `.claude-plugin/plugin.json` is kept out — by the repo's own validator rather
 * than by a path-substring heuristic that has to be maintained by hand.
 *
 * THE NON-EMPTY GUARD IS THE POINT OF THE SECOND TEST, NOT PADDING.
 * A conformance suite driven by a glob has one catastrophic failure mode: the
 * glob matches nothing, every `expect(offenders).toEqual([])` passes vacuously,
 * and the file reads as coverage while asserting nothing. That is strictly
 * worse than a red, because a red gets fixed. Measured 2026-07-25: an earlier
 * draft of this suite exported a checker and never called it — `bun test` on it
 * reported `0 pass, 0 fail, Ran 0 tests across 1 file`. Pinning a lower bound on
 * the corpus size makes that failure loud.
 */
import { describe, expect, test } from 'bun:test';
import { manifestSurfaces } from '../../src/plugins/unified-manifest.ts';
import { loadCorpus, manifestPaths } from './_manifest-corpus.ts';

/**
 * Verified 2026-07-25: exactly 30 tracked manifests live under the plugin roots,
 * equal to `git ls-files | rg '(^|/)plugin\.json$'` minus `.claude-plugin/`.
 * The floor is deliberately well below 30 — this asserts "the scan works", not a
 * frozen inventory, so adding or retiring a plugin does not turn the suite red.
 * It exists only to make a silently-empty scan (a mis-resolved REPO_ROOT is the
 * likely cause) fail loudly instead of passing every other assertion vacuously.
 */
const MINIMUM_EXPECTED_MANIFESTS = 10;

describe('plugin manifest corpus', () => {
  test('discovers the shipped manifests under the plugin roots', async () => {
    const paths = await manifestPaths();
    expect(paths.length).toBeGreaterThanOrEqual(MINIMUM_EXPECTED_MANIFESTS);
    expect(paths.every((path) => path.endsWith('plugin.json'))).toBe(true);
    // maw-plugin is the anchor maw-plugin-mcp-verb-parity.test.ts depends on;
    // if the scan ever stops reaching it, fail here rather than there.
    expect(paths).toContain('maw-plugin/plugin.json');
  });

  test('every discovered manifest survives normalizeUnifiedPluginManifest', async () => {
    const { rejected } = await loadCorpus();
    // Aggregated into one array so the failure message names path AND reason.
    expect(rejected.map(({ path, error }) => `${path}: ${error}`)).toEqual([]);
  });

  test('every discovered manifest declares at least one surface', async () => {
    const { ok } = await loadCorpus();
    const surfaceless = ok.filter(({ manifest }) => manifestSurfaces(manifest).length === 0).map(({ path }) => path);
    expect(surfaceless).toEqual([]);
  });
});
