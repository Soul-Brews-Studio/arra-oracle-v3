/**
 * Corpus loader for the plugin-surface conformance suite.
 *
 * WHY THIS EXISTS
 * ---------------
 * An earlier draft of the conformance suite carried its own private
 * `PluginManifest` interface with a 3-surface enum (`cli` | `api` | `mcp`) and
 * its own `declaredSurfaces()`. That was a SECOND source of truth, and it was
 * already wrong: src/plugins/unified-manifest.ts:5 defines SEVEN surfaces
 * ('mcpTools' | 'apiRoutes' | 'proxy' | 'server' | 'menu' | 'cliSubcommands' |
 * 'exportFormats') and :230 ships `manifestSurfaces()` to compute them. `cli`
 * and `api` are LEGACY ALIASES folded into `cliSubcommands`/`apiRoutes` during
 * normalization (unified-manifest.ts:156 and :159), so a suite reading them raw
 * measures the pre-normalization shape and mis-reports every plugin that uses
 * the modern keys. Measured 2026-07-25: the private model called
 * docs/examples/unified-plugin "MCP-only" when it actually declares four
 * surfaces, and src/plugins/arra "CLI-only" when it is apiRoutes+menu+
 * cliSubcommands.
 *
 * So this helper drives everything off the repo's own normalizer. A conformance
 * suite whose job is to catch drift must not itself be a thing that can drift.
 *
 * WHY SCOPED ROOTS INSTEAD OF A WHOLE-REPO GLOB
 * ---------------------------------------------
 * Measured 2026-07-25: `**\/plugin.json` from the repo root returns 179 files in
 * ~810ms because it sweeps node_modules and frontend/src-tauri/target; the
 * scoped scan below returns 30 in ~1.3ms. Verified equal to the shipped set:
 * `git ls-files | rg '(^|/)plugin\.json$'` minus `.claude-plugin/` is exactly
 * these 30 paths, set-difference `[]` in BOTH directions.
 *
 * `.claude-plugin/plugin.json` is excluded MECHANICALLY, not by a path
 * substring: it is a Claude Code manifest, not a maw one, and it is the only
 * tracked manifest that `normalizeUnifiedPluginManifest()` rejects
 * ('manifest.entry must be a string path'). It also sits outside these roots.
 * Both facts hold; neither is a hand-maintained exception list.
 *
 * EXCLUDED_SEGMENTS IS NOT DEAD CODE — VERIFIED
 * ---------------------------------------------
 * tools/maw-plugin-arra/scripts/build.ts:57 defaults `outDir` to
 * `join(root, 'dist')` and :75 writes a `plugin.json` into it. `.gitignore`
 * only ignores the ANCHORED root-level `/dist/`, so `git check-ignore
 * tools/maw-plugin-arra/dist/plugin.json` exits 1 — NOT ignored. Without this
 * filter, anyone who runs the default build silently grows the corpus by a
 * build artifact and the suite starts asserting against generated output.
 */
import { Glob } from 'bun';
import { join, relative, sep } from 'node:path';
import {
  normalizeUnifiedPluginManifest,
  type NormalizedUnifiedPluginManifest,
  type UnifiedMcpToolManifest,
} from '../../src/plugins/unified-manifest.ts';

export const REPO_ROOT = join(import.meta.dir, '..', '..');

export const PLUGIN_ROOTS = ['cli/src/plugins', 'src/plugins', 'maw-plugin', 'tools', 'docs/examples'] as const;

const EXCLUDED_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'target', 'coverage']);

export async function manifestPaths(): Promise<string[]> {
  const found: string[] = [];
  for (const root of PLUGIN_ROOTS) {
    for await (const hit of new Glob('**/plugin.json').scan({ cwd: join(REPO_ROOT, root), absolute: true })) {
      const path = relative(REPO_ROOT, hit);
      if (path.split(sep).some((segment) => EXCLUDED_SEGMENTS.has(segment))) continue;
      found.push(path);
    }
  }
  return [...new Set(found)].sort();
}

export interface CorpusEntry {
  path: string;
  manifest: NormalizedUnifiedPluginManifest;
}

export interface Corpus {
  ok: CorpusEntry[];
  rejected: Array<{ path: string; error: string }>;
}

/**
 * Collects rejections instead of throwing so that a single malformed manifest
 * produces ONE precise failure in manifest-corpus-normalizes.test.ts rather
 * than an opaque import-time crash in all four corpus test files at once.
 */
export async function loadCorpus(): Promise<Corpus> {
  const ok: CorpusEntry[] = [];
  const rejected: Array<{ path: string; error: string }> = [];
  for (const path of await manifestPaths()) {
    try {
      ok.push({ path, manifest: normalizeUnifiedPluginManifest(await Bun.file(join(REPO_ROOT, path)).json()) });
    } catch (error) {
      rejected.push({ path, error: (error as Error).message });
    }
  }
  return { ok, rejected };
}

/**
 * Mirrors `key()` at maw-plugin/index.ts:111 EXACTLY — `.toLowerCase()` then
 * hyphen-to-underscore. An earlier draft used `.trim().replace(/-/g, '_')`
 * without lowercasing; that is latent drift, not a live bug (no manifest ships
 * an uppercase verb today), but the moment one does, the suite would disagree
 * with the runtime it claims to model. arra accepts `trace-list` and
 * `trace_list` interchangeably, and its own help text mixes the two, so raw
 * string comparison reports false "drift" pointing at the wrong diagnosis.
 */
export const key = (verb: string) => verb.trim().toLowerCase().replace(/-/g, '_');

/**
 * Reads EVERY tool's `command` enum, never just index 0. src/plugins/oracle-dig
 * ships two tools (oracle_dig, oracle_sessions); an index-0 read inspected half
 * the surface and reported a pass. A check that inspects incompletely and calls
 * itself green is the exact failure class this suite exists to prevent.
 */
export function commandEnum(tool: UnifiedMcpToolManifest): string[] {
  const properties = (tool.inputSchema as { properties?: Record<string, { enum?: unknown }> }).properties;
  const values = properties?.command?.enum;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : [];
}

export function allMcpTools(entries: CorpusEntry[]): Array<{ path: string; tool: UnifiedMcpToolManifest }> {
  return entries.flatMap(({ path, manifest }) => manifest.mcpTools.map((tool) => ({ path, tool })));
}
