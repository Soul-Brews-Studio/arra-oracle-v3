/**
 * Service health registry — background poller that tracks upstream health.
 *
 * If a service has a `healthCheck` URL in its config, the registry pings it
 * on interval and marks the service up/down. The gateway checks `isUp()`
 * before proxying — if down, it returns the fallback immediately instead
 * of waiting for a timeout.
 */
import type { ServiceConfig } from './config.ts';

export interface ServiceHealth {
  status: 'up' | 'down' | 'unknown';
  lastCheck: number;
  lastError?: string;
  responseTime?: number;
}

const DEFAULT_INTERVAL_MS = 30_000;
const CHECK_TIMEOUT_MS = 5_000;

export class HealthRegistry {
  private health = new Map<string, ServiceHealth>();
  private interval: Timer | null = null;

  /**
   * Start polling services that have a healthCheck URL.
   * Services without healthCheck are always assumed "up".
   */
  start(services: Record<string, ServiceConfig>, intervalMs = DEFAULT_INTERVAL_MS): void {
    // Seed initial state
    for (const [name, svc] of Object.entries(services)) {
      if (svc.healthCheck) {
        this.health.set(name, { status: 'unknown', lastCheck: 0 });
      }
    }

    if (this.health.size === 0) return; // nothing to poll

    // Fire first check immediately, then repeat on interval
    this.checkAll(services);
    this.interval = setInterval(() => this.checkAll(services), intervalMs);
    // Don't prevent process exit
    if (typeof this.interval === 'object' && 'unref' in this.interval) {
      this.interval.unref();
    }

    console.log(
      `[Gateway:Health] Polling ${this.health.size} service(s) every ${intervalMs}ms`,
    );
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getStatus(serviceName: string): ServiceHealth {
    return this.health.get(serviceName) ?? { status: 'unknown', lastCheck: 0 };
  }

  getAllStatus(): Record<string, ServiceHealth> {
    return Object.fromEntries(this.health);
  }

  /** Returns true if the service has no health check or is up. */
  isUp(serviceName: string): boolean {
    const h = this.health.get(serviceName);
    if (!h) return true; // no health check configured → assume up
    return h.status !== 'down';
  }

  private async checkAll(services: Record<string, ServiceConfig>): Promise<void> {
    const checks = Object.entries(services)
      .filter(([, svc]) => svc.healthCheck)
      .map(([name, svc]) => this.checkOne(name, svc.healthCheck!));

    await Promise.allSettled(checks);
  }

  private async checkOne(name: string, url: string): Promise<void> {
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const responseTime = Date.now() - start;

      if (res.ok) {
        this.health.set(name, { status: 'up', lastCheck: start, responseTime });
      } else {
        this.health.set(name, {
          status: 'down',
          lastCheck: start,
          responseTime,
          lastError: `HTTP ${res.status}`,
        });
      }
    } catch (e) {
      this.health.set(name, {
        status: 'down',
        lastCheck: start,
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
