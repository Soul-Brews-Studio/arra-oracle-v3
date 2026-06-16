import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Elysia } from 'elysia';
import { desc, eq } from 'drizzle-orm';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { db, exportJobs } from '../../db/index.ts';
import { createOracleV2Client, type OracleV2Document } from '../../lib/oracle-v2-client.ts';
import { currentTenantId, tenantDataPath, tenantIdForWrite } from '../../middleware/tenant.ts';
import { exportHistoryRunBody, type ExportHistoryJob } from './model.ts';
import { formatOracleV2DocumentsMarkdown } from './oracle-v2-markdown.ts';

function clean(value: string): string {
  return value.trim();
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'export';
}

function oracleV2Url(body: { oracleV2Url?: string; baseUrl?: string }): string | undefined {
  return (body.oracleV2Url ?? body.baseUrl)?.trim() || undefined;
}

function insertJob(job: ExportHistoryJob): void {
  db.insert(exportJobs).values(job).run();
}

async function writeOracleV2Export(
  job: ExportHistoryJob,
  baseUrl: string,
): Promise<{ filePath: string; filename: string; documents: OracleV2Document[]; collections: string[] }> {
  const client = createOracleV2Client({ baseUrl });
  const collections = await client.listCollections();
  const names = collections.map((item) => item.name);
  if (!names.includes(job.collection)) throw new Error(`Oracle v2 collection not found: ${job.collection}`);

  const documents = await client.listDocuments(job.collection);
  const exportedAt = new Date(job.timestamp).toISOString();
  const isMarkdown = job.format === 'markdown';
  const filename = `${safeName(job.collection)}-${job.id}.${isMarkdown ? 'md' : 'json'}`;
  const outputDir = tenantDataPath(path.join(ORACLE_DATA_DIR, 'exports', 'oracle-v2'));
  const filePath = path.join(outputDir, filename);
  const payload = isMarkdown
    ? formatOracleV2DocumentsMarkdown({ baseUrl, collection: job.collection, exportedAt, documents, collections })
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
  return { filePath, filename, documents, collections: names };
}

export function createExportHistoryRoutes() {
  return new Elysia()
    .post('/export/run', async ({ body, set }) => {
      const collection = clean(body.collection);
      const format = clean(body.format);
      const status = clean(body.status ?? 'completed');
      if (!collection || !format || !status) {
        set.status = 400;
        return { error: 'collection, format, and status must be non-empty' };
      }

      const baseUrl = oracleV2Url(body);
      if (baseUrl && format !== 'json' && format !== 'markdown') {
        set.status = 400;
        return { error: 'Oracle v2 export supports json or markdown format only', format };
      }

      const job: ExportHistoryJob = {
        id: randomUUID(),
        tenantId: tenantIdForWrite(),
        collection,
        format,
        timestamp: Date.now(),
        status,
      };
      insertJob(job);

      if (baseUrl) {
        try {
          const artifact = await writeOracleV2Export(job, baseUrl);
          set.status = 201;
          return {
            job,
            artifact: {
              filePath: artifact.filePath,
              filename: artifact.filename,
              contentType: format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
              documentCount: artifact.documents.length,
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
    });
}

export const exportHistoryRoutes = new Elysia({ prefix: '/api' }).use(createExportHistoryRoutes());
