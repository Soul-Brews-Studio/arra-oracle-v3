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
} as const;

export type ToolGroupName = keyof typeof TOOL_GROUPS;

/**
 * Resolved tool-group config used at request time.
 * - The named group booleans toggle whole groups.
 * - `disabled_tools` adds per-tool blocks on top of the group-disabled set.
 * - `enabled_tools` is a whitelist override — brings back a single tool from
 *   a disabled group OR cancels a per-tool block. Whitelist wins last.
 */
export type ToolGroupConfig = Record<ToolGroupName, boolean> & {
  disabled_tools?: string[];
  enabled_tools?: string[];
};

const DEFAULT_CONFIG: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  trace: true,
};

/** All registered tool names — for validating disabled_tools / enabled_tools entries. */
const ALL_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(TOOL_GROUPS).flat() as string[],
);

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
  if (Array.isArray(raw.disabled_tools)) {
    merged.disabled_tools = raw.disabled_tools.filter((t: unknown) => typeof t === 'string');
  }
  if (Array.isArray(raw.enabled_tools)) {
    merged.enabled_tools = raw.enabled_tools.filter((t: unknown) => typeof t === 'string');
  }
  return merged;
}

export function loadToolGroupConfig(repoRoot?: string): ToolGroupConfig {
  const root = repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();

  // Priority 1: repo-local arra.config.json
  const localConfig = readJsonSafe(path.join(root, 'arra.config.json'));
  if (localConfig && (localConfig.tools || localConfig.disabled_tools || localConfig.enabled_tools)) {
    console.error('[ToolGroups] Using arra.config.json from repo root');
    return mergeRaw(localConfig);
  }

  // Priority 2: global config.json in data dir
  const globalConfig = readJsonSafe(path.join(ORACLE_DATA_DIR, 'config.json'));
  if (globalConfig && (globalConfig.tools || globalConfig.disabled_tools || globalConfig.enabled_tools)) {
    console.error(`[ToolGroups] Using ${ORACLE_DATA_DIR}/config.json`);
    return mergeRaw(globalConfig);
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
  const disabled = new Set<string>();
  for (const [group, tools] of Object.entries(TOOL_GROUPS)) {
    if (!config[group as ToolGroupName]) {
      for (const tool of tools) {
        disabled.add(tool);
      }
    }
  }
  for (const t of config.disabled_tools ?? []) {
    if (!ALL_TOOL_NAMES.has(t)) {
      console.error(`[ToolGroups] disabled_tools: unknown tool "${t}" — ignored`);
      continue;
    }
    disabled.add(t);
  }
  for (const t of config.enabled_tools ?? []) {
    if (!ALL_TOOL_NAMES.has(t)) {
      console.error(`[ToolGroups] enabled_tools: unknown tool "${t}" — ignored`);
      continue;
    }
    disabled.delete(t);
  }
  return disabled;
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
  const globalPath = path.join(ORACLE_DATA_DIR, 'config.json');
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = JSON.stringify(loadToolGroupConfig(root));

  const tick = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const next = loadToolGroupConfig(root);
      const serialized = JSON.stringify(next);
      if (serialized === last) return;
      last = serialized;
      console.error('[ToolGroups] Config changed — reloading');
      onChange(next);
    }, 200);
  };

  for (const target of [localPath, globalPath]) {
    try {
      // Watch the file directly. fs.watch on a missing file throws on Linux
      // and silently fails on macOS, so probe with existsSync first.
      if (fs.existsSync(target)) {
        watchers.push(fs.watch(target, { persistent: false }, tick));
      } else {
        // Watch the directory so we catch creation. Ignored if dir is missing.
        const dir = path.dirname(target);
        if (fs.existsSync(dir)) {
          const base = path.basename(target);
          watchers.push(
            fs.watch(dir, { persistent: false }, (_event, filename) => {
              if (filename === base) tick();
            }),
          );
        }
      }
    } catch {
      // fs.watch can fail on platforms without inotify — keep going.
    }
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
  };
}
