/**
 * HealthMonitor - Port monitoring, health checks, and HTTP-based control
 *
 * Lightweight health monitoring for Bun applications.
 * Forked from claude-mem's infrastructure module.
 *
 * Handles:
 * - Port availability checking
 * - Worker health/readiness polling
 * - HTTP-based shutdown requests
 */

import { logger } from './logger.ts';

export interface HealthCheckOptions {
  /** Base URL for health checks (default: http://127.0.0.1) */
  baseUrl?: string;
  /** Health endpoint path (default: /health) */
  healthPath?: string;
  /** Readiness endpoint path (default: /readiness) */
  readinessPath?: string;
  /** Shutdown endpoint path (default: /shutdown) */
  shutdownPath?: string;
}

const defaultOptions: Required<HealthCheckOptions> = {
  baseUrl: 'http://127.0.0.1',
  healthPath: '/health',
  readinessPath: '/readiness',
  shutdownPath: '/shutdown'
};

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeOptions(options: HealthCheckOptions = {}): Required<HealthCheckOptions> {
  const opts = { ...defaultOptions, ...options };
  return {
    baseUrl: opts.baseUrl.replace(/\/+$/, ''),
    healthPath: normalizePath(opts.healthPath),
    readinessPath: normalizePath(opts.readinessPath),
    shutdownPath: normalizePath(opts.shutdownPath),
  };
}

/**
 * Check if a port is in use by querying the health endpoint
 */
export async function isPortInUse(
  port: number,
  options: HealthCheckOptions = {}
): Promise<boolean> {
  const opts = normalizeOptions(options);
  try {
    const response = await fetch(`${opts.baseUrl}:${port}${opts.healthPath}`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for the worker to become fully ready (passes readiness check)
 * @param port Worker port to check
 * @param timeoutMs Maximum time to wait in milliseconds
 * @returns true if worker became ready, false if timeout
 */
export async function waitForHealth(
  port: number,
  timeoutMs: number = 30000,
  options: HealthCheckOptions = {}
): Promise<boolean> {
  const opts = normalizeOptions(options);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${opts.baseUrl}:${port}${opts.readinessPath}`);
      if (response.ok) return true;
    } catch {
      logger.debug('SYSTEM', 'Service not ready yet, will retry', { port });
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Wait for a port to become free (no longer responding to health checks)
 * Used after shutdown to confirm the port is available for restart
 */
export async function waitForPortFree(
  port: number,
  timeoutMs: number = 10000,
  options: HealthCheckOptions = {}
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (!(await isPortInUse(port, options))) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Send HTTP shutdown request to a running worker
 * @param port Worker port
 * @returns true if shutdown request was acknowledged, false otherwise
 */
export async function httpShutdown(
  port: number,
  options: HealthCheckOptions = {}
): Promise<boolean> {
  const opts = normalizeOptions(options);

  try {
    const response = await fetch(`${opts.baseUrl}:${port}${opts.shutdownPath}`, {
      method: 'POST'
    });
    if (!response.ok) {
      logger.warn('SYSTEM', 'Shutdown request returned error', { port, status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message?.includes('ECONNREFUSED')) {
      logger.debug('SYSTEM', 'Worker already stopped', { port });
      return false;
    }
    logger.warn('SYSTEM', 'Shutdown request failed', { port }, error as Error);
    return false;
  }
}

/**
 * Check worker status via health endpoint
 */
export async function getWorkerStatus(
  port: number,
  options: HealthCheckOptions = {}
): Promise<{ running: boolean; healthy: boolean }> {
  const opts = normalizeOptions(options);

  try {
    const healthResponse = await fetch(`${opts.baseUrl}:${port}${opts.healthPath}`);
    if (!healthResponse.ok) {
      return { running: true, healthy: false };
    }

    const readinessResponse = await fetch(`${opts.baseUrl}:${port}${opts.readinessPath}`);
    return { running: true, healthy: readinessResponse.ok };
  } catch {
    return { running: false, healthy: false };
  }
}

/**
 * Get version from a running worker via API
 */
export async function getWorkerVersion(
  port: number,
  versionPath: string = '/version',
  options: HealthCheckOptions = {}
): Promise<string | null> {
  const opts = normalizeOptions(options);

  try {
    const response = await fetch(`${opts.baseUrl}:${port}${normalizePath(versionPath)}`);
    if (!response.ok) return null;
    const data = await response.json() as { version?: unknown };
    return typeof data.version === 'string' && data.version.trim() ? data.version.trim() : null;
  } catch {
    return null;
  }
}
