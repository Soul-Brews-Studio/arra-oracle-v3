import { createUnifiedRuntimeRef, type UnifiedRuntimeRef } from '../plugins/runtime-routes.ts';
import { defaultUnifiedPluginDirs, loadUnifiedPlugins, type UnifiedLoaderOptions, type UnifiedRuntime } from '../plugins/unified-loader.ts';
import { watchPluginManifests, type PluginManifestWatcher } from '../plugins/watcher.ts';

export type PluginRuntimeWatch = typeof watchPluginManifests | false;

export interface McpPluginRuntimeOptions extends UnifiedLoaderOptions {
  runtime?: UnifiedRuntime | Promise<UnifiedRuntime>;
  runtimeRef?: UnifiedRuntimeRef<UnifiedRuntime>;
  watch?: PluginRuntimeWatch;
}

export interface McpPluginRuntime {
  ready: Promise<UnifiedRuntime>;
  current: () => Promise<UnifiedRuntime>;
  close: () => void;
}

export function createMcpPluginRuntime(options: McpPluginRuntimeOptions = {}): McpPluginRuntime {
  const dirs = options.dirs ?? defaultUnifiedPluginDirs();
  let ref = options.runtimeRef;
  let watcher: PluginManifestWatcher | null = null;
  const ready = Promise.resolve(options.runtime ?? options.runtimeRef?.current ?? loadUnifiedPlugins({ dirs, warn: options.warn, timeoutMs: options.timeoutMs }))
    .then((runtime) => {
      ref ??= createUnifiedRuntimeRef(runtime);
      return runtime;
    });
  const current = async () => ref?.current ?? await ready;

  const explicitWatch = typeof options.watch === 'function';
  if ((explicitWatch || (!options.runtime && !options.runtimeRef)) && options.watch !== false && process.env.ARRA_PLUGIN_HOT_RELOAD !== '0') {
    const watch = options.watch ?? watchPluginManifests;
    watcher = watch({
      dirs,
      warn: options.warn,
      timeoutMs: options.timeoutMs,
      onReload: async (next) => {
        const previous = await current();
        await previous.stop();
        await next.init();
        ref ??= createUnifiedRuntimeRef(next);
        ref.current = next;
      },
    });
  }

  return { ready, current, close: () => watcher?.close() };
}
