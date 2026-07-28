import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';

export interface ServerPluginConfig {
  disabledPlugins: string[];
  enabledPlugins: string[];
}

type Env = Record<string, string | undefined>;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function pluginList(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) out.push(entry.trim());
    }
  }
  return unique(out);
}

function readConfigFile(path: string): ServerPluginConfig | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as any;
    const disabledPlugins = pluginList(
      raw.disabledPlugins,
      raw.serverPlugins?.disabledPlugins,
      raw.serverPlugins?.disabled,
    );
    const enabledPlugins = pluginList(
      raw.enabledPlugins,
      raw.serverPlugins?.enabledPlugins,
      raw.serverPlugins?.enabled,
    );
    if (!disabledPlugins.length && !enabledPlugins.length) return null;
    return { disabledPlugins, enabledPlugins };
  } catch {
    return null;
  }
}

function configPaths(dir: string): string[] {
  return [join(dir, 'config.json'), join(dir, 'targets.json')];
}

function firstConfig(paths: string[]): ServerPluginConfig | null {
  for (const path of paths) {
    const found = readConfigFile(path);
    if (found) return found;
  }
  return null;
}

function loadProjectPluginConfig(startDir = process.cwd()): ServerPluginConfig | null {
  let dir = startDir;
  const root = parse(dir).root;
  while (true) {
    const found = firstConfig(configPaths(join(dir, '.arra')));
    if (found || dir === root) return found;
    dir = dirname(dir);
  }
}

function globalConfigDir(env: Env = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg ? join(xdg, 'arra') : join(env.HOME ?? homedir(), '.config', 'arra');
}

function loadGlobalPluginConfig(env: Env = process.env): ServerPluginConfig | null {
  return firstConfig(configPaths(globalConfigDir(env)));
}

export function loadServerPluginConfig(env: Env = process.env, startDir = process.cwd()): ServerPluginConfig {
  const global = loadGlobalPluginConfig(env);
  const project = loadProjectPluginConfig(startDir);
  return {
    disabledPlugins: unique([...(global?.disabledPlugins ?? []), ...(project?.disabledPlugins ?? [])]),
    enabledPlugins: unique([...(global?.enabledPlugins ?? []), ...(project?.enabledPlugins ?? [])]),
  };
}
