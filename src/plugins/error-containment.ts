/**
 * Plugin error containment.
 *
 * Catches plugin exceptions and reports them; this does NOT provide process
 * isolation, VM boundaries, or any security boundary.
 */
import { pluginEventBus, type PluginErrorPhase, type PluginEventBus } from './event-bus.ts';

export interface PluginErrorContainmentOptions {
  plugin: string;
  phase: PluginErrorPhase;
  eventBus?: Pick<PluginEventBus, 'emit'>;
}

export type PluginErrorContainmentResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; cause: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Catches plugin exceptions; does NOT provide process isolation. */
export async function runPluginWithErrorContainment<T>(
  options: PluginErrorContainmentOptions,
  operation: () => T | Promise<T>,
): Promise<PluginErrorContainmentResult<T>> {
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
