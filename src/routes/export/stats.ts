import { getTableName } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { db as defaultDb, type DatabaseConnection } from '../../db/index.ts';
import { introspectDrizzleTables } from '../../cli/commands/backup.ts';
import { isMissingTableError } from '../../db/errors.ts';

type ExportRecord = Record<string, unknown>;
type DumpTable = ReturnType<typeof introspectDrizzleTables>[number];
type QueryConnection = Pick<DatabaseConnection, 'db'>;

export interface ExportStats {
  collections: number;
  totalDocs: number;
  totalSize: string;
  lastExport?: Date;
}

export interface ExportStatsDeps {
  connection?: QueryConnection;
  exportDir?: string;
}

function connectionFrom(deps: ExportStatsDeps): QueryConnection {
  return deps.connection ?? { db: defaultDb };
}

function selectRows(connection: QueryConnection, table: DumpTable): ExportRecord[] {
  try {
    return (connection.db as any).select().from(table).all() as ExportRecord[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

export function formatExportSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? String(Math.round(value)) : value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

async function newestFileMtime(dir: string): Promise<Date | undefined> {
  let latest: Date | undefined;

  async function visit(current: string): Promise<void> {
    const entries = await readEntries(current);
    if (!entries) return;

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const info = await stat(fullPath);
      if (!latest || info.mtime > latest) latest = info.mtime;
    }
  }

  async function readEntries(current: string) {
    try {
      return await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  await visit(dir);
  return latest;
}

export async function buildExportStats(deps: ExportStatsDeps = {}): Promise<ExportStats> {
  const connection = connectionFrom(deps);
  const tables = introspectDrizzleTables();
  let totalDocs = 0;
  let totalBytes = 0;

  for (const table of tables) {
    const name = getTableName(table);
    const rows = selectRows(connection, table);
    totalDocs += rows.length;
    totalBytes += Buffer.byteLength(JSON.stringify({ [name]: rows }), 'utf8');
  }

  const lastExport = await newestFileMtime(deps.exportDir ?? path.join(ORACLE_DATA_DIR, 'export-app'));
  return {
    collections: tables.length,
    totalDocs,
    totalSize: formatExportSize(totalBytes),
    ...(lastExport ? { lastExport } : {}),
  };
}

export function createExportStatsRoutes(deps: ExportStatsDeps = {}) {
  return new Elysia().get('/export/stats', () => buildExportStats(deps), {
    detail: { tags: ['export'], summary: 'Export dashboard summary statistics' },
  });
}

export const exportStatsRoutes = new Elysia({ prefix: '/api' }).use(createExportStatsRoutes());
