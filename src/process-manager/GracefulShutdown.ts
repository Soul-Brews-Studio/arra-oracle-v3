/**
 * GracefulShutdown - Cleanup utilities for graceful exit
 *
 * Lightweight shutdown coordination for Bun applications.
 * Forked from claude-mem's infrastructure module.
 *
 * Handles:
 * - HTTP server closure (with Windows-specific delays)
 * - Service shutdown coordination
 * - Child process cleanup (Windows zombie port fix)
 */

import http from 'http';
import { logger } from './logger.ts';
import {
  getChildProcesses,
  forceKillProcess,
  waitForProcessesExit,
  removePidFile
} from './ProcessManager.ts';

export interface ShutdownableService {
  shutdown(): Promise<void>;
}

export interface CloseableResource {
  close(): Promise<void>;
}

/**
 * Configuration for graceful shutdown
 */
export interface GracefulShutdownConfig {
  /** HTTP server to close */
  server?: http.Server | null;
  /** Services to shutdown (called in order) */
  services?: ShutdownableService[];
  /** Resources to close (called after services) */
  resources?: CloseableResource[];
  /** Custom cleanup function */
  cleanup?: () => Promise<void>;
  /** Remove PID file on shutdown (default: true) */
  removePid?: boolean;
  /** Kill child processes on Windows (default: true) */
  killChildren?: boolean;
  /** Timeout for waiting child processes to exit (default: 5000) */
  childExitTimeout?: number;
}

/**
 * Close HTTP server with Windows-specific delays
 * Windows needs extra time to release sockets properly
 */
async function closeHttpServer(server: http.Server): Promise<void> {
  // Close all active connections
  try {
    server.closeAllConnections();
  } catch (error) {
    logger.warn('SYSTEM', 'HTTP server connection cleanup error', {}, error as Error);
  }

  // Give Windows time to close connections before closing server
  if (process.platform === 'win32') {
    await new Promise(r => setTimeout(r, 500));
  }

  // Close the server
  await new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });

  // Extra delay on Windows to ensure port is fully released
  if (process.platform === 'win32') {
    await new Promise(r => setTimeout(r, 500));
    logger.info('SYSTEM', 'Waited for Windows port cleanup');
  }
}

/**
 * Perform graceful shutdown of all services
 *
 * IMPORTANT: On Windows, we must kill all child processes before exiting
 * to prevent zombie ports. The socket handle can be inherited by children,
 * and if not properly closed, the port stays bound after process death.
 */
export async function performGracefulShutdown(config: GracefulShutdownConfig): Promise<void> {
  const {
    server,
    services = [],
    resources = [],
    cleanup,
    removePid = true,
    killChildren = true,
    childExitTimeout = 5000
  } = config;

  logger.info('SYSTEM', 'Shutdown initiated');

  // Clean up PID file on shutdown
  if (removePid) {
    removePidFile();
  }

  // STEP 1: Enumerate all child processes BEFORE we start closing things
  const childPids = killChildren ? await getChildProcesses(process.pid) : [];
  if (childPids.length > 0) {
    logger.info('SYSTEM', 'Found child processes', { count: childPids.length, pids: childPids });
  }

  // STEP 2: Close HTTP server first
  if (server) {
    try {
      await closeHttpServer(server);
      logger.info('SYSTEM', 'HTTP server closed');
    } catch (error) {
      logger.warn('SYSTEM', 'HTTP server close error', {}, error as Error);
    }
  }

  // STEP 3: Shutdown services in order
  for (const service of services) {
    try {
      await service.shutdown();
    } catch (error) {
      logger.warn('SYSTEM', 'Service shutdown error', {}, error as Error);
    }
  }

  // STEP 4: Close resources
  for (const resource of resources) {
    try {
      await resource.close();
    } catch (error) {
      logger.warn('SYSTEM', 'Resource close error', {}, error as Error);
    }
  }

  // STEP 5: Custom cleanup
  if (cleanup) {
    try {
      await cleanup();
    } catch (error) {
      logger.warn('SYSTEM', 'Custom cleanup error', {}, error as Error);
    }
  }

  // STEP 6: Force kill any remaining child processes (Windows zombie port fix)
  if (childPids.length > 0) {
    logger.info('SYSTEM', 'Force killing remaining children');
    for (const pid of childPids) {
      await forceKillProcess(pid);
    }
    await waitForProcessesExit(childPids, childExitTimeout);
  }

  logger.info('SYSTEM', 'Shutdown complete');
}

/**
 * Create a shutdown handler that can be used with signal handlers
 */
export function createShutdownHandler(config: GracefulShutdownConfig): () => Promise<void> {
  return () => performGracefulShutdown(config);
}
