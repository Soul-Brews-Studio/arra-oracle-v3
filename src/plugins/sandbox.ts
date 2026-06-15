import { pluginEventBus, type PluginErrorPhase, type PluginEventBus } from './event-bus.ts';

export interface PluginSandboxOptions {
  plugin: string;
  phase: PluginErrorPhase;
  eventBus?: Pick<PluginEventBus, 'emit'>;
}

export type PluginSandboxResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; cause: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runPluginSandbox<T>(
  options: PluginSandboxOptions,
  operation: () => T | Promise<T>,
): Promise<PluginSandboxResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    const message = errorMessage(error);
    try {
      await (options.eventBus ?? pluginEventBus).emit('plugin:error', {
        plugin: options.plugin,
        phase: options.phase,
        error,
        message,
      });
    } catch {
      // Event observers must not turn a contained plugin failure into a server failure.
    }
    return { ok: false, error: message, cause: error };
  }
}
