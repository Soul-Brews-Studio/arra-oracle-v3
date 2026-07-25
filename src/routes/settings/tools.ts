import fs from 'fs';
import path from 'path';
import { Elysia, t } from 'elysia';
import { REPO_ROOT } from '../../config.ts';
import {
  ALL_TOOL_NAMES,
  ALWAYS_ON_TOOLS,
  TOOL_GROUPS,
  envToolList,
  getEnabledToolNames,
  loadToolGroupConfig,
  normalizeToolName,
  resolveToolConfigSource,
  type ToolGroupName,
} from '../../config/tool-groups.ts';
import { warnDeprecatedAlias } from '../../config/tool-alias-warn.ts';

/** Ordered projection of the shared config vocabulary — the same set the loader governs. */
const ALL_TOOL_LIST = [...ALL_TOOL_NAMES];

const UpdateToolsBody = t.Object({
  enabled_tools: t.Array(t.String()),
});

function repoRoot(): string {
  return process.env.ORACLE_REPO_ROOT || REPO_ROOT;
}

function readExistingConfig(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function serializeToolConfig() {
  const source = resolveToolConfigSource(repoRoot());
  const config = loadToolGroupConfig(repoRoot());
  const enabled = new Set(getEnabledToolNames(config));
  return {
    groups: Object.entries(TOOL_GROUPS).map(([group, tools]) => ({
      group: group as ToolGroupName,
      tools: tools.map((name) => ({ name, enabled: enabled.has(name) })),
    })),
    enabled_tools: ALL_TOOL_LIST.filter((name) => enabled.has(name)),
    disabled_tools: ALL_TOOL_LIST.filter((name) => !enabled.has(name)),
    // Tools with no group: deliberately on by default, still disableable. See
    // ALWAYS_ON_TOOLS in src/config/tool-groups-core.ts.
    always_on_tools: [...ALWAYS_ON_TOOLS],
    // The file a PUT will write. First-match-wins: a repo-root arra.config.json
    // shadows the global one, so surface which file is actually in play.
    config_path: source.path,
    config_exists: source.found,
    // True when ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS are in effect. Env
    // beats the file, so a PUT will not visibly change the surface while set.
    env_override: Boolean(envToolList('ORACLE_ENABLED_TOOLS') || envToolList('ORACLE_DISABLED_TOOLS')),
  };
}

export const toolSettingsRoute = new Elysia()
  .get('/tools', () => serializeToolConfig(), {
    detail: {
      tags: ['settings'],
      menu: { group: 'tools', path: '/tools/config', order: 120 },
      summary: 'Read MCP tool enablement config',
    },
  })
  .put('/tools', ({ body, set }) => {
    // Announce the rewrite BEFORE validation, so a body that also carries an
    // unknown tool still tells the caller its `muninn_` names are on the way out
    // rather than 400-ing with that half of the story missing. Unguarded on
    // purpose: every PUT is a fresh operator action, unlike the polled config file.
    for (const name of body.enabled_tools) warnDeprecatedAlias(name);
    const normalized = Array.from(new Set(body.enabled_tools.map(normalizeToolName)));
    const unknown = normalized.filter((name) => !ALL_TOOL_NAMES.has(name));
    if (unknown.length) {
      set.status = 400;
      return { error: 'Unknown MCP tools', unknown };
    }

    const filePath = resolveToolConfigSource(repoRoot()).path;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const { allowed_tools: _dead, ...existing } = readExistingConfig(filePath);
    const selected = new Set(normalized);
    const next = {
      ...existing,
      // BOTH sides are required. `enabled_tools` is additive in
      // getEnabledToolNames, so an allow-list only becomes exclusive once its
      // complement lands in `disabled_tools`. The old `allowed_tools` key this
      // endpoint used to write is not a key the loader reads at all — it is
      // dropped here rather than left behind looking authoritative. (#2822)
      enabled_tools: ALL_TOOL_LIST.filter((name) => selected.has(name)),
      disabled_tools: ALL_TOOL_LIST.filter((name) => !selected.has(name)),
    };
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2) + '\n');
    return { success: true, ...serializeToolConfig() };
  }, {
    body: UpdateToolsBody,
    detail: {
      tags: ['settings'],
      menu: { group: 'tools', path: '/tools/config', order: 120 },
      summary: 'Persist MCP tool enablement config',
    },
  });
