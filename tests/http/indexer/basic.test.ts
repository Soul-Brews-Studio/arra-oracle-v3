import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { indexerRoutes } from '../../../src/routes/indexer/index.ts';

function request(path: string, init: RequestInit = {}) {
  return indexerRoutes.handle(new Request(`http://local${path}`, init));
}

function post(path: string, body: unknown) {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('indexer HTTP routes', () => {
  test('GET /api/indexer/config returns adapters and model metadata', async () => {
    const res = await request('/api/indexer/config');
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.adapters)).toBe(true);
    expect(body.adapters).toContain('lancedb');
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
  });

  test('POST /api/indexer/scan reports markdown files by type', async () => {
    const root = join(tmpdir(), `indexer-scan-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const learnDir = join(root, 'memory', 'learnings');
    mkdirSync(learnDir, { recursive: true });
    writeFileSync(join(learnDir, 'lesson.md'), '# Lesson\n\nBody');
    writeFileSync(join(learnDir, 'skip.txt'), 'not markdown');

    try {
      const res = await post('/api/indexer/scan', { sourcePath: root, types: ['learning'] });
      const body = await res.json() as Record<string, any>;

      expect(res.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.byType.learning).toBe(1);
      expect(body.files[0].relativePath).toContain('lesson.md');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('POST /api/indexer/scan returns empty payload for missing path', async () => {
    const missing = join(tmpdir(), `missing-indexer-${Date.now()}`);
    const res = await post('/api/indexer/scan', { sourcePath: missing });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.error).toContain('Path not found');
    expect(body.total).toBe(0);
    expect(body.files).toEqual([]);
  });

  test('POST /api/indexer/stop toggles the stop contract', async () => {
    const res = await post('/api/indexer/stop', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stopped: true });
  });
});
