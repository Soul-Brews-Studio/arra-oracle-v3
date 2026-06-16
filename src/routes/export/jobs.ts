import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { ORACLE_DATA_DIR } from '../../config.ts';
import { runWithTenant } from '../../middleware/tenant.ts';
import { buildDataExportPayload } from './build.ts';
import {
  resolveExportFormat,
  resolveExportSource,
  type ExportJobStatus,
  type ExportJobView,
  type ExportPayload,
  type ExportRequest,
} from './model.ts';
import { canReadTenantResource, currentExportTenantId, tenantScopedOutputDir } from './tenant.ts';

export type ExportBuilder = (
  request: ExportRequest,
  progress: (value: number) => void,
) => Promise<ExportPayload>;

type StoredExportJob = ExportJobView & { filePath?: string };

export interface ExportJobManagerOptions {
  build?: ExportBuilder;
  outputDir?: string;
  id?: () => string;
  now?: () => Date;
}

export type ExportDownload =
  | { ok: true; response: Response }
  | { ok: false; status: 404 | 409; body: Record<string, unknown> };

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function jobView(job: StoredExportJob): ExportJobView {
  const { filePath: _filePath, ...view } = job;
  return view;
}

function safeExtension(extension: string): string {
  return extension.replace(/[^a-z0-9.-]/gi, '') || 'txt';
}

function setJobStatus(job: StoredExportJob, status: ExportJobStatus, now: () => Date): void {
  job.status = status;
  job.updatedAt = now().toISOString();
}

export function createExportJobManager(options: ExportJobManagerOptions = {}) {
  const jobs = new Map<string, StoredExportJob>();
  const build = options.build ?? buildDataExportPayload;
  const outputDir = options.outputDir ?? path.join(ORACLE_DATA_DIR, 'exports');
  const newId = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());

  async function run(job: StoredExportJob, request: ExportRequest): Promise<void> {
    try {
      setJobStatus(job, 'running', now);
      job.progress = 5;
      const payload = await build(request, (value) => {
        job.progress = clampProgress(value);
        job.updatedAt = now().toISOString();
      });
      const jobOutputDir = job.tenantId ? tenantScopedOutputDir(outputDir) : outputDir;
      await mkdir(jobOutputDir, { recursive: true });
      const filename = `oracle-export-${job.id}.${safeExtension(payload.extension)}`;
      const filePath = path.join(jobOutputDir, filename);
      await writeFile(filePath, payload.data, 'utf8');
      job.filePath = filePath;
      job.filename = filename;
      job.contentType = payload.contentType;
      job.sizeBytes = new TextEncoder().encode(payload.data).byteLength;
      job.downloadUrl = `/api/v1/export/${job.id}/download`;
      job.progress = 100;
      setJobStatus(job, 'completed', now);
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.progress = 100;
      setJobStatus(job, 'failed', now);
    }
  }

  return {
    create(request: ExportRequest = {}): ExportJobView {
      const id = newId();
      const tenantId = currentExportTenantId();
      const format = resolveExportFormat(request.format);
      const source = resolveExportSource(format, request.source);
      const timestamp = now().toISOString();
      const job: StoredExportJob = {
        id,
        tenantId,
        status: 'queued',
        format,
        source,
        collection: request.collection,
        progress: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      jobs.set(id, job);
      queueMicrotask(() => void runWithTenant(tenantId, () => run(job, { ...request, format, source })));
      return jobView(job);
    },

    get(id: string): ExportJobView | null {
      const job = jobs.get(id);
      if (job && !canReadTenantResource(job.tenantId)) return null;
      return job ? jobView(job) : null;
    },

    async download(id: string): Promise<ExportDownload> {
      const job = jobs.get(id);
      if (!job) return { ok: false, status: 404, body: { error: 'Export job not found', id } };
      if (!canReadTenantResource(job.tenantId)) {
        return { ok: false, status: 404, body: { error: 'Export job not found', id } };
      }
      if (job.status !== 'completed' || !job.filePath) {
        return { ok: false, status: 409, body: { error: 'Export job is not ready', job: jobView(job) } };
      }
      return {
        ok: true,
        response: new Response(Bun.file(job.filePath), {
          headers: {
            'Content-Type': job.contentType ?? 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${job.filename}"`,
            'X-Export-Job-Id': job.id,
          },
        }),
      };
    },
  };
}

export type ExportJobManager = ReturnType<typeof createExportJobManager>;
export const defaultExportJobManager = createExportJobManager();
