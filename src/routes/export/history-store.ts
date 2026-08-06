import { db, exportJobs } from '../../db/index.ts';
import { DEFAULT_TENANT_ID } from '../../middleware/tenant.ts';

export interface ExportHistoryRecord {
  id: string;
  tenantId?: string | null;
  collection: string;
  format: string;
  timestamp: number;
  status: string;
}

export function recordExportHistory(job: ExportHistoryRecord): void {
  db.insert(exportJobs).values({
    id: job.id,
    tenantId: job.tenantId ?? DEFAULT_TENANT_ID,
    collection: job.collection,
    format: job.format,
    timestamp: job.timestamp,
    status: job.status,
  }).run();
}
