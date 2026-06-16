import { existsSync, watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadUnifiedPlugins, type UnifiedLoaderOptions, type UnifiedRuntime } from './unified-loader.ts';

const DEFAULT_PLUGIN_DIRS = [join(homedir(), '.arra', 'plugins'), join(homedir(), '.oracle', 'plugins')];
const DEFAULT_DEBOUNCE_MS = 100;

export type PluginWatchFn = (
  path: string,
  options: { recursive?: boolean; persistent?: boolean },
  listener: (event: string, filename: string | Buffer | null) => void,
) => { close: () => void };

export interface PluginManifestWatcherOptions extends UnifiedLoaderOptions {
  debounceMs?: number;
  loader?: (options: UnifiedLoaderOptions) => Promise<UnifiedRuntime>;
  onReload: (runtime: UnifiedRuntime) => void | Promise<void>;
  watch?: PluginWatchFn;
}

export interface PluginManifestWatcher {
  close: () => void;
  reload: () => Promise<UnifiedRuntime>;
}

function uniqueDirs(dirs: string[]): string[] {
  return [...new Set(dirs.filter(Boolean))];
}

function isPluginManifest(filename: string | Buffer | null): boolean {
  if (filename === null) return true;
  const text = typeof filename === 'string' ? filename : filename.toString();
  return text.replaceAll('\\', '/').split('/').at(-1) === 'plugin.json';
}

function warn(options: PluginManifestWatcherOptions, message: string): void {
  options.warn?.(`[unified-plugin-watcher] ${message}`);
}

export function watchPluginManifests(options: PluginManifestWatcherOptions): PluginManifestWatcher {
  const dirs = uniqueDirs(options.dirs ?? DEFAULT_PLUGIN_DIRS);
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const loader = options.loader ?? loadUnifiedPlugins;
  const watchImpl = options.watch ?? (fsWatch as unknown as PluginWatchFn);
  const watchers: Array<{ close: () => void }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const reload = async (): Promise<UnifiedRuntime> => {
    const runtime = await loader({ dirs, timeoutMs: options.timeoutMs, warn: options.warn });
    await options.onReload(runtime);
    return runtime;
  };

  const scheduleReload = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void reload().catch((error) => {
        warn(options, `reload failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, debounceMs);
  };

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      watchers.push(watchImpl(dir, { recursive: true, persistent: false }, (_event, filename) => {
        if (isPluginManifest(filename)) scheduleReload();
      }));
    } catch (error) {
      warn(options, `watch disabled for ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    close: () => {
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
    reload,
  };
}

export const watchUnifiedPluginManifests = watchPluginManifests;
