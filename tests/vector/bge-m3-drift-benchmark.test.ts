import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decideCompatibility, loadBenchmarkDocs, runBgeM3DriftBenchmark, type DriftDoc } from '../../src/vector/drift-benchmark.ts';
import type { EmbeddingProvider, EmbedType } from '../../src/vector/types.ts';

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('bge-m3 drift benchmark harness', () => {
  test('samples a mixed real corpus from SQLite before filesystem fallback', () => {
    const dir = temp();
    const dbPath = path.join(dir, 'oracle.db');
    const db = new Database(dbPath);
    db.exec('CREATE TABLE oracle_documents (id TEXT, source_file TEXT, superseded_by TEXT, indexed_at INTEGER); CREATE TABLE oracle_fts (id TEXT, content TEXT)');
    for (let i = 0; i < 6; i++) insertDoc(db, `en-${i}`, `English deployment memory ${i} has enough text for benchmark sampling.`);
    for (let i = 0; i < 4; i++) insertDoc(db, `th-${i}`, `บันทึกภาษาไทย ${i} สำหรับทดสอบ benchmark ของ bge m3 และ cosine drift`);
    db.close();
    const docs = loadBenchmarkDocs({ dbPath }, 6);
    expect(docs).toHaveLength(6);
    expect(docs.some((doc) => doc.language === 'thai')).toBe(true);
    expect(docs.some((doc) => doc.language === 'other')).toBe(true);
  });

  test('runs local side and writes a pending report when Cloudflare secrets are absent', async () => {
    const dir = temp();
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'a.md'), '# A\n\nAlpha memory benchmark content for local embeddings.');
    fs.writeFileSync(path.join(dir, 'docs', 'b.md'), '# B\n\nบันทึกภาษาไทยสำหรับ benchmark และ local embeddings');
    const local = new FakeEmbedder('ollama', 4);
    const result = await runBgeM3DriftBenchmark({ repoRoot: dir, sampleSize: 2, reportDir: path.join(dir, 'ψ/memory/learnings') }, { local });
    expect(result.status).toBe('local-only');
    expect(local.calls.map((call) => call.type)).toEqual(['passage', 'query']);
    const report = fs.readFileSync(result.reportPath, 'utf8');
    expect(report).toContain('Decision rule:');
    expect(report).toContain('Run command: `bun run bench:bge-m3-drift`');
    expect(report).toContain('Configuration is env-only:');
    expect(report).toContain('Cloudflare side skipped');
  });

  test('computes drift decision and ranking overlap for measured providers', async () => {
    const dir = temp();
    writeDocs(dir);
    const local = new FakeEmbedder('ollama', 4);
    const closeCf = new FakeEmbedder('cloudflare-ai', 4, 0.001);
    const close = await runBgeM3DriftBenchmark({ repoRoot: dir, sampleSize: 3, queryCount: 2, topK: 2, reportDir: dir }, { local, cloudflare: closeCf });
    expect(close.metrics?.verdict).toBe('warn-mode-ok');
    expect(close.metrics?.avgTopKOverlap).toBeGreaterThan(0);
    const farCf = new RotatedEmbedder();
    const far = await runBgeM3DriftBenchmark({ repoRoot: dir, sampleSize: 3, queryCount: 2, topK: 2, reportDir: dir }, { local, cloudflare: farCf });
    expect(far.metrics?.verdict).toBe('separate-collection');
    expect(decideCompatibility(0.049, 0.05)).toBe('separate-collection');
  });
});

class FakeEmbedder implements EmbeddingProvider {
  calls: Array<{ count: number; type?: EmbedType }> = [];
  constructor(readonly name: string, readonly dimensions: number, private skew = 0) {}
  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.calls.push({ count: texts.length, type });
    return texts.map((text) => vectorFor(text, this.dimensions, this.skew));
  }
}

class RotatedEmbedder extends FakeEmbedder {
  constructor() { super('cloudflare-ai', 4); }
  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.calls.push({ count: texts.length, type });
    return texts.map((text) => {
      const v = vectorFor(text, 4, 0);
      return [-v[1], v[0], -v[3], v[2]];
    });
  }
}

function vectorFor(text: string, dims: number, skew: number): number[] {
  const out = Array.from({ length: dims }, (_, i) => ((text.charCodeAt(i % text.length) % 17) + 1) / 20 + skew);
  return out;
}
function writeDocs(dir: string) {
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  ['alpha deployment runbook', 'beta memory search notes', 'gamma cloudflare vector test'].forEach((text, i) => fs.writeFileSync(path.join(dir, 'docs', `${i}.md`), `# ${i}\n\n${text} with enough benchmark text.`));
}
function insertDoc(db: Database, id: string, content: string) {
  db.prepare('INSERT INTO oracle_documents VALUES (?, ?, NULL, ?)').run(id, `ψ/memory/learnings/${id}.md`, Date.now());
  db.prepare('INSERT INTO oracle_fts VALUES (?, ?)').run(id, content);
}
function temp(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bge-drift-')); scratch.push(dir); return dir; }
