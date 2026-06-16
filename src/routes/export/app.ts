import { getTableName } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { db as defaultDb, type DatabaseConnection } from '../../db/index.ts';
import { introspectDrizzleTables } from '../../cli/commands/backup.ts';
import { createExportStatsRoutes } from './stats.ts';
import { createExportTestConnectionRoutes } from './test-connection.ts';
import { rememberExportProgress } from './progress.ts';
import { canReadTenantResource, currentExportTenantId, tenantScopedOutputDir, tenantWhereFor } from './tenant.ts';
import { recordExportHistory } from './history-store.ts';

type ExportRecord = Record<string, unknown>;
type BaseExportFormat = 'json' | 'csv' | 'markdown';
type ExportFormat = BaseExportFormat | 'jsonl';
type DumpTable = ReturnType<typeof introspectDrizzleTables>[number];
type QueryConnection = Pick<DatabaseConnection, 'db'>;

interface ExportTools {
  extensionFor(format: BaseExportFormat): string;
  formatCollection(name: string, rows: ExportRecord[], format: BaseExportFormat): string;
  normalizeRecords(rows: ExportRecord[]): ExportRecord[];
  graphRelationships(collections: Record<string, ExportRecord[]>): ExportRecord[];
}

interface ExportJob {
  jobId: string;
  tenantId?: string;
  collection: string;
  format: ExportFormat;
  includeGraph: boolean;
  filePath: string;
  filename: string;
  mimeType: string;
  rowCount: number;
  relationshipCount: number;
  sizeBytes: number;
  createdAt: string;
}

export interface ExportAppDeps {
  connection?: QueryConnection;
  outputDir?: string;
  now?: () => Date;
  idGenerator?: () => string;
}

const APP_EXPORT_FORMATS = ['json', 'csv', 'markdown', 'jsonl'] as const;
const formatsUrl = new URL('../../../tools/export-app/formats.ts', import.meta.url).href;
const graphUrl = new URL('../../../tools/export-app/graph.ts', import.meta.url).href;

async function loadExportTools(): Promise<ExportTools> {
  const [formats, graph] = await Promise.all([import(formatsUrl), import(graphUrl)]) as any[];
  return { ...formats, graphRelationships: graph.graphRelationships } as ExportTools;
}

function connectionFrom(deps: ExportAppDeps): QueryConnection {
  return deps.connection ?? { db: defaultDb };
}

function tableMap(): Map<string, DumpTable> {
  return new Map(introspectDrizzleTables().map((table) => [getTableName(table), table]));
}

function selectRows(connection: QueryConnection, table: DumpTable): ExportRecord[] {
  const query = (connection.db as any).select().from(table);
  const where = tenantWhereFor(table);
  return (where ? query.where(where) : query).all() as ExportRecord[];
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function mimeType(format: ExportFormat): string {
  if (format === 'csv') return 'text/csv; charset=utf-8';
  if (format === 'markdown') return 'text/markdown; charset=utf-8';
  if (format === 'jsonl') return 'application/x-ndjson; charset=utf-8';
  return 'application/json; charset=utf-8';
}

function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === 'string' && APP_EXPORT_FORMATS.includes(value as ExportFormat);
}

function truthy(value: unknown): boolean { return value === true || value === 'true' || value === '1'; }

function extensionFor(format: ExportFormat, tools: ExportTools): string {
  return format === 'jsonl' ? 'jsonl' : tools.extensionFor(format);
}

function formatJsonl(rows: ExportRecord[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

function formatRows(name: string, rows: ExportRecord[], format: ExportFormat, tools: ExportTools): string {
  return format === 'jsonl' ? formatJsonl(rows) : tools.formatCollection(name, rows, format);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function allCollections(connection: QueryConnection, tools: ExportTools): Promise<Record<string, ExportRecord[]>> {
  return Object.fromEntries([...tableMap()].map(([name, table]) => [name, tools.normalizeRecords(selectRows(connection, table))]));
}

function attachGraph(content: string, format: ExportFormat, relationships: ExportRecord[]): string {
  if (relationships.length === 0) return content;
  if (format === 'json') {
    const payload = JSON.parse(content);
    payload.graph = { relationshipCount: relationships.length, relationships };
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  if (format === 'jsonl') {
    const graphRows = relationships.map((row) => JSON.stringify({ collection: 'relationships', ...row }));
    return `${content}${graphRows.join('\n')}\n`;
  }
  if (format === 'markdown') {
    const lines = ['# graph_relationships', '', `Rows: ${relationships.length}`, ''];
    relationships.forEach((row, index) => lines.push(`## relationship-${index + 1}`, '', `- **type**: ${row.type}`, `- **from**: ${row.from}`, `- **to**: ${row.to}`, `- **metadata**: \`${JSON.stringify(row.metadata ?? {})}\``, ''));
    return `${content}\n\n${lines.join('\n')}`;
  }
  const header = 'relationship_type,from,to,metadata';
  const rows = relationships.map((row) => [row.type, row.from, row.to, row.metadata].map(csvCell).join(','));
  return `${content}\n${header}\n${rows.join('\n')}\n`;
}

export function createExportAppRoutes(deps: ExportAppDeps = {}) {
  const jobs = new Map<string, ExportJob>();

  return new Elysia()
    .get('/export/app/collections', async () => {
      const connection = connectionFrom(deps);
      const collections = [...tableMap()].map(([name, table]) => ({ name, rowCount: selectRows(connection, table).length }));
      return { collections, formats: APP_EXPORT_FORMATS, graph: { collection: 'relationships' } };
    })
    .get('/export/app', async ({ query, set }) => {
      const tools = await loadExportTools();
      const format = query.format ?? 'json';
      if (!isExportFormat(format)) {
        set.status = 400;
        return { error: 'Invalid format', format, formats: APP_EXPORT_FORMATS };
      }

      const connection = connectionFrom(deps);
      const tables = tableMap();
      const isGraph = query.collection === 'relationships';
      const table = tables.get(query.collection);
      if (!isGraph && !table) {
        set.status = 404;
        return { error: `Unknown export collection: ${query.collection}` };
      }

      const includeGraph = truthy(query.includeGraph);
      const collections = includeGraph || isGraph ? await allCollections(connection, tools) : {};
      const relationships = includeGraph || isGraph ? tools.graphRelationships(collections) : [];
      const rows = isGraph ? relationships : tools.normalizeRecords(selectRows(connection, table!));
      if (!isGraph && rows.length === 0) {
        set.status = 404;
        return { error: 'Collection is empty', collection: query.collection };
      }

      const base = formatRows(query.collection, rows, format, tools);
      const content = !isGraph && includeGraph ? attachGraph(base, format, relationships) : base;
      const filename = `${safeName(query.collection)}.${extensionFor(format, tools)}`;
      return new Response(content, {
        headers: { 'Content-Type': mimeType(format), 'Content-Disposition': `attachment; filename="${filename}"` },
      });
    }, {
      query: t.Object({ collection: t.String(), format: t.Optional(t.String()), includeGraph: t.Optional(t.String()), includeMetadata: t.Optional(t.String()) }),
    })
    .post('/export/app/run', async ({ body, set }) => {
      const tools = await loadExportTools();
      const format = body.format ?? 'json';
      if (!isExportFormat(format)) {
        set.status = 400;
        return { error: 'Invalid format', format, formats: APP_EXPORT_FORMATS };
      }

      const connection = connectionFrom(deps);
      const tables = tableMap();
      const isGraph = body.collection === 'relationships';
      const table = tables.get(body.collection);
      if (!isGraph && !table) {
        set.status = 404;
        return { error: `Unknown export collection: ${body.collection}` };
      }

      const collections = body.includeGraph || isGraph ? await allCollections(connection, tools) : {};
      const relationships = body.includeGraph || isGraph ? tools.graphRelationships(collections) : [];
      const rows = isGraph ? relationships : tools.normalizeRecords(selectRows(connection, table!));
      if (!isGraph && rows.length === 0) {
        set.status = 404;
        return { error: 'Collection is empty', collection: body.collection };
      }
      const base = formatRows(body.collection, rows, format, tools);
      const content = !isGraph && body.includeGraph ? attachGraph(base, format, relationships) : base;
      const jobId = deps.idGenerator?.() ?? randomUUID();
      const tenantId = currentExportTenantId();
      const outputDir = tenantScopedOutputDir(deps.outputDir ?? path.join(ORACLE_DATA_DIR, 'export-app', 'http'));
      const filename = `${safeName(body.collection)}-${jobId}.${extensionFor(format, tools)}`;
      const filePath = path.join(outputDir, filename);
      await mkdir(outputDir, { recursive: true });
      await writeFile(filePath, content, 'utf8');
      const sizeBytes = new TextEncoder().encode(content).byteLength;
      const downloadUrl = `/api/v1/export/app/download/${jobId}`;

      const job: ExportJob = {
        jobId,
        tenantId,
        collection: body.collection,
        format,
        includeGraph: Boolean(body.includeGraph),
        filePath,
        filename,
        mimeType: mimeType(format),
        rowCount: rows.length,
        relationshipCount: relationships.length,
        sizeBytes,
        createdAt: (deps.now?.() ?? new Date()).toISOString(),
      };
      jobs.set(jobId, job);
      recordExportHistory({ id: jobId, tenantId, collection: job.collection, format: job.format, timestamp: Date.parse(job.createdAt), status: 'completed' });
      rememberExportProgress({ id: jobId, jobId, tenantId, status: 'completed', progress: 100, updatedAt: job.createdAt, downloadUrl, filename, fileSizeEstimate: sizeBytes, sizeBytes });
      return { ...job, filePath: undefined, status: 'completed', progress: 100, downloadUrl };
    }, {
      body: t.Object({ collection: t.String(), format: t.Optional(t.String()), includeGraph: t.Optional(t.Boolean()) }),
    })
    .get('/export/app/download/:jobId', async ({ params, set }) => {
      const job = jobs.get(params.jobId);
      if (!job || !canReadTenantResource(job.tenantId)) {
        set.status = 404;
        return { error: `Unknown export job: ${params.jobId}` };
      }
      return new Response(await readFile(job.filePath), {
        headers: { 'Content-Type': job.mimeType, 'Content-Disposition': `attachment; filename="${job.filename}"` },
      });
    }, { params: t.Object({ jobId: t.String() }) });
}

export const exportAppRoutes = new Elysia({ prefix: '/api' })
  .use(createExportAppRoutes())
  .use(createExportStatsRoutes())
  .use(createExportTestConnectionRoutes());
