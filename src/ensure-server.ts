/**
 * Ensure Oracle HTTP Server is Running
 *
 * Auto-starts the server if not running.
 * Used by MCP tools and CLI to guarantee server availability.
 */

import path from 'path';
import fs from 'fs';
import {
  readPidFile,
  isProcessAlive,
  spawnDaemon,
  configure,
} from './process-manager/index.ts';
import { waitForHealth, isPortInUse } from './process-manager/HealthMonitor.ts';
import { acquireStartLock, releaseStartLock, cleanupStalePidFile } from './server/start-lock.ts';

import { PORT, ORACLE_DATA_DIR } from './config.ts';

const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const SERVER_SCRIPT = path.join(import.meta.dirname || __dirname, 'server.ts');

// Configure process manager to use oracle data dir
configure({ dataDir: ORACLE_DATA_DIR, pidFileName: 'oracle-http.pid' });

export interface EnsureServerOptions {
  /** Timeout in ms to wait for server to be healthy (default: 10000) */
  timeout?: number;
  /** If true, print status messages (default: false) */
  verbose?: boolean;
}

/**
 * Acquire lock (prevents race conditions in parallel calls)
 */
/**
 * Check if server is healthy via HTTP
 */
async function isServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const data = await response.json() as import('./server/types.js').HealthResponse;
      return data.status === 'ok';
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Ensure the Oracle HTTP server is running.
 * Returns true if server is ready, false if failed to start.
 */
export async function ensureServerRunning(options: EnsureServerOptions = {}): Promise<boolean> {
  const { timeout = 10000, verbose = false } = options;

  // 0. Clean up stale PID file if process died unexpectedly
  cleanupStalePidFile(verbose);

  // 1. Quick health check - maybe it's already running
  if (await isServerHealthy()) {
    if (verbose) console.log('🔮 Oracle server already running');
    return true;
  }

  // 2. Check PID file - maybe process exists but not healthy yet
  const pidInfo = readPidFile();
  if (pidInfo && isProcessAlive(pidInfo.pid)) {
    if (verbose) console.log(`🔮 Oracle server process exists (PID ${pidInfo.pid}), waiting for health...`);

    // Wait for it to become healthy
    const healthy = await waitForHealthWithTimeout(timeout);
    if (healthy) {
      if (verbose) console.log('🔮 Oracle server is now healthy');
      return true;
    }

    // Process exists but not responding - something's wrong
    if (verbose) console.log('⚠️ Oracle server process exists but not responding');
  }

  // 3. Acquire lock to prevent race conditions
  if (!acquireStartLock()) {
    if (verbose) console.log('🔒 Another process is starting the server, waiting...');
    // Wait and re-check health
    const healthy = await waitForHealthWithTimeout(timeout);
    if (healthy) {
      if (verbose) console.log('🔮 Oracle server is now healthy');
      return true;
    }
    if (verbose) console.log('⚠️ Timed out waiting for other process to start server');
    return false;
  }

  try {
    // 4. Re-check health after acquiring lock (another process may have started it)
    if (await isServerHealthy()) {
      if (verbose) console.log('🔮 Oracle server already running');
      return true;
    }

    // 5. Check if port is in use by something else
    if (await isPortInUse(PORT)) {
      if (verbose) console.log(`⚠️ Port ${PORT} is in use but server not responding`);
      return false;
    }

    // 5. Start the server
    if (verbose) console.log('🔮 Starting Oracle server...');

    const pid = spawnDaemon({
      scriptPath: SERVER_SCRIPT,
      port: PORT,
      portEnvVar: 'ORACLE_PORT',
      args: [], // No special args needed
    });

    if (!pid) {
      if (verbose) console.log('❌ Failed to spawn Oracle server');
      return false;
    }

    if (verbose) console.log(`🔮 Oracle server spawned (PID ${pid}), waiting for health...`);

    // 6. Wait for server to become healthy
    const healthy = await waitForHealthWithTimeout(timeout);

    if (healthy) {
      if (verbose) console.log('✅ Oracle server is ready');
      return true;
    } else {
      if (verbose) console.log('❌ Oracle server failed to become healthy');
      return false;
    }
  } finally {
    releaseStartLock();
  }
}

/**
 * Wait for server health with timeout
 */
async function waitForHealthWithTimeout(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const checkInterval = 200; // Check every 200ms

  while (Date.now() - start < timeoutMs) {
    if (await isServerHealthy()) {
      return true;
    }
    await new Promise(r => setTimeout(r, checkInterval));
  }

  return false;
}

/**
 * Get server status
 */
export async function getServerStatus(): Promise<{
  running: boolean;
  pid?: number;
  port: number;
  healthy: boolean;
  url: string;
}> {
  const pidInfo = readPidFile();
  const processAlive = pidInfo ? isProcessAlive(pidInfo.pid) : false;
  const healthy = await isServerHealthy();

  return {
    running: processAlive,
    pid: pidInfo?.pid,
    port: PORT,
    healthy,
    url: `http://localhost:${PORT}`,
  };
}

// CLI: Run directly to ensure server is running
if (import.meta.main) {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const status = process.argv.includes('--status') || process.argv.includes('-s');

  if (status) {
    // Just show status
    const s = await getServerStatus();
    console.log(JSON.stringify(s, null, 2));
    process.exit(s.healthy ? 0 : 1);
  } else {
    // Ensure running
    const success = await ensureServerRunning({ verbose: true, timeout: 15000 });
    process.exit(success ? 0 : 1);
  }
}
