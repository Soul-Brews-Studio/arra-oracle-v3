type SignalName = 'SIGTERM' | 'SIGINT';

export interface ShutdownOptions {
  timeoutMs?: number;
  minDrainMs?: number;
  close: () => Promise<void>;
  log?: (message: string) => void;
  exit?: (code: number) => never;
}

let draining = false;
let shuttingDown = false;
let activeRequests = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function envMs(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function isDraining(): boolean {
  return draining;
}

export function activeRequestCount(): number {
  return activeRequests;
}

export async function trackRequest<T>(handler: () => T | Promise<T>): Promise<T> {
  activeRequests += 1;
  try {
    return await handler();
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
  }
}

export async function waitForActiveRequests(
  timeoutMs = 10_000,
  minDrainMs = 250,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if (minDrainMs > 0) await sleep(minDrainMs);
  while (activeRequests > 0) {
    if (Date.now() >= deadline) return false;
    await sleep(25);
  }
  return true;
}

export function registerGracefulShutdown(options: ShutdownOptions): void {
  const timeoutMs = options.timeoutMs ?? envMs('ARRA_SHUTDOWN_TIMEOUT_MS', 10_000);
  const minDrainMs = options.minDrainMs ?? envMs('ARRA_SHUTDOWN_MIN_DRAIN_MS', 250);
  const log = options.log ?? ((message) => console.log(message));
  const exit = options.exit ?? ((code) => process.exit(code) as never);

  const shutdown = async (signal: SignalName) => {
    if (shuttingDown) return;
    shuttingDown = true;
    draining = true;
    log(`[Shutdown] ${signal} received; draining active requests`);
    const drained = await waitForActiveRequests(timeoutMs, minDrainMs);
    if (!drained) log(`[Shutdown] drain timed out with ${activeRequests} active request(s)`);
    await options.close();
    log('[Shutdown] complete');
    exit(0);
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      shutdown(signal).catch((error) => {
        console.error('[Shutdown] failed:', error instanceof Error ? error.message : error);
        exit(1);
      });
    });
  }
}
