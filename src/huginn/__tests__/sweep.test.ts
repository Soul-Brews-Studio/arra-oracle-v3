import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sweepHuginn } from '../sweep.ts';

const tmpDirs: string[] = [];
function tmpdir(prefix = 'huginn-sweep-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
function writeJsonl(file: string, rows: unknown[], mtimeMs?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  if (mtimeMs) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Huginn periodic sweep', () => {
  it('back-fills hook-missed session JSONL once through capture dedup', async () => {
    const dir = tmpdir();
    const sessions = path.join(dir, 'sessions');
    const transcript = path.join(sessions, 'missed.jsonl');
    const statePath = path.join(dir, 'state.json');
    writeJsonl(transcript, [
      { message: { role: 'assistant', content: 'Decision: periodic Huginn sweep backfills sessions where Stop hook was disabled.' } },
      { message: { role: 'assistant', content: 'Changed src/huginn/sweep.ts and verified bun run test:huginn is green.' } },
    ], 2_000);

    const learned: any[] = [];
    const learn = (pattern: string, source?: string) => {
      learned.push({ pattern, source });
      return { id: `learn_${learned.length}`, file: 'ψ/memory/learnings/huginn.md' };
    };

    const first = await sweepHuginn({ sessionDirs: [sessions], statePath, lookbackHours: 1, now: 3_000, learn, indexMarkdown: () => {} });
    expect(first.scanned).toBe(1);
    expect(first.learned).toBe(1);
    expect(first.duplicates).toBe(0);
    expect(learned).toHaveLength(1);

    const second = await sweepHuginn({ sessionDirs: [sessions], statePath, lookbackHours: 1, now: 4_000, learn, indexMarkdown: () => {} });
    expect(second.scanned).toBe(0);
    expect(second.learned).toBe(0);
    expect(learned).toHaveLength(1);

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(state.sweeps.lastSweepAtMs).toBe(4_000);
    expect(Object.keys(state.captures)).toHaveLength(1);
  });

  it('recovers when persisted sweep state has malformed records', async () => {
    const dir = tmpdir();
    const sessions = path.join(dir, 'sessions');
    const transcript = path.join(sessions, 'malformed-state.jsonl');
    const statePath = path.join(dir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify({ captures: [], sweeps: [] }));
    writeJsonl(transcript, [
      { message: { role: 'assistant', content: 'Decision: Huginn sweep should tolerate malformed persisted state records.' } },
    ], 2_000);

    const result = await sweepHuginn({
      sessionDirs: [sessions],
      statePath,
      now: 3_000,
      learn: () => ({ id: 'learn_malformed_state' }),
      indexMarkdown: () => {},
    });

    expect(result.learned).toBe(1);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    expect(Array.isArray(state.captures)).toBe(false);
    expect(Array.isArray(state.sweeps)).toBe(false);
    expect(state.sweeps.lastSweepAtMs).toBe(3_000);
  });

  it('uses #49 dedup state when the fast-path hook already captured the transcript', async () => {
    const dir = tmpdir();
    const sessions = path.join(dir, 'sessions');
    const transcript = path.join(sessions, 'already.jsonl');
    const statePath = path.join(dir, 'state.json');
    writeJsonl(transcript, [
      { message: { role: 'assistant', content: 'Learned: fast-path capture and periodic sweep share one dedup state.' } },
    ], 2_000);

    const learned: any[] = [];
    const learn = () => {
      learned.push(1);
      return { id: `learn_${learned.length}` };
    };

    const first = await sweepHuginn({ sessionDirs: [sessions], statePath, now: 3_000, learn, indexMarkdown: () => {} });
    expect(first.learned).toBe(1);
    const second = await sweepHuginn({ sessionDirs: [sessions], statePath, now: 3_500, lookbackHours: 1, learn, indexMarkdown: () => {} });
    expect(second.duplicates + second.scanned).toBe(0); // watermark skips old file before dedup even runs

    fs.utimesSync(transcript, new Date(4_000), new Date(4_000));
    const third = await sweepHuginn({ sessionDirs: [sessions], statePath, now: 5_000, learn, indexMarkdown: () => {} });
    expect(third.scanned).toBe(1);
    expect(third.duplicates).toBe(1);
    expect(learned).toHaveLength(1);
  });

  it('indexes recent vault learning markdown once and advances watermark', async () => {
    const dir = tmpdir();
    const repoRoot = path.join(dir, 'repo');
    const learning = path.join(repoRoot, 'ψ', 'memory', 'learnings', 'external.md');
    const statePath = path.join(dir, 'state.json');
    fs.mkdirSync(path.dirname(learning), { recursive: true });
    fs.writeFileSync(learning, '---\ntitle: External write\ntags: [huginn]\n---\n\nLearned: external processes can write markdown while hooks are off.\n');
    fs.utimesSync(learning, new Date(2_000), new Date(2_000));

    const indexed: string[] = [];
    const first = await sweepHuginn({ sessionDirs: [], repoRoot, statePath, now: 3_000, indexMarkdown: (_file, sourceFile) => indexed.push(sourceFile) });
    expect(first.markdownIndexed).toBe(1);
    expect(indexed).toEqual(['ψ/memory/learnings/external.md']);

    const second = await sweepHuginn({ sessionDirs: [], repoRoot, statePath, now: 4_000, indexMarkdown: (_file, sourceFile) => indexed.push(sourceFile) });
    expect(second.markdownIndexed).toBe(0);
    expect(indexed).toHaveLength(1);
  });
});
