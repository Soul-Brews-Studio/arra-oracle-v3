import { Elysia, t } from 'elysia';
import { statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH, ORACLE_DATA_DIR } from '../../config.ts';
import { sqlite } from '../../db/index.ts';
import { readVectorBackendHealth } from '../../vector/health.ts';
import type { HealthEndpointOptions } from './health.ts';

type ComponentStatus = 'ok' | 'degraded' | 'down';
type DbStatus = { status: 'connected' } | { status: 'error'; error: string };
type DeepHealthOptions = Pick<HealthEndpointOptions, 'dbPing' | 'vectorHealth'> & {
  diskPath?: string;
  diskUsage?: () => DiskHealth;
  memoryUsage?: () => NodeJS.MemoryUsage;
};

type DiskHealth = {
  status: 'ok' | 'warning' | 'error';
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  error?: string;
};

function deepHealthResponseSchema() {
  return t.Object({
    status: t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('down')]),
    checked_at: t.String(),
    db: t.Object({
      status: t.Union([t.Literal('connected'), t.Literal('error')]),
      path: t.String(),
      latencyMs: t.Number(),
      error: t.Optional(t.String()),
    }),
    vector: t.Object({
      status: t.Union([t.Literal('ok'), t.Literal('degraded'), t.Literal('down')]),
      checked_at: t.String(),
      engines: t.Array(t.Any()),
      error: t.Optional(t.String()),
    }),
    disk: t.Object({
      status: t.Union([t.Literal('ok'), t.Literal('warning'), t.Literal('error')]),
      path: t.String(),
      totalBytes: t.Number(),
      freeBytes: t.Number(),
      usedBytes: t.Number(),
      usedPercent: t.Number(),
      error: t.Optional(t.String()),
    }),
    memory: t.Object({
      rss: t.Number(),
      heapTotal: t.Number(),
      heapUsed: t.Number(),
      external: t.Number(),
      arrayBuffers: t.Number(),
    }),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function timedDbCheck(ping?: HealthEndpointOptions['dbPing']) {
  const started = performance.now();
  let result: DbStatus;
  try {
    result = ping ? await ping() : defaultDbPing();
  } catch (error) {
    result = { status: 'error', error: errorMessage(error) };
  }
  return { ...result, path: DB_PATH, latencyMs: Math.round((performance.now() - started) * 100) / 100 };
}

function defaultDbPing(): DbStatus {
  try {
    sqlite.prepare('SELECT 1 as ok').get();
    return { status: 'connected' };
  } catch (error) {
    return { status: 'error', error: errorMessage(error) };
  }
}

function numeric(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function readDisk(path = ORACLE_DATA_DIR || dirname(DB_PATH)): DiskHealth {
  try {
    const stats = statfsSync(path);
    const blockSize = numeric(stats.bsize);
    const totalBytes = numeric(stats.blocks) * blockSize;
    const freeBytes = numeric(stats.bavail) * blockSize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10_000) / 100 : 0;
    return { status: usedPercent >= 90 ? 'warning' : 'ok', path, totalBytes, freeBytes, usedBytes, usedPercent };
  } catch (error) {
    return { status: 'error', path, totalBytes: 0, freeBytes: 0, usedBytes: 0, usedPercent: 0, error: errorMessage(error) };
  }
}

async function readVector(check = readVectorBackendHealth) {
  try {
    return await check();
  } catch (error) {
    return { status: 'down' as const, checked_at: new Date().toISOString(), engines: [], error: errorMessage(error) };
  }
}

function overallStatus(db: { status: string }, vector: { status: ComponentStatus }, disk: DiskHealth): ComponentStatus {
  if (db.status === 'error') return 'down';
  if (vector.status === 'down' || disk.status === 'error') return 'degraded';
  if (vector.status === 'degraded' || disk.status === 'warning') return 'degraded';
  return 'ok';
}

export function createDeepHealthEndpoint(options: DeepHealthOptions = {}) {
  return new Elysia().get('/health/deep', async () => {
    const [db, vector] = await Promise.all([timedDbCheck(options.dbPing), readVector(options.vectorHealth)]);
    const disk = options.diskUsage?.() ?? readDisk(options.diskPath);
    const memory = options.memoryUsage?.() ?? process.memoryUsage();
    return { status: overallStatus(db, vector, disk), checked_at: new Date().toISOString(), db, vector, disk, memory };
  }, {
    response: deepHealthResponseSchema(),
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      description: 'Runs a deep health check for database connectivity, vector backend status, disk space, and process memory usage.',
      summary: 'Deep dependency and resource health check',
    },
  });
}
