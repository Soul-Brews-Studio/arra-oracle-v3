/**
 * Behaviour: no plugin MCP tool name collides with a legacy inbound alias prefix.
 *
 * `arra_` and `muninn_` are legacy inbound aliases (src/mcp/aliases.ts:2,
 * `const ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;`) that resolveToolName()
 * rewrites to `oracle_*`. A plugin shipping `muninn_search` therefore does not
 * get its own tool — the call silently resolves onto arra's `oracle_search`.
 * That is a real runtime collision with a real mechanism behind it.
 *
 * Deliberately a NEGATIVE check. Only those two prefixes are rewritten, so every
 * other name passes through untouched; requiring an `oracle_` prefix instead
 * would be enforcing a convention that no code reads.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ASSERTIONS DELIBERATELY NOT ADDED HERE — DO NOT RE-ADD THEM
 * ────────────────────────────────────────────────────────────────────────────
 * Both were drafted against mcpTools and both were removed as cargo-cult. They
 * look like conformance and enforce nothing, so they cost review attention and
 * buy no defect detection. The reasoning is recorded here because it is not
 * recoverable from the code, and a later reader WILL be tempted to add them
 * back on the grounds that "the manifest should be explicit".
 *
 *   `group`   — the only consumer is src/tools/mcp-manifest.ts:85, which filters
 *               `t.group === 'mcp' && t.enabledByDefault !== false` when
 *               building the default tool order. TOOL_GROUPS there is a
 *               hardcoded `as const`, so a manifest cannot introduce a group,
 *               and plugin MCP tools are absent from ALL_TOOL_NAMES regardless
 *               (`oracle_arra_read` is not in it). Asserting a `group` value
 *               would constrain a field that changes no behaviour for these
 *               tools.
 *
 *   `enabled` — the real filter is `tool.enabled !== false` at
 *               src/mcp/plugin-tools.ts:34. Omitting the field and writing
 *               `enabled: true` are therefore IDENTICAL at runtime, so
 *               asserting `enabled === true` enforces style with zero
 *               mechanical effect. (An earlier draft cited line 33 for this;
 *               the filter is on line 34. A conformance suite that miscites its
 *               own evidence undermines the argument it is making, so the
 *               citation is corrected rather than dropped.)
 *
 * Proving a tool is genuinely disableable needs an integration test, not a
 * manifest assertion: POST /api/plugins/:name/toggle, then confirm the tool
 * disappears from tools/list.
 */
import { describe, expect, test } from 'bun:test';
import { allMcpTools, loadCorpus } from './_manifest-corpus.ts';

const LEGACY_ALIAS_PREFIXES = ['arra_', 'muninn_'] as const;

describe('plugin manifest corpus mcp tool names', () => {
  test('no mcp tool name starts with a legacy alias prefix', async () => {
    const { ok } = await loadCorpus();
    // Aggregated so the failure message names `path:tool`, rather than the
    // per-tool loop of bare booleans an earlier draft used — which reported
    // `expected false, got true` with no indication of WHICH tool was at fault.
    const offenders = allMcpTools(ok)
      .filter(({ tool }) => LEGACY_ALIAS_PREFIXES.some((prefix) => tool.name.startsWith(prefix)))
      .map(({ path, tool }) => `${path}:${tool.name}`);
    expect(offenders).toEqual([]);
  });
});
