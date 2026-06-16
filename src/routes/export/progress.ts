import type { ExportJobView } from './model.ts';

export type ExportProgressSnapshot = {
  id: string;
  jobId: string;
  status: string;
  progress: number;
  updatedAt?: string;
  downloadUrl?: string;
  filename?: string;
  fileSizeEstimate?: number;
  sizeBytes?: number;
  error?: string;
};

const remembered = new Map<string, ExportProgressSnapshot>();
const terminalStatuses = new Set(['completed', 'done', 'failed', 'error']);

function publicStatus(status: string): string {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'error';
  return status;
}

function clampProgress(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function rememberExportProgress(snapshot: ExportProgressSnapshot): void {
  const normalized = {
    ...snapshot,
    status: publicStatus(snapshot.status),
    progress: clampProgress(snapshot.progress),
  };
  remembered.set(snapshot.id, normalized);
  remembered.set(snapshot.jobId, normalized);
}

export function readRememberedExportProgress(id: string): ExportProgressSnapshot | null {
  return remembered.get(id) ?? null;
}

export function snapshotFromJob(job: ExportJobView): ExportProgressSnapshot {
  return {
    id: job.id,
    jobId: job.id,
    status: publicStatus(job.status),
    progress: clampProgress(job.progress),
    updatedAt: job.updatedAt,
    downloadUrl: job.downloadUrl,
    filename: job.filename,
    fileSizeEstimate: job.sizeBytes,
    sizeBytes: job.sizeBytes,
    error: job.error,
  };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function isTerminal(snapshot: ExportProgressSnapshot): boolean {
  return terminalStatuses.has(snapshot.status.toLowerCase());
}

export function createExportProgressResponse(
  id: string,
  lookup: () => ExportJobView | ExportProgressSnapshot | null,
  { intervalMs = 350, maxTicks = 900 } = {},
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastPayload = '';
      for (let tick = 0; tick < maxTicks && !cancelled; tick += 1) {
        const current = lookup();
        const snapshot = current && 'jobId' in current ? current : current ? snapshotFromJob(current) : null;
        if (!snapshot) break;
        const payload = JSON.stringify(snapshot);
        if (payload !== lastPayload || tick === 0) {
          try {
            controller.enqueue(encoder.encode(sseEvent('progress', snapshot)));
          } catch {
            cancelled = true;
            break;
          }
          lastPayload = payload;
        }
        if (isTerminal(snapshot)) break;
        await Bun.sleep(intervalMs);
      }
      if (!cancelled) {
        try { controller.close(); } catch {}
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
