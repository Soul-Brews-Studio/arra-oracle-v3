/**
 * Tool Group Configuration
 *
 * Controls which tool groups are registered at startup.
 * Config sources (in priority order):
 *   1. arra.config.json in repo root (ORACLE_REPO_ROOT or cwd)
 *   2. ORACLE_DATA_DIR/config.json (global, see const.ts)
 *   3. Defaults: all groups enabled
 */

import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

export const TOOL_GROUPS = {
  search: ['oracle_search', 'oracle_read', 'oracle_list', 'oracle_concepts'],
  knowledge: ['oracle_learn', 'oracle_stats', 'oracle_supersede'],
  session: ['oracle_handoff', 'oracle_inbox'],
  forum: ['oracle_thread', 'oracle_threads', 'oracle_thread_read', 'oracle_thread_update'],
  trace: ['oracle_trace', 'oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain'],
  // #972: standalone tools that don't fit any other group. Handlers ALSO power
  // HTTP routes (/api/reflect, /api/verify) — same code path. NOTE: schedule_*
  // handlers exist + power /api/schedule/* but are intentionally NOT exposed
  // as MCP tools (per user direction — keep schedule HTTP-only).
  standalone: ['oracle_reflect', 'oracle_verify'],
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;
export type PluginTier = 'core' | 'standard' | 'extra';

export interface PluginManifestEntry {
  name: string;
  enabled?: boolean;
  tier?: PluginTier;
  weight?: number;
}

export interface ToolPlugin {
  name: string;
  tier: PluginTier;
  weight: number;
  tools: readonly string[];
}

export const TOOL_PLUGINS: Record<string, ToolPlugin> = {
  guide: { name: 'guide', tier: 'core', weight: 0, tools: ['____IMPORTANT'] },
  search: { name: 'search', tier: 'core', weight: 10, tools: TOOL_GROUPS.search },
  knowledge: { name: 'knowledge', tier: 'core', weight: 20, tools: TOOL_GROUPS.knowledge },
  session: { name: 'session', tier: 'standard', weight: 30, tools: TOOL_GROUPS.session },
  forum: { name: 'forum', tier: 'standard', weight: 40, tools: TOOL_GROUPS.forum },
  trace: { name: 'trace', tier: 'standard', weight: 50, tools: ['oracle_trace'] },
  dig: {
    name: 'dig',
    tier: 'standard',
    weight: 60,
    tools: ['oracle_trace_list', 'oracle_trace_get', 'oracle_trace_link', 'oracle_trace_unlink', 'oracle_trace_chain'],
  },
  standalone: { name: 'standalone', tier: 'extra', weight: 70, tools: TOOL_GROUPS.standalone },
};

/**
 * Resolved tool-group config used at request time.
 * - The named group booleans toggle whole groups.
 * - `disabled_tools` adds per-tool blocks on top of the group-disabled set.
 * - `enabled_tools` is a whitelist override — brings back a single tool from
 *   a disabled group OR cancels a per-tool block. Whitelist wins last.
 */
export type ToolGroupConfig = Record<ToolGroupName, boolean> & {
  plugins?: PluginManifestEntry[];
  disabled_tools?: string[];
  enabled_tools?: string[];
};

const DEFAULT_CONFIG: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  trace: true,
  standalone: true,
};

/** All registered tool names — for validating disabled_tools / enabled_tools entries. */
const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(
  [...Object.values(TOOL_PLUGINS).flatMap((p) => p.tools), ...Object.values(TOOL_GROUPS).flat()] as string[],
);

const DEFAULT_TOOL_ORDER = Object.values(TOOL_PLUGINS)
  .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
  .flatMap((p) => p.tools);

export function normalizeToolName(name: string): string {
  if (name.startsWith('arra_')) return 'oracle_' + name.slice('arra_'.length);
  if (name.startsWith('muninn_')) return 'oracle_' + name.slice('muninn_'.length);
  return name;
}

function readJsonSafe(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function mergeRaw(raw: Record<string, any>): ToolGroupConfig {
  const merged: ToolGroupConfig = { ...DEFAULT_CONFIG, ...raw.tools };
  if (Array.isArray(raw.plugins)) {
    merged.plugins = raw.plugins
      .filter((p: unknown): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as any).name === 'string')
      .map((p) => ({
        name: String(p.name),
        ...(typeof p.enabled === 'boolean' && { enabled: p.enabled }),
        ...((p.tier === 'core' || p.tier === 'standard' || p.tier === 'extra') && { tier: p.tier }),
        ...(typeof p.weight === 'number' && { weight: p.weight }),
      }));
  }
  if (Array.isArray(raw.disabled_tools)) {
    merged.disabled_tools = raw.disabled_tools.filter((t: unknown) => typeof t === 'string').map(normalizeToolName);
  }
  if (Array.isArray(raw.enabled_tools)) {
    merged.enabled_tools = raw.enabled_tools.filter((t: unknown) => typeof t === 'string').map(normalizeToolName);
  }
  return merged;
}

export function loadToolGroupConfig(repoRoot?: string): ToolGroupConfig {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();

  // Priority 1: repo-local arra.config.json
  const localConfig = readJsonSafe(path.join(root, 'arra.config.json'));
  if (localConfig && (localConfig.plugins || localConfig.tools || localConfig.disabled_tools || localConfig.enabled_tools)) {
    console.error('[ToolGroups] Using arra.config.json from repo root');
    return mergeRaw(localConfig);
  }

  // Priority 1b: repo-local plugin manifest
  const localPluginManifest = readJsonSafe(path.join(root, 'plugins.json'));
  if (localPluginManifest && Array.isArray(localPluginManifest.plugins)) {
    console.error('[ToolGroups] Using plugins.json from repo root');
    return mergeRaw(localPluginManifest);
  }

  // Priority 2: global config.json in data dir
  const globalConfig = readJsonSafe(path.join(ORACLE_DATA_DIR, 'config.json'));
  if (globalConfig && (globalConfig.plugins || globalConfig.tools || globalConfig.disabled_tools || globalConfig.enabled_tools)) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/config.json`);
    return mergeRaw(globalConfig);
  }

  // Priority 2b: global plugin manifest
  const globalPluginManifest = readJsonSafe(path.join(ORACLE_DATA_DIR, 'plugins.json'));
  if (globalPluginManifest && Array.isArray(globalPluginManifest.plugins)) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/plugins.json`);
    return mergeRaw(globalPluginManifest);
  }

  // Priority 3: all enabled
  return { ...DEFAULT_CONFIG };
}

/**
 * Returns a Set of tool names that should be disabled based on config.
 *
 * Resolution order:
 *   1. group-disabled (any tool whose group has `<group>: false`)
 *   2. ∪ per-tool blocklist (`disabled_tools`)
 *   3. \ per-tool whitelist (`enabled_tools`) — wins last
 *
 * Unknown tool names in `disabled_tools` / `enabled_tools` are ignored with
 * a warning — typos shouldn't crash the server or silently disable real tools.
 */
export function getDisabledTools(config: ToolGroupConfig): Set<string> {
  const enabled = new Set(getEnabledToolNames(config));
  const disabled = new Set<string>();
  for (const tool of ALL_TOOL_NAMES) {
    if (!enabled.has(tool)) disabled.add(tool);
  }
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) {
      for (const tool of tools) {
        disabled.add(tool);
      }
    }
  }
  for (const t of config.disabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (!ALL_TOOL_NAMES.has(tool)) {
      console.error(`[ToolGroups] disabled_tools: unknown tool "${t}" — ignored`);
      continue;
    }
    disabled.add(tool);
  }
  for (const t of config.enabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (!ALL_TOOL_NAMES.has(tool)) {
      console.error(`[ToolGroups] enabled_tools: unknown tool "${t}" — ignored`);
      continue;
    }
    disabled.delete(tool);
  }
  return disabled;
}

export function getEnabledToolNames(config: ToolGroupConfig): string[] {
  const ordered = config.plugins
    ? config.plugins
        .map((entry) => {
          const plugin = TOOL_PLUGINS[entry.name];
          if (!plugin) {
            console.error(`[ToolGroups] plugins: unknown plugin "${entry.name}" — ignored`);
            return null;
          }
          return {
            ...plugin,
            enabled: entry.enabled !== false,
            tier: entry.tier ?? plugin.tier,
            weight: entry.weight ?? plugin.weight,
          };
        })
        .filter((p): p is ToolPlugin & { enabled: boolean } => !!p && p.enabled)
        .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
        .flatMap((p) => p.tools)
    : DEFAULT_TOOL_ORDER;

  const seen = new Set<string>();
  const enabled = ordered.filter((tool) => {
    if (seen.has(tool)) return false;
    seen.add(tool);
    return ALL_TOOL_NAMES.has(tool);
  });

  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) {
      for (const tool of tools) seen.delete(tool);
    }
  }
  for (const t of config.disabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (ALL_TOOL_NAMES.has(tool)) seen.delete(tool);
  }
  for (const t of config.enabled_tools ?? []) {
    const tool = normalizeToolName(t);
    if (ALL_TOOL_NAMES.has(tool)) seen.add(tool);
  }

  const finalOrder = [
    ...enabled.filter((tool) => seen.has(tool)),
    ...(config.enabled_tools ?? [])
      .map(normalizeToolName)
      .filter((tool) => seen.has(tool) && !enabled.includes(tool)),
  ];
  return finalOrder;
}

/**
 * Watch tool group config files and invoke onChange when content changes.
 * Watches BOTH the repo-local arra.config.json and the global data-dir config.json,
 * so a change to either reloads via the same priority order as loadToolGroupConfig.
 *
 * - Debounces fs.watch events (200ms) — editors fire multiple events per save.
 * - Skips no-op reloads (compares against last loaded config).
 * - Swallows JSON parse errors — keeps the last good config until the file is valid again.
 * - Returns a stop function to close the watchers (call on shutdown).
 */
export function watchToolGroupConfig(
  onChange: (next: ToolGroupConfig) => void,
  repoRoot?: string,
): () => void {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  const localPath = path.join(root, 'arra.config.json');
  const localPluginsPath = path.join(root, 'plugins.json');
  const globalPath = path.join(ORACLE_DATA_DIR, 'config.json');
  const globalPluginsPath = path.join(ORACLE_DATA_DIR, 'plugins.json');
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poller: ReturnType<typeof setInterval> | null = null;
  let last = JSON.stringify(loadToolGroupConfig(root));

  const reloadIfChanged = (): void => {
    const next = loadToolGroupConfig(root);
    const serialized = JSON.stringify(next);
    if (serialized === last) return;
    last = serialized;
    console.error('[ToolGroups] Config changed — reloading');
    onChange(next);
  };

  const tick = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reloadIfChanged();
    }, 200);
  };

  const byDir = new Map<string, Set<string>>();
  for (const target of [localPath, localPluginsPath, globalPath, globalPluginsPath]) {
    const dir = path.dirname(target);
    const names = byDir.get(dir) ?? new Set<string>();
    names.add(path.basename(target));
    byDir.set(dir, names);

    try {
      // File watchers are useful for direct writes, but cannot observe a
      // missing file being created and can go stale after unlink/replace.
      if (fs.existsSync(target)) {
        watchers.push(fs.watch(target, { persistent: false }, tick));
      }
    } catch {
      // fs.watch can fail on platforms without inotify — keep going.
    }
  }

  // Poll as a safety net for raw `bun test` shared-process runs: fs.watch can
  // drop creation events under load, while comparing the resolved config keeps
  // no-op writes silent.
  poller = setInterval(reloadIfChanged, 100);
  poller.unref?.();

  for (const [dir, names] of byDir) {
    try {
      // Always watch directories that exist so raw `bun test` shared-process
      // runs reliably catch create/delete/replace events between test files.
      if (!fs.existsSync(dir)) continue;
      watchers.push(
        fs.watch(dir, { persistent: false }, (_event, filename) => {
          if (!filename) {
            tick();
            return;
          }
          const changed = Buffer.isBuffer(filename) ? filename.toString() : String(filename);
          if (names.has(changed)) tick();
        }),
      );
    } catch {
      // fs.watch can fail on platforms without inotify — keep going.
    }
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (poller) {
      clearInterval(poller);
      poller = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
  };
}
