/**
 * Unit tests for gateway health registry.
 */
import { describe, test, expect, afterEach, mock } from 'bun:test';
import { HealthRegistry } from '../health.ts';

describe('HealthRegistry', () => {
  let registry: HealthRegistry;

  afterEach(() => {
    registry?.stop();
  });

  test('isUp returns true for services without healthCheck', () => {
    registry = new HealthRegistry();
    // Never started — no healthCheck configured
    expect(registry.isUp('vector')).toBe(true);
  });

  test('getStatus returns unknown for untracked services', () => {
    registry = new HealthRegistry();
    const status = registry.getStatus('nonexistent');
    expect(status.status).toBe('unknown');
    expect(status.lastCheck).toBe(0);
  });

  test('start seeds services that have healthCheck', () => {
    registry = new HealthRegistry();
    // Use a URL that will fail (no server) — we just test seeding
    registry.start(
      {
        vector: { url: 'http://localhost:19999', healthCheck: 'http://localhost:19999/health' },
        local: { url: 'http://localhost:3000' }, // no healthCheck
      },
      999_999, // long interval so no second poll fires
    );

    // vector should be seeded as unknown (first check is async)
    // local should not be tracked
    expect(registry.getStatus('vector').status).not.toBe(undefined);
    expect(registry.isUp('local')).toBe(true); // no healthCheck → always up
  });

  test('getAllStatus returns map of tracked services', () => {
    registry = new HealthRegistry();
    registry.start(
      {
        a: { url: 'http://localhost:1', healthCheck: 'http://localhost:1/h' },
        b: { url: 'http://localhost:2', healthCheck: 'http://localhost:2/h' },
      },
      999_999,
    );

    const all = registry.getAllStatus();
    expect(Object.keys(all)).toContain('a');
    expect(Object.keys(all)).toContain('b');
  });

  test('stop clears interval', () => {
    registry = new HealthRegistry();
    registry.start(
      { v: { url: 'http://localhost:1', healthCheck: 'http://localhost:1/h' } },
      100,
    );
    // Should not throw
    registry.stop();
    registry.stop(); // idempotent
  });

  test('marks service down when fetch fails', async () => {
    registry = new HealthRegistry();
    registry.start(
      { bad: { url: 'http://localhost:19999', healthCheck: 'http://localhost:19999/health' } },
      999_999,
    );

    // Wait for the initial check to complete
    await new Promise((r) => setTimeout(r, 200));

    const status = registry.getStatus('bad');
    expect(status.status).toBe('down');
    expect(status.lastError).toBeDefined();
    expect(registry.isUp('bad')).toBe(false);
  });

  test('start with no healthCheck services is a no-op', () => {
    registry = new HealthRegistry();
    registry.start(
      { local: { url: 'http://localhost:3000' } },
      100,
    );
    // No services tracked — should be fine
    expect(Object.keys(registry.getAllStatus())).toHaveLength(0);
    registry.stop();
  });
});
