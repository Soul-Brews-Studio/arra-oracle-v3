import { getTableName } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { introspectDrizzleTables } from '../../cli/commands/backup.ts';
import type { DatabaseConnection } from '../../db/index.ts';
import { createStorageBackend } from '../../storage/registry.ts';
import {
  EXPORT_FORMATS,
  normalizeRecords,
  type ExportRecord,
} from './format.ts';

type ExportTable = ReturnType<typeof introspectDrizzleTables>[number];
type QueryConnection = Pick<DatabaseConnection, 'db' | 'sqlite'>;
type ExportEngine = {
  exportOracleData(options: Record<string, unknown>): Promise<Record<string, unknown>>;
  readOracleV2Documents(connection: Pick<DatabaseConnection, 'sqlite'>): ExportRecord[];
};

export interface ExportCoreRoutesDeps {
  connection?: DatabaseConnection;
  outputDir?: string;
  now?: () => Date;
  idGenerator?: () => string;
}

type ExportRunBody = {
  outputDir?: string;
};

const exporterUrl = new URL('../../../tools/export-app/exporter.ts', import.meta.url).href;

async function loadExportEngine(): Promise<ExportEngine> {
  return await import(exporterUrl) as ExportEngine;
}

function openConnection(deps: ExportCoreRoutesDeps): { connection: QueryConnection; close?: () => void } {
  if (deps.connection) return { connection: deps.connection };
  const storage = createStorageBackend({ readonly: true });
  return { connection: { db: storage.db, sqlite: storage.sqlite }, close: () => storage.close() };
}

function tableMap(): Map<string, ExportTable> {
  return new Map(introspectDrizzleTables().map((table) => [getTableName(table), table]));
}

function selectRows(connection: QueryConnection, table: ExportTable): ExportRecord[] {
  return normalizeRecords((connection.db as any).select().from(table).all() as ExportRecord[]);
}

function readCollectionRows(connection: QueryConnection, collection: string): ExportRecord[] | null {
  const table = tableMap().get(collection);
  return table ? selectRows(connection, table) : null;
}

function collectionSummary(connection: QueryConnection) {
  return [...tableMap()].map(([name, table]) => ({
    name,
    rowCount: selectRows(connection, table).length,
    documentsUrl: `/api/v1/export/documents/${encodeURIComponent(name)}`,
  }));
}

function defaultOutputRoot(): string {
  return path.join(ORACLE_DATA_DIR, 'export-app', 'http');
}

function resolveOutputDir(deps: ExportCoreRoutesDeps, body: ExportRunBody): { outputDir: string; jobId: string } {
  const jobId = deps.idGenerator?.() ?? randomUUID();
  if (body.outputDir?.trim()) return { outputDir: path.resolve(body.outputDir), jobId };
  return { outputDir: path.join(deps.outputDir ?? defaultOutputRoot(), jobId), jobId };
}

export function createExportCoreRoutes(deps: ExportCoreRoutesDeps = {}) {
  return new Elysia()
    .get('/export/collections', () => {
      const { connection, close } = openConnection(deps);
      try {
        return {
          collections: collectionSummary(connection),
          formats: EXPORT_FORMATS,
          documents: { collection: 'oracle_documents', url: '/api/v1/export/documents/oracle_documents' },
        };
      } finally {
        close?.();
      }
    }, {
      detail: { tags: ['export'], summary: 'List exportable database collections' },
    })
    .get('/export/documents/:collection', async ({ params, set }) => {
      const { connection, close } = openConnection(deps);
      try {
        if (params.collection === 'oracle_documents') {
          const { readOracleV2Documents } = await loadExportEngine();
          const documents = readOracleV2Documents(connection);
          return { collection: params.collection, count: documents.length, documents };
        }
        const rows = readCollectionRows(connection, params.collection);
        if (!rows) {
          set.status = 404;
          return { error: `Unknown export collection: ${params.collection}` };
        }
        return { collection: params.collection, count: rows.length, documents: rows };
      } finally {
        close?.();
      }
    }, {
      params: t.Object({ collection: t.String() }),
      detail: { tags: ['export'], summary: 'Read exportable documents for one collection' },
    })
    .post('/export/run', async ({ body, set }) => {
      const runBody = (body ?? {}) as ExportRunBody;
      const { outputDir, jobId } = resolveOutputDir(deps, runBody);
      try {
        const { exportOracleData } = await loadExportEngine();
        const result = await exportOracleData({
          outputDir,
          connection: deps.connection,
          now: deps.now,
          progress: () => {},
        });
        return { success: true, jobId, ...result };
      } catch (error) {
        set.status = 500;
        return { error: 'Export run failed', message: error instanceof Error ? error.message : String(error) };
      }
    }, {
      body: t.Object({ outputDir: t.Optional(t.String()) }),
      detail: { tags: ['export'], summary: 'Run the standalone export engine over the Oracle database' },
    });
}

export const exportCoreRoutes = new Elysia({ prefix: '/api' }).use(createExportCoreRoutes());
