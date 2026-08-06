import { spawn, type SpawnOptions } from 'child_process';
import { logger } from './logger.ts';

export interface SpawnDaemonOptions {
  /** Script path to run */
  scriptPath: string;
  /** Port to pass via environment variable */
  port?: number;
  /** Environment variable name for port (default: WORKER_PORT) */
  portEnvVar?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Arguments to pass to script (default: ['--daemon']) */
  args?: string[];
  /** Spawn options override */
  spawnOptions?: Partial<SpawnOptions>;
}

export function spawnDaemon(options: SpawnDaemonOptions): number | undefined {
  const {
    scriptPath,
    port,
    portEnvVar = 'WORKER_PORT',
    env = {},
    args = ['--daemon'],
    spawnOptions = {},
  } = options;

  if (typeof scriptPath !== 'string' || !scriptPath.trim()) {
    logger.warn('SYSTEM', 'Failed to spawn daemon', { scriptPath: '<empty>' });
    return undefined;
  }

  const envVars: Record<string, string | undefined> = { ...process.env, ...env };
  if (port !== undefined) envVars[portEnvVar] = String(port);

  try {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: envVars,
      ...spawnOptions,
    });

    if (child.pid === undefined) return undefined;
    child.unref();
    return child.pid;
  } catch (error) {
    logger.warn('SYSTEM', 'Failed to spawn daemon', { scriptPath }, error as Error);
    return undefined;
  }
}

export function createSignalHandler(
  shutdownFn: () => Promise<void>,
  isShuttingDownRef: { value: boolean },
): (signal: string) => Promise<void> {
  return async (signal: string) => {
    if (isShuttingDownRef.value) {
      logger.warn('SYSTEM', `Received ${signal} but shutdown already in progress`);
      return;
    }
    isShuttingDownRef.value = true;

    logger.info('SYSTEM', `Received ${signal}, shutting down...`);
    try {
      await shutdownFn();
      process.exit(0);
    } catch (error) {
      logger.error('SYSTEM', 'Error during shutdown', {}, error as Error);
      process.exit(1);
    }
  };
}

export function registerSignalHandlers(
  shutdownFn: () => Promise<void>,
): { isShuttingDown: { value: boolean } } {
  const isShuttingDown = { value: false };
  const handler = createSignalHandler(shutdownFn, isShuttingDown);

  process.on('SIGTERM', () => handler('SIGTERM'));
  process.on('SIGINT', () => handler('SIGINT'));

  return { isShuttingDown };
}
