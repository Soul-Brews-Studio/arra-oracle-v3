import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanEndpoint } from '../scan.ts';

function post(app: Elysia, body: unknown) {
  return app.handle(new Request('http://localhost/indexer/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('POST /indexer/scan', () => {
  test('detects an explicit ψ folder and recommends FTS reindex', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-scan-psi-'));
    try {
      const psiRoot = path.join(tmp, 'ψ');
      fs.mkdirSync(path.join(psiRoot, 'memory', 'learnings'), { recursive: true });
      fs.writeFileSync(path.join(psiRoot, 'memory', 'learnings', 'scan.md'), '# scan psi folder\n');
      const app = new Elysia().use(scanEndpoint);

      const res = await post(app, { sourcePath: psiRoot });
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.psiDetected).toBe(true);
      expect(body.repoRoot).toBe(tmp);
      expect(body.psiPath).toBe(psiRoot);
      expect(body.canIndexFts).toBe(true);
      expect(body.recommendedAction).toBe('POST /api/indexer/reindex');
      expect(body.total).toBe(1);
      expect(body.byType.learning).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
