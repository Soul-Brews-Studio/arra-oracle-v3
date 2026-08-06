import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Elysia } from 'elysia';
import { handoffEndpoint } from '../../../src/routes/knowledge/handoff.ts';
import { inboxEndpoint } from '../../../src/routes/knowledge/inbox.ts';

const previousRoot = process.env.ORACLE_REPO_ROOT;
let tempRoot = '';

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'arra-inbox-http-'));
  process.env.ORACLE_REPO_ROOT = tempRoot;
});

afterEach(() => {
  if (previousRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = previousRoot;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

function app() {
  return new Elysia({ prefix: '/api' })
    .use(handoffEndpoint)
    .use(inboxEndpoint);
}

function jsonPost(body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function handoffDir() {
  return path.join(tempRoot, 'ψ', 'inbox', 'handoff');
}

describe('inbox and handoff route edge cases', () => {
  test('GET /api/inbox returns an empty inbox when no handoff directory exists', async () => {
    const res = await app().handle(new Request('http://local/api/inbox?type=all'));
    const body = await res.json() as { files: unknown[]; total: number; limit: number; offset: number };

    expect(res.status).toBe(200);
    expect(body).toEqual({ files: [], total: 0, limit: 10, offset: 0 });
  });

  test('GET /api/inbox lists pending handoffs newest-first with safe relative paths', async () => {
    mkdirSync(handoffDir(), { recursive: true });
    writeFileSync(path.join(handoffDir(), '2026-06-17_03-01_newest.md'), 'n'.repeat(550));
    writeFileSync(path.join(handoffDir(), '2026-06-17_02-00_middle.md'), 'middle handoff');
    writeFileSync(path.join(handoffDir(), '2026-06-16_23-59_oldest.md'), 'old handoff');
    writeFileSync(path.join(handoffDir(), 'ignore.txt'), 'not pending');

    const res = await app().handle(new Request('http://local/api/inbox?type=handoff&limit=2'));
    const body = await res.json() as {
      files: Array<{ filename: string; path: string; created: string; preview: string; type: string }>;
      total: number;
      limit: number;
    };

    expect(res.status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.files.map((file) => file.filename)).toEqual([
      '2026-06-17_03-01_newest.md',
      '2026-06-17_02-00_middle.md',
    ]);
    expect(body.files[0]).toMatchObject({
      path: 'ψ/inbox/handoff/2026-06-17_03-01_newest.md',
      created: '2026-06-17T03:01:00',
      type: 'handoff',
    });
    expect(body.files[0].preview).toHaveLength(500);
  });

  test('POST /api/handoff writes a pending handoff visible to the inbox', async () => {
    const res = await app().handle(new Request('http://local/api/handoff', jsonPost({
      content: 'handoff body for next oracle session',
      slug: '../../Pending Handoff!',
    })));
    const body = await res.json() as { success: boolean; file: string };

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.file).toStartWith('ψ/inbox/handoff/');
    expect(body.file).not.toContain('..');
    expect(existsSync(path.join(tempRoot, body.file))).toBe(true);

    const inbox = await app().handle(new Request('http://local/api/inbox?type=handoff'));
    const inboxBody = await inbox.json() as { files: Array<{ filename: string }> };
    expect(inboxBody.files.some((file) => file.filename.includes('pending-handoff'))).toBe(true);
  });

  test('POST /api/handoff rejects malformed payloads without creating handoffs', async () => {
    const route = app();
    const malformedJson = await route.handle(new Request('http://local/api/handoff', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }));
    const wrongType = await route.handle(new Request('http://local/api/handoff', jsonPost({ content: 42 })));
    const missingContent = await route.handle(new Request('http://local/api/handoff', jsonPost({ slug: 'missing' })));
    const blankContent = await route.handle(new Request('http://local/api/handoff', jsonPost({ content: '   ' })));

    expect(malformedJson.status).toBe(400);
    expect(wrongType.status).toBe(422);
    expect(missingContent.status).toBe(400);
    expect(blankContent.status).toBe(400);
    expect(existsSync(handoffDir()) ? readdirSync(handoffDir()) : []).toEqual([]);
  });
});
