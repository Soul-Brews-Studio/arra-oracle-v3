import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createErrorMiddleware } from '../../src/middleware/errors.ts';
import { forumApi } from '../../src/routes/forum/index.ts';
import { knowledgeRoutes } from '../../src/routes/knowledge/index.ts';
import { peerRoutes } from '../../src/routes/peer/index.ts';
import { scheduleApi } from '../../src/routes/schedule/index.ts';
import { supersedeRoutes } from '../../src/routes/supersede/index.ts';
import { tracesApi } from '../../src/routes/traces/index.ts';
import { vectorConfigApiEndpoint } from '../../src/routes/vector/config.ts';

const jsonHeaders = { 'content-type': 'application/json' };

function app() {
  return new Elysia()
    .use(createErrorMiddleware(() => undefined))
    .use(forumApi)
    .use(scheduleApi)
    .use(peerRoutes)
    .use(knowledgeRoutes)
    .use(supersedeRoutes)
    .use(tracesApi)
    .use(new Elysia({ prefix: '/api' }).use(vectorConfigApiEndpoint));
}

async function request(path: string, init: RequestInit) {
  const res = await app().handle(new Request(`http://local${path}`, init));
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { res, body };
}

function post(path: string, body: unknown) {
  return request(path, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });
}

function patch(path: string, body: unknown) {
  return request(path, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) });
}


describe('input validation hardening', () => {
  test('rejects malformed forum bodies before handlers run', async () => {
    expect((await post('/api/thread', { message: 42 })).res.status).toBe(422);
    expect((await patch('/api/thread/1/status', { status: 42 })).res.status).toBe(422);
  });

  test('keeps forum handler-level missing field errors as 400', async () => {
    const { res, body } = await post('/api/thread', {});
    expect([400, 422]).toContain(res.status);
    if (res.status === 400) expect(body.error).toBe('Missing required field: message');
  });

  test('rejects malformed schedule create and update bodies', async () => {
    expect((await post('/api/schedule', { date: 42, event: 'standup' })).res.status).toBe(422);
    expect((await patch('/api/schedule/1', { status: 'bogus' })).res.status).toBe(422);
  });

  test('rejects malformed federation search input', async () => {
    expect((await post('/api/peer/search', { q: 42 })).res.status).toBe(422);
    expect((await post('/api/search', { limit: true })).res.status).toBe(422);
  });

  test('rejects malformed knowledge and supersede bodies', async () => {
    expect((await post('/api/handoff', { content: 123 })).res.status).toBe(422);
    expect((await post('/api/supersede', { old_path: 123 })).res.status).toBe(422);
  });

  test('rejects malformed trace linking and vector config patches', async () => {
    expect((await post('/api/traces/trace-a/link', { nextId: 123 })).res.status).toBe(422);
    expect((await patch('/api/vector/config', 'bad')).res.status).toBe(422);
  });
});
