import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Elysia, t } from 'elysia';
import { desc, eq } from 'drizzle-orm';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { db, exportJobs } from '../../db/index.ts';
import { createOracleV2Client, type OracleV2Document } from '../../lib/oracle-v2-client.ts';
import { currentTenantId, tenantDataPath, tenantIdForWrite } from '../../middleware/tenant.ts';
import { exportHistoryRunBody, type ExportHistoryJob } from './model.ts';
import { formatOracleV2DocumentsCsv } from './oracle-v2-csv.ts';
import { formatOracleV2DocumentsMarkdown } from './oracle-v2-markdown.ts';
import { rememberExportProgress } from './progress.ts';
import { canReadTenantResource } from './tenant.ts';
import { recordExportHistory } from './history-store.ts';

function clean(value: string): string {
  return value.trim();
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

function oracleV2Url(body: { oracleV2Url?: string; baseUrl?: string }): string | undefined {
  return (body.oracleV2Url ?? body.baseUrl)?.trim() || undefined;
}

function oracleV2Extension(format: string): string {
  if (format === 'markdown') return 'md';
  if (format === 'csv') return 'csv';
  return 'json';
}

function oracleV2ContentType(format: string): string {
  if (format === 'markdown') return 'text/markdown; charset=utf-8';
  if (format === 'csv') return 'text/csv; charset=utf-8';
  return 'application/json; charset=utf-8';
}

function downloadUrl(jobId: string): string {
  return `/api/v1/export/history/${encodeURIComponent(jobId)}/download`;
}

function artifactPath(job: ExportHistoryJob): string {
  const filename = `${safeName(job.collection)}-${job.id}.${oracleV2Extension(job.format)}`;
  return path.join(tenantDataPath(path.join(ORACLE_DATA_DIR, 'exports', 'oracle-v2')), filename);
}

function rememberDone(job: ExportHistoryJob, artifact: { filename: string; sizeBytes: number }): void {
  rememberExportProgress({
    id: job.id,
    jobId: job.id,
    tenantId: job.tenantId,
    status: 'completed',
    progress: 100,
    updatedAt: new Date(job.timestamp).toISOString(),
    downloadUrl: downloadUrl(job.id),
    filename: artifact.filename,
    sizeBytes: artifact.sizeBytes,
    fileSizeEstimate: artifact.sizeBytes,
  });
}

async function writeOracleV2Export(
  job: ExportHistoryJob,
  baseUrl: string,
): Promise<{ filePath: string; filename: string; sizeBytes: number; documents: OracleV2Document[]; collections: string[] }> {
  const client = createOracleV2Client({ baseUrl });
  const collections = await client.listCollections();
  const names = collections.map((item) => item.name);
  if (!names.includes(job.collection)) throw new Error(`Oracle v2 collection not found: ${job.collection}`);

  const documents = await client.listDocuments(job.collection);
  const exportedAt = new Date(job.timestamp).toISOString();
  const filename = `${safeName(job.collection)}-${job.id}.${oracleV2Extension(job.format)}`;
  const outputDir = tenantDataPath(path.join(ORACLE_DATA_DIR, 'exports', 'oracle-v2'));
  const filePath = path.join(outputDir, filename);
  const input = { baseUrl, collection: job.collection, exportedAt, documents, collections };
  const payload = job.format === 'markdown'
    ? formatOracleV2DocumentsMarkdown(input)
    : job.format === 'csv'
      ? formatOracleV2DocumentsCsv(input)
      : `${JSON.stringify({
      version: 1,
      source: 'oracle-v2',
      baseUrl,
      exportedAt,
      collection: job.collection,
      documentCount: documents.length,
      collections,
      documents,
    }, null, 2)}\n`;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, payload, 'utf8');
  return { filePath, filename, sizeBytes: new TextEncoder().encode(payload).byteLength, documents, collections: names };
}

export function createExportHistoryRoutes() {
  return new Elysia()
    .get('/export/oracle-v2/collections', async ({ query, set }) => {
      const baseUrl = oracleV2Url(query);
      if (!baseUrl) {
        set.status = 400;
        return { error: 'baseUrl query parameter is required' };
      }
      try {
        const collections = await createOracleV2Client({ baseUrl }).listCollections();
        return { baseUrl, collections, total: collections.length };
      } catch (error) {
        set.status = 502;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }, {
      query: t.Object({
        baseUrl: t.Optional(t.String({ minLength: 1 })),
        oracleV2Url: t.Optional(t.String({ minLength: 1 })),
      }),
      detail: {
        tags: ['export'],
        menu: { group: 'hidden' },
        summary: 'List collections from a legacy Oracle v2 backend',
      },
    })
    .post('/export/run', async ({ body, set }) => {
      const collection = clean(body.collection);
      const format = clean(body.format);
      const status = clean(body.status ?? 'completed');
      if (!collection || !format || !status) {
        set.status = 400;
        return { error: 'collection, format, and status must be non-empty' };
      }

      const baseUrl = oracleV2Url(body);
      if (baseUrl && format !== 'json' && format !== 'markdown' && format !== 'csv') {
        set.status = 400;
        return { error: 'Oracle v2 export supports json, markdown, or csv format only', format };
      }

      const job: ExportHistoryJob = {
        id: randomUUID(),
        tenantId: tenantIdForWrite(),
        collection,
        format,
        timestamp: Date.now(),
        status,
      };
      recordExportHistory(job);

      if (baseUrl) {
        try {
          const artifact = await writeOracleV2Export(job, baseUrl);
          rememberDone(job, artifact);
          set.status = 201;
          return {
            job,
            artifact: {
              filePath: artifact.filePath,
              filename: artifact.filename,
              contentType: oracleV2ContentType(format),
              documentCount: artifact.documents.length,
              sizeBytes: artifact.sizeBytes,
              downloadUrl: downloadUrl(job.id),
            },
            collections: artifact.collections,
          };
        } catch (error) {
          set.status = 502;
          return { error: error instanceof Error ? error.message : String(error), job };
        }
      }

      set.status = 201;
      return { job };
    }, {
      body: exportHistoryRunBody,
      detail: {
        tags: ['export'],
        menu: { group: 'hidden' },
        summary: 'Record an export job history entry',
      },
    })
    .get('/export/history', () => {
      const selected = db.select({
        id: exportJobs.id,
        tenantId: exportJobs.tenantId,
        collection: exportJobs.collection,
        format: exportJobs.format,
        timestamp: exportJobs.timestamp,
        status: exportJobs.status,
      }).from(exportJobs);
      const tenantId = currentTenantId();
      const query = tenantId ? selected.where(eq(exportJobs.tenantId, tenantId)) : selected;
      const jobs = query.orderBy(desc(exportJobs.timestamp)).limit(50).all();
      return { jobs, total: jobs.length, limit: 50 };
    }, {
      detail: {
        tags: ['export'],
        menu: { group: 'hidden' },
        summary: 'List latest export job history entries',
      },
    })
    .get('/export/history/:jobId/download', async ({ params, set }) => {
      const job = db.select().from(exportJobs).where(eq(exportJobs.id, params.jobId)).get();
      if (!job || !canReadTenantResource(job.tenantId)) {
        set.status = 404;
        return { error: 'Export artifact not found', id: params.jobId };
      }
      const filename = `${safeName(job.collection)}-${job.id}.${oracleV2Extension(job.format)}`;
      try {
        return new Response(await readFile(artifactPath(job)), {
          headers: {
            'Content-Type': oracleV2ContentType(job.format),
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      } catch {
        set.status = 404;
        return { error: 'Export artifact file not found', id: params.jobId };
      }
    }, {
      params: t.Object({ jobId: t.String() }),
      detail: {
        tags: ['export'],
        menu: { group: 'hidden' },
        summary: 'Download a legacy Oracle v2 export artifact',
      },
    });
}

export const exportHistoryRoutes = new Elysia({ prefix: '/api' }).use(createExportHistoryRoutes());
