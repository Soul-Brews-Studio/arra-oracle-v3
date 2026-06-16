import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createExportRoutes } from '../../../src/routes/export/index.ts';
import { createExportJobManager } from '../../../src/routes/export/jobs.ts';

const tmp = mkdtempSync(join(tmpdir(), 'export-progress-'));

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function makeFetcher(manager: ReturnType<typeof createExportJobManager>) {
  const app = new Elysia().use(createExportRoutes(manager));
  return createApiVersionedFetch((request) => app.handle(request));
}

class SseReader {
  private buffer = '';
  private decoder = new TextDecoder();

  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async next(): Promise<{ raw: string; data: Record<string, unknown> }> {
    while (!this.buffer.includes('\n\n')) {
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error('SSE stream ended before next event');
      this.buffer += this.decoder.decode(chunk.value, { stream: true });
    }
    const boundary = this.buffer.indexOf('\n\n');
    const raw = this.buffer.slice(0, boundary);
    this.buffer = this.buffer.slice(boundary + 2);
    const data = raw.split('\n').find((line) => line.startsWith('data: '));
    if (!data) throw new Error(`SSE event missing data: ${raw}`);
    return { raw, data: JSON.parse(data.slice(6)) };
  }
}

async function startJob(fetcher: (request: Request) => Promise<Response>, format = 'json') {
  return fetcher(new Request('http://local/api/v1/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format }),
  }));
}

async function waitForStatus(
  manager: ReturnType<typeof createExportJobManager>,
  id: string,
  status: string,
) {
  for (let i = 0; i < 20; i++) {
    const job = manager.get(id);
    if (job?.status === status) return job;
    await Bun.sleep(10);
  }
  throw new Error(`export job ${id} never reached ${status}`);
}

async function nextWithStatus(reader: SseReader, status: string) {
  for (let i = 0; i < 10; i++) {
    const event = await reader.next();
    if (event.data.status === status) return event;
  }
  throw new Error(`SSE stream did not emit ${status}`);
}

test('GET /api/v1/export/progress/:jobId streams running then done', async () => {
  const gate = deferred();
  const started = deferred();
  const manager = createExportJobManager({
    outputDir: tmp,
    id: () => 'job-progress-ok',
    build: async (_request, progress) => {
      progress(45);
      started.resolve();
      await gate.promise;
      return { data: '{"ok":true}', contentType: 'application/json', extension: 'json' };
    },
  });
  const fetcher = makeFetcher(manager);

  expect((await startJob(fetcher)).status).toBe(202);
  await started.promise;

  const res = await fetcher(new Request('http://local/api/v1/export/progress/job-progress-ok'));
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  expect(res.headers.get('cache-control')).toContain('no-cache');

  const events = new SseReader(res.body!.getReader());
  const first = await events.next();
  expect(first.raw).toContain('event: progress');
  expect(first.data).toMatchObject({
    jobId: 'job-progress-ok',
    status: 'running',
    progress: 45,
  });

  gate.resolve();
  const final = await nextWithStatus(events, 'done');
  expect(final.data).toMatchObject({
    jobId: 'job-progress-ok',
    status: 'done',
    progress: 100,
  });
});

test('GET /api/v1/export/progress/:jobId maps failed jobs to error events', async () => {
  const manager = createExportJobManager({
    outputDir: tmp,
    id: () => 'job-progress-failed',
    build: async (_request, progress) => {
      progress(60);
      throw new Error('export exploded');
    },
  });
  const fetcher = makeFetcher(manager);

  expect((await startJob(fetcher)).status).toBe(202);
  await waitForStatus(manager, 'job-progress-failed', 'failed');

  const res = await fetcher(new Request('http://local/api/v1/export/progress/job-progress-failed'));
  const body = await res.text();
  const event = [...body.matchAll(/^data: (.+)$/gm)].map((match) => JSON.parse(match[1]))[0];

  expect(res.status).toBe(200);
  expect(body).toContain('event: progress');
  expect(event).toMatchObject({
    jobId: 'job-progress-failed',
    status: 'error',
    progress: 100,
    error: 'export exploded',
  });
});

test('GET /api/v1/export/progress/:jobId returns 404 for unknown jobs', async () => {
  const fetcher = makeFetcher(createExportJobManager({ outputDir: tmp }));
  const res = await fetcher(new Request('http://local/api/v1/export/progress/missing'));

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Export job not found', id: 'missing' });
});
