import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl } from '../api/oracle';

export type ExportStatus = 'idle' | 'starting' | 'running' | 'done' | 'error';
export type ExportRunPayload = Record<string, unknown>;
type ExportFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

export interface ExportProgressState {
  status: ExportStatus;
  jobId: string | null;
  progress: number;
  fileSizeEstimate?: number;
  downloadUrl?: string;
  filename?: string;
  error?: string;
}

export interface UseExportOptions {
  fetcher?: ExportFetch;
  pollMs?: number;
}

export interface UseExportResult extends ExportProgressState {
  start: (payload?: ExportRunPayload) => Promise<void>;
  retry: () => Promise<void>;
  reset: () => void;
}

const initialState: ExportProgressState = {
  status: 'idle',
  jobId: null,
  progress: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const next = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(next)) return next;
  }
}

function textValue(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
}

async function jsonOrEmpty(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.clone().json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function progressFrom(payload: Record<string, unknown>): number | undefined {
  const direct = numberValue(payload.progress, payload.percent, payload.progressPercent);
  if (direct !== undefined) return direct <= 1 ? direct * 100 : direct;
  const current = numberValue(payload.current, payload.completed, payload.bytesWritten);
  const total = numberValue(payload.total, payload.totalBytes, payload.sizeBytes);
  return current !== undefined && total ? (current / total) * 100 : undefined;
}

function estimateFrom(payload: Record<string, unknown>): number | undefined {
  return numberValue(payload.fileSizeEstimate, payload.estimatedBytes, payload.estimateBytes, payload.sizeBytes, payload.bytes);
}

function filenameFrom(response: Response, payload: Record<string, unknown>): string {
  const fromPayload = textValue(payload.filename, payload.fileName, payload.name);
  if (fromPayload) return fromPayload;
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match?.[1] ? decodeURIComponent(match[1]) : 'arra-oracle-export.zip';
}

function statusFrom(payload: Record<string, unknown>): ExportStatus | undefined {
  const status = textValue(payload.status, payload.state)?.toLowerCase();
  if (status === 'done' || status === 'ready' || status === 'complete' || status === 'completed') return 'done';
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'running' || status === 'pending' || status === 'queued' || status === 'starting') return 'running';
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useExport({ fetcher = globalThis.fetch?.bind(globalThis), pollMs = 1500 }: UseExportOptions = {}): UseExportResult {
  const [state, setState] = useState<ExportProgressState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<ExportRunPayload | undefined>();

  const revokeDownload = useCallback(() => {
    if (urlRef.current && globalThis.URL?.revokeObjectURL) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const pollDownload = useCallback(async (jobId: string, signal: AbortSignal) => {
    if (!fetcher) throw new Error('fetch is unavailable');
    const path = `/api/v1/export/app/download/${encodeURIComponent(jobId)}`;
    while (!signal.aborted) {
      const response = await fetcher(apiUrl(path), { headers: { accept: 'application/json, application/octet-stream' }, signal });
      const payload = await jsonOrEmpty(response);
      const jobStatus = statusFrom(payload);
      const progress = Math.min(100, Math.max(0, progressFrom(payload) ?? 0));
      const fileSizeEstimate = estimateFrom(payload);
      if (jobStatus === 'error') throw new Error(textValue(payload.error, payload.message) ?? 'Export job failed');
      if (response.status === 202 || response.status === 204 || jobStatus === 'running') {
        setState((current) => ({ ...current, status: 'running', progress, fileSizeEstimate: fileSizeEstimate ?? current.fileSizeEstimate }));
        await wait(pollMs, signal);
        continue;
      }
      if (!response.ok) throw new Error(`${path} returned ${response.status}`);
      const downloadUrl = textValue(payload.downloadUrl, payload.url, payload.href);
      if (downloadUrl) {
        setState((current) => ({ ...current, status: 'done', progress: 100, fileSizeEstimate: fileSizeEstimate ?? current.fileSizeEstimate, downloadUrl, filename: filenameFrom(response, payload) }));
        return;
      }
      const blob = await response.blob();
      revokeDownload();
      const url = globalThis.URL?.createObjectURL ? URL.createObjectURL(blob) : undefined;
      urlRef.current = url ?? null;
      setState((current) => ({ ...current, status: 'done', progress: 100, fileSizeEstimate: blob.size || fileSizeEstimate || current.fileSizeEstimate, downloadUrl: url, filename: filenameFrom(response, payload) }));
      return;
    }
  }, [fetcher, pollMs, revokeDownload]);

  const start = useCallback(async (payload: ExportRunPayload = {}) => {
    if (!fetcher) throw new Error('fetch is unavailable');
    abortRef.current?.abort();
    revokeDownload();
    const controller = new AbortController();
    abortRef.current = controller;
    lastPayloadRef.current = payload;
    setState({ status: 'starting', jobId: null, progress: 0 });
    try {
      const response = await fetcher(apiUrl('/api/v1/export/app/run'), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await jsonOrEmpty(response);
      if (!response.ok) throw new Error(`/api/v1/export/app/run returned ${response.status}`);
      const jobId = textValue(body.jobId, body.id);
      if (!jobId) throw new Error('/api/v1/export/app/run did not return a jobId');
      setState({
        status: 'running',
        jobId,
        progress: Math.min(100, Math.max(0, progressFrom(body) ?? 0)),
        fileSizeEstimate: estimateFrom(body),
      });
      await pollDownload(jobId, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return;
      setState((current) => ({ ...current, status: 'error', error: errorMessage(error) }));
    }
  }, [fetcher, pollDownload, revokeDownload]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    revokeDownload();
    setState(initialState);
  }, [revokeDownload]);

  useEffect(() => () => {
    abortRef.current?.abort();
    revokeDownload();
  }, [revokeDownload]);

  return {
    ...state,
    start,
    retry: () => start(lastPayloadRef.current),
    reset,
  };
}
