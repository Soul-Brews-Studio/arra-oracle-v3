import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createExportRoutes } from '../../../src/routes/export/index.ts';
import { createExportJobManager } from '../../../src/routes/export/jobs.ts';

const tmp = mkdtempSync(join(tmpdir(), 'export-e2e-error-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Fetcher = (request: Request) => Promise<Response>;

async function postExport(fetcher: Fetcher, format = 'json'): Promise<Response> {
  return fetcher(new Request('http://local/api/v1/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format }),
  }));
}

async function job(fetcher: Fetcher, id: string): Promise<Record<string, any>> {
  const res = await fetcher(new Request(`http://local/api/v1/export/${id}`));
  return (await res.json() as { job: Record<string, any> }).job;
}

async function waitForStatus(fetcher: Fetcher, id: string, status: string): Promise<Record<string, any>> {
  for (let i = 0; i < 20; i += 1) {
    const current = await job(fetcher, id);
    if (current.status === status) return current;
    await Bun.sleep(5);
  }
  throw new Error(`export job ${id} never reached ${status}`);
}

async function progressEvent(fetcher: Fetcher, id: string): Promise<Record<string, unknown>> {
  const res = await fetcher(new Request(`http://local/api/v1/export/progress/${id}`));
  const body = await res.text();
  const match = /^data: (.+)$/m.exec(body);
  if (!match) throw new Error(`missing SSE data in ${body}`);
  return JSON.parse(match[1]!);
}

test('export app E2E surfaces failed jobs, blocks downloads, then recovers on retry', async () => {
  const ids = ['job-e2e-fail', 'job-e2e-retry'];
  let buildCount = 0;
  const manager = createExportJobManager({
    outputDir: tmp,
    id: () => ids.shift()!,
    build: async (_request, progress) => {
      buildCount += 1;
      progress(buildCount === 1 ? 55 : 70);
      if (buildCount === 1) throw new Error('legacy backend unavailable');
      return { data: '{"ok":true}', contentType: 'application/json; charset=utf-8', extension: 'json' };
    },
  });
  const fetcher = createApiVersionedFetch((request) => new Elysia().use(createExportRoutes(manager)).handle(request));

  const failedCreate = await postExport(fetcher);
  expect(failedCreate.status).toBe(202);
  expect((await failedCreate.json() as { job: { id: string } }).job.id).toBe('job-e2e-fail');

  const failed = await waitForStatus(fetcher, 'job-e2e-fail', 'failed');
  expect(failed).toMatchObject({ status: 'failed', progress: 100, error: 'legacy backend unavailable' });
  expect(await progressEvent(fetcher, 'job-e2e-fail')).toMatchObject({
    jobId: 'job-e2e-fail',
    status: 'error',
    progress: 100,
    error: 'legacy backend unavailable',
  });

  const blocked = await fetcher(new Request('http://local/api/v1/export/job-e2e-fail/download'));
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ error: 'Export job is not ready', job: { status: 'failed' } });

  const retriedCreate = await postExport(fetcher);
  expect(retriedCreate.status).toBe(202);
  expect((await retriedCreate.json() as { job: { id: string } }).job.id).toBe('job-e2e-retry');

  const retried = await waitForStatus(fetcher, 'job-e2e-retry', 'completed');
  expect(retried).toMatchObject({ status: 'completed', progress: 100, downloadUrl: '/api/v1/export/job-e2e-retry/download' });

  const download = await fetcher(new Request('http://local/api/v1/export/job-e2e-retry/download'));
  expect(download.status).toBe(200);
  expect(download.headers.get('x-export-job-id')).toBe('job-e2e-retry');
  expect(await download.json()).toEqual({ ok: true });
});
