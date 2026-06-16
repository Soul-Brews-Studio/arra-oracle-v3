import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createExportRoutes } from '../../../src/routes/export/index.ts';
import { createExportJobManager } from '../../../src/routes/export/jobs.ts';

const tmp = mkdtempSync(join(tmpdir(), 'export-routes-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function readJson(response: Response) {
  return await response.json() as Record<string, any>;
}

async function waitForCompleted(fetcher: (request: Request) => Promise<Response>, id: string) {
  for (let i = 0; i < 20; i++) {
    const res = await fetcher(new Request(`http://local/api/v1/export/${id}`));
    const body = await readJson(res);
    if (body.job.status === 'completed') return body.job;
    await Bun.sleep(5);
  }
  throw new Error('export job did not complete');
}

test('POST/GET/download /api/v1/export manages an async export artifact', async () => {
  const gate = deferred();
  const started = deferred();
  const manager = createExportJobManager({
    outputDir: tmp,
    id: () => 'job-http-1',
    build: async (request, progress) => {
      expect(request).toMatchObject({ format: 'json', source: 'vault' });
      progress(40);
      started.resolve();
      await gate.promise;
      return {
        data: JSON.stringify({ ok: true, format: request.format }),
        contentType: 'application/json; charset=utf-8',
        extension: 'json',
      };
    },
  });
  const app = new Elysia().use(createExportRoutes(manager));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const created = await fetcher(new Request('http://local/api/v1/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'json' }),
  }));
  const createdBody = await readJson(created);

  expect(created.status).toBe(202);
  expect(createdBody.job.id).toBe('job-http-1');
  expect(createdBody.job.downloadUrl).toBeUndefined();

  await started.promise;
  const running = await readJson(await fetcher(new Request('http://local/api/v1/export/job-http-1')));
  expect(running.job.status).toBe('running');
  expect(running.job.progress).toBe(40);

  gate.resolve();
  const completed = await waitForCompleted(fetcher, 'job-http-1');
  expect(completed.downloadUrl).toBe('/api/v1/export/job-http-1/download');
  expect(completed.sizeBytes).toBeGreaterThan(0);

  const download = await fetcher(new Request('http://local/api/v1/export/job-http-1/download'));
  expect(download.status).toBe(200);
  expect(download.headers.get('content-type')).toContain('application/json');
  expect(download.headers.get('x-export-job-id')).toBe('job-http-1');
  expect(await download.json()).toEqual({ ok: true, format: 'json' });
});

test('GET /api/v1/export/progress streams export job progress as SSE', async () => {
  const gate = deferred();
  const started = deferred();
  const manager = createExportJobManager({
    outputDir: tmp,
    id: () => 'job-progress-1',
    build: async (_request, progress) => {
      progress(40);
      started.resolve();
      await gate.promise;
      return { data: '{"ok":true}', contentType: 'application/json', extension: 'json' };
    },
  });
  const app = new Elysia().use(createExportRoutes(manager));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  await fetcher(new Request('http://local/api/v1/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'json' }),
  }));
  await started.promise;

  const stream = await fetcher(new Request('http://local/api/v1/export/progress?jobId=job-progress-1', {
    headers: { accept: 'text/event-stream' },
  }));
  gate.resolve();
  const text = await stream.text();

  expect(stream.status).toBe(200);
  expect(stream.headers.get('content-type')).toContain('text/event-stream');
  expect(text).toContain('event: progress');
  expect(text).toContain('"jobId":"job-progress-1"');
  expect(text).toContain('"progress":40');
  expect(text).toContain('"status":"done"');
});

test('GET /api/v1/export/:id returns 404 for unknown jobs', async () => {
  const manager = createExportJobManager({ outputDir: tmp });
  const app = new Elysia().use(createExportRoutes(manager));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  const status = await fetcher(new Request('http://local/api/v1/export/missing'));
  expect(status.status).toBe(404);
  expect(await status.json()).toEqual({ error: 'Export job not found', id: 'missing' });
});
