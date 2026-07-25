import { envToolList, isRecord, resolveConfigSourceWithRaw } from './tool-config-source.ts';

export const TOOL_GROUPS = {
  search: ['oracle_search', 'oracle_search_chain', 'oracle_read', 'oracle_list', 'oracle_concepts', 'oracle_ask'],
  knowledge: ['oracle_learn', 'oracle_stats', 'oracle_supersede', 'oracle_research_note'],
  session: ['oracle_handoff', 'oracle_inbox'],
  forum: ['oracle_thread', 'oracle_threads', 'oracle_thread_read', 'oracle_thread_update'],
  oracle: ['oracle_profile', 'oracle_recap'],
  trace: ['oracle_trace', 'oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain', 'oracle_trace_distill'],
  standalone: ['oracle_reflect', 'oracle_verify'],
} as const;

/**
 * DELIBERATELY ALWAYS ON: the local↔remote MCP bridge. These two belong to no
 * TOOL_GROUPS key on purpose — a config that turns every group off must still be
 * able to reach a remote Oracle, which is the whole point of the bridge.
 *
 * They ARE members of ALL_TOOL_NAMES, so this is a default, not a lock:
 * `disabled_tools` (or ORACLE_DISABLED_TOOLS) still switches them off explicitly.
 * Adding an `mcp` key to TOOL_GROUPS instead would regress them — every existing
 * config literal omits it, so the group loop would read it as false. (#2822)
 */
export const ALWAYS_ON_TOOLS: readonly string[] = ['oracle_mcp_list_tools', 'oracle_mcp_call'];

export type ToolGroupName = keyof typeof TOOL_GROUPS;
export type PluginTier = 'core' | 'standard' | 'extra';
export interface PluginManifestEntry { name: string; enabled?: boolean; tier?: PluginTier; weight?: number; }
export interface ToolPlugin { name: string; tier: PluginTier; weight: number; tools: readonly string[]; }

export const TOOL_PLUGINS: Record<string, ToolPlugin> = {
  guide: { name: 'guide', tier: 'core', weight: 0, tools: ['____IMPORTANT'] },
  search: { name: 'search', tier: 'core', weight: 10, tools: TOOL_GROUPS.search },
  knowledge: { name: 'knowledge', tier: 'core', weight: 20, tools: TOOL_GROUPS.knowledge },
  oracle: { name: 'oracle', tier: 'standard', weight: 25, tools: TOOL_GROUPS.oracle },
  session: { name: 'session', tier: 'standard', weight: 30, tools: TOOL_GROUPS.session },
  forum: { name: 'forum', tier: 'standard', weight: 40, tools: TOOL_GROUPS.forum },
  trace: { name: 'trace', tier: 'standard', weight: 50, tools: ['oracle_trace', 'oracle_trace_distill'] },
  dig: {
    name: 'dig', tier: 'standard', weight: 60,
    tools: ['oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain'],
  },
  standalone: { name: 'standalone', tier: 'extra', weight: 70, tools: TOOL_GROUPS.standalone },
};

export type ToolGroupConfig = Record<ToolGroupName, boolean> & {
  plugins?: PluginManifestEntry[];
  disabled_tools?: string[];
  enabled_tools?: string[];
  mcp?: boolean;
};

const DEFAULT_CONFIG: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  oracle: true,
  trace: true,
  standalone: true,
  mcp: true,
};

/**
 * Every tool the config system knows how to govern. A tool absent from this set
 * escapes configuration entirely: `src/mcp/server.ts` re-appends any registry
 * tool with `enabledByDefault !== false` that the whitelist did not name, so an
 * unknown tool is unconditionally exposed. `tests/mcp/tool-registry-invariant.test.ts`
 * fails the build if a built-in MCP tool ever drifts back out of this set.
 */
export const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(
  [
    ...Object.values(TOOL_PLUGINS).flatMap((p) => p.tools),
    ...Object.values(TOOL_GROUPS).flat(),
    ...ALWAYS_ON_TOOLS,
  ] as string[],
);
const DEFAULT_TOOL_ORDER = Object.values(TOOL_PLUGINS)
  .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
  .flatMap((p) => p.tools);

export function normalizeToolName(name: string): string {
  if (name.startsWith('arra_')) return `oracle_${name.slice('arra_'.length)}`;
  if (name.startsWith('muninn_')) return `oracle_${name.slice('muninn_'.length)}`;
  return name;
}

function mergeRaw(raw: Record<string, any>): ToolGroupConfig {
  const merged: ToolGroupConfig = { ...DEFAULT_CONFIG };
  if (isRecord(raw.tools)) {
    for (const group of Object.keys(TOOL_GROUPS) as ToolGroupName[]) {
      if (typeof raw.tools[group] === 'boolean') merged[group] = raw.tools[group];
    }
  }
  if (typeof raw.mcp === 'boolean') merged.mcp = raw.mcp;
  if (Array.isArray(raw.plugins)) {
    merged.plugins = raw.plugins.map(normalizePluginEntry).filter((p): p is PluginManifestEntry => !!p);
  }
  if (Array.isArray(raw.disabled_tools)) merged.disabled_tools = raw.disabled_tools.filter((t: unknown) => typeof t === 'string').map(normalizeToolName);
  if (Array.isArray(raw.enabled_tools)) merged.enabled_tools = raw.enabled_tools.filter((t: unknown) => typeof t === 'string').map(normalizeToolName);
  return merged;
}

function normalizePluginEntry(entry: unknown): PluginManifestEntry | null {
  if (!isRecord(entry) || typeof entry.name !== 'string' || !entry.name.trim()) return null;
  return {
    name: entry.name.trim(),
    ...(typeof entry.enabled === 'boolean' && { enabled: entry.enabled }),
    ...(isPluginTier(entry.tier) && { tier: entry.tier }),
    ...(typeof entry.weight === 'number' && Number.isFinite(entry.weight) && { weight: entry.weight }),
  };
}

function isPluginTier(value: unknown): value is PluginTier {
  return value === 'core' || value === 'standard' || value === 'extra';
}

/**
 * Apply ORACLE_ENABLED_TOOLS / ORACLE_DISABLED_TOOLS on top of file config.
 *
 * - ORACLE_ENABLED_TOOLS is a STRICT allow-list: everything it does not name is
 *   written into disabled_tools, because `enabled_tools` alone is additive.
 * - ORACLE_DISABLED_TOOLS is subtractive and composes with the allow-list.
 *
 * Env wins over the config file — it is the only lever available on a read-only
 * container or in CI where no config file can be written. (#2822 defect 2)
 */
export function applyToolEnvOverrides(config: ToolGroupConfig): ToolGroupConfig {
  const allowEnv = envToolList('ORACLE_ENABLED_TOOLS')?.map(normalizeToolName);
  const blockEnv = envToolList('ORACLE_DISABLED_TOOLS')?.map(normalizeToolName);
  if (!allowEnv && !blockEnv) return config;
  const next: ToolGroupConfig = { ...config };
  if (allowEnv) {
    const keep = new Set(allowEnv.filter((tool) => knownTool(tool, 'ORACLE_ENABLED_TOOLS')));
    next.enabled_tools = [...keep];
    next.disabled_tools = [...ALL_TOOL_NAMES].filter((tool) => !keep.has(tool));
  }
  if (blockEnv) {
    const block = new Set(blockEnv.filter((tool) => knownTool(tool, 'ORACLE_DISABLED_TOOLS')));
    next.disabled_tools = [...new Set([...(next.disabled_tools ?? []), ...block])];
    next.enabled_tools = (next.enabled_tools ?? []).filter((tool) => !block.has(tool));
  }
  return next;
}

function knownTool(tool: string, source: string): boolean {
  if (ALL_TOOL_NAMES.has(tool)) return true;
  console.error(`[ToolGroups] ${source}: unknown tool "${tool}" — ignored`);
  return false;
}

export function loadToolGroupConfig(repoRoot?: string): ToolGroupConfig {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  const { source, raw } = resolveConfigSourceWithRaw(root);
  if (!raw) return applyToolEnvOverrides({ ...DEFAULT_CONFIG });
  console.error(`[ToolGroups] Using ${source.label}`);
  return applyToolEnvOverrides(mergeRaw(raw));
}

export function getDisabledTools(config: ToolGroupConfig): Set<string> {
  const enabled = new Set(getEnabledToolNames(config));
  const disabled = new Set<string>();
  for (const tool of ALL_TOOL_NAMES) if (!enabled.has(tool)) disabled.add(tool);
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) for (const tool of tools) disabled.add(tool);
  }
  for (const t of config.disabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (!ALL_TOOL_NAMES.has(tool)) { console.error(`[ToolGroups] disabled_tools: unknown tool "${t}" — ignored`); continue; }
    disabled.add(tool);
  }
  for (const t of config.enabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (!ALL_TOOL_NAMES.has(tool)) { console.error(`[ToolGroups] enabled_tools: unknown tool "${t}" — ignored`); continue; }
    disabled.delete(tool);
  }
  return disabled;
}

export function getEnabledToolNames(config: ToolGroupConfig): string[] {
  const ordered = [...(config.plugins ? pluginOrderedTools(config.plugins) : DEFAULT_TOOL_ORDER), ...ALWAYS_ON_TOOLS];
  const seen = new Set<string>();
  const enabled = ordered.filter((tool) => !seen.has(tool) && seen.add(tool) && ALL_TOOL_NAMES.has(tool));
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) for (const tool of tools) seen.delete(tool);
  }
  for (const t of config.disabled_tools ?? []) if (ALL_TOOL_NAMES.has(normalizeToolName(t))) seen.delete(normalizeToolName(t));
  for (const t of config.enabled_tools ?? []) if (ALL_TOOL_NAMES.has(normalizeToolName(t))) seen.add(normalizeToolName(t));
  return [
    ...enabled.filter((tool) => seen.has(tool)),
    ...(config.enabled_tools ?? []).map(normalizeToolName).filter((tool) => seen.has(tool) && !enabled.includes(tool)),
  ];
}

function pluginOrderedTools(entries: PluginManifestEntry[]): readonly string[] {
  return entries
    .map((entry) => {
      const plugin = TOOL_PLUGINS[entry.name];
      if (!plugin) { console.error(`[ToolGroups] plugins: unknown plugin "${entry.name}" — ignored`); return null; }
      return { ...plugin, enabled: entry.enabled !== false, tier: entry.tier ?? plugin.tier, weight: entry.weight ?? plugin.weight };
    })
    .filter((p): p is ToolPlugin & { enabled: boolean } => !!p && p.enabled)
    .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
    .flatMap((p) => p.tools);
}
