import type { UnifiedRuntime } from './unified-loader.ts';
import type { UnifiedRuntimeRef } from './runtime-routes.ts';
import { startUnifiedPluginServers, type UnifiedServerRuntime } from './unified-server.ts';

export interface UnifiedRuntimeLifecycleState {
  servers: UnifiedServerRuntime;
}

export interface SwapUnifiedRuntimeOptions {
  warn?: (message: string) => void;
  startServers?: typeof startUnifiedPluginServers;
}

function warn(options: SwapUnifiedRuntimeOptions, message: string): void {
  options.warn?.(`[unified-plugin-reload] ${message}`);
}

async function restorePreviousRuntime(
  previous: UnifiedRuntime,
  state: UnifiedRuntimeLifecycleState,
  options: Required<Pick<SwapUnifiedRuntimeOptions, 'startServers'>> & SwapUnifiedRuntimeOptions,
): Promise<void> {
  try {
    await previous.init();
    state.servers = await options.startServers(previous.servers, options.warn);
  } catch (error) {
    warn(options, `failed to restore previous runtime: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function swapUnifiedRuntimeWithLifecycle(
  runtimeRef: UnifiedRuntimeRef<UnifiedRuntime>,
  state: UnifiedRuntimeLifecycleState,
  next: UnifiedRuntime,
  options: SwapUnifiedRuntimeOptions = {},
): Promise<void> {
  const startServers = options.startServers ?? startUnifiedPluginServers;
  const previous = runtimeRef.current;
  let nextServers: UnifiedServerRuntime | undefined;

  await previous.stop();
  await state.servers.stop();

  try {
    await next.init();
    nextServers = await startServers(next.servers, options.warn);
    runtimeRef.current = next;
    state.servers = nextServers;
  } catch (error) {
    await nextServers?.stop().catch((stopError) => {
      warn(options, `failed to stop replacement servers: ${stopError instanceof Error ? stopError.message : String(stopError)}`);
    });
    await next.stop().catch((stopError) => {
      warn(options, `failed to stop replacement runtime: ${stopError instanceof Error ? stopError.message : String(stopError)}`);
    });
    await restorePreviousRuntime(previous, state, { ...options, startServers });
    throw error;
  }
}
