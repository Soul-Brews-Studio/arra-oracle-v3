import fs from 'fs';
import path from 'path';
import { Elysia, t } from 'elysia';
import { REPO_ROOT } from '../../config.ts';
import {
  TOOL_GROUPS,
  getEnabledToolNames,
  loadToolGroupConfig,
  normalizeToolName,
  type ToolGroupName,
} from '../../config/tool-groups.ts';

const ALL_TOOL_NAMES = Object.values(TOOL_GROUPS).flat();
const ALL_TOOL_SET: ReadonlySet<string> = new Set(ALL_TOOL_NAMES);

const UpdateToolsBody = t.Object({
  enabled_tools: t.Array(t.String()),
});

function configPath(): string {
  return path.join(process.env.ORACLE_REPO_ROOT || REPO_ROOT, '.arra', 'config.json');
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
  const config = loadToolGroupConfig(process.env.ORACLE_REPO_ROOT || REPO_ROOT);
  const enabled = new Set(getEnabledToolNames(config));
  const envOverride = Boolean(process.env.ORACLE_ENABLED_TOOLS?.trim() || process.env.ORACLE_DISABLED_TOOLS?.trim());
  return {
    groups: Object.entries(TOOL_GROUPS).map(([group, tools]) => ({
      group: group as ToolGroupName,
      tools: tools.map((name) => ({ name, enabled: enabled.has(name) })),
    })),
    enabled_tools: ALL_TOOL_NAMES.filter((name) => enabled.has(name)),
    disabled_tools: ALL_TOOL_NAMES.filter((name) => !enabled.has(name)),
    config_path: configPath(),
    env_override: envOverride,
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
    const normalized = Array.from(new Set(body.enabled_tools.map(normalizeToolName)));
    const unknown = normalized.filter((name) => !ALL_TOOL_SET.has(name));
    if (unknown.length) {
      set.status = 400;
      return { error: 'Unknown MCP tools', unknown };
    }

    const filePath = configPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = readExistingConfig(filePath);
    const next = {
      ...existing,
      // allowed_tools is the strict allow-list that #1372 already resolves via
      // getEnabledToolNames/getDisabledTools. Persisting the visual toggle as
      // an allow-list avoids duplicating group/filter semantics in the UI.
      allowed_tools: ALL_TOOL_NAMES.filter((name) => normalized.includes(name)),
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
