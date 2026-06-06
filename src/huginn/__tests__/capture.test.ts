import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { captureSession, huginnEnabled, mineSessionJsonl, readHookInput } from '../capture.ts';

const tmpDirs: string[] = [];
function tmpdir(prefix = 'huginn-capture-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
function writeJsonl(file: string, rows: unknown[]) {
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('Huginn session capture', () => {
  it('is opt-in and default-off', () => {
    expect(huginnEnabled({} as any)).toBe(false);
    expect(huginnEnabled({ ARRA_HUGINN_CAPTURE: '1' } as any)).toBe(true);
    expect(huginnEnabled({ ORACLE_HUGINN_CAPTURE: 'true' } as any)).toBe(true);
  });

  it('reads transcript path from hook stdin aliases', () => {
    const parsed = readHookInput(JSON.stringify({ transcript_path: '/tmp/session.jsonl', session_id: 's1', cwd: '/repo' }), {} as any);
    expect(parsed).toEqual({ transcriptPath: '/tmp/session.jsonl', sessionId: 's1', cwd: '/repo' });
  });

  it('mines salient decisions, learnings, issues, commands, and file changes from JSONL', () => {
    const dir = tmpdir();
    const transcript = path.join(dir, 'session.jsonl');
    writeJsonl(transcript, [
      { message: { role: 'user', content: 'hello there' } },
      { message: { role: 'assistant', content: 'Decision: keep /api/feed local and add peer feed at /api/peer/feed.' } },
      { message: { role: 'assistant', content: [{ type: 'text', text: 'Fixed regression in src/gateway/config.ts; bun test is green.' }] } },
      { message: { role: 'assistant', content: 'PR #1356 merged and issue #44 closed.' } },
    ]);

    const mined = mineSessionJsonl(transcript);
    expect(mined.moments.length).toBe(3);
    expect(mined.moments.map((m) => m.kind)).toContain('decision');
    expect(mined.moments.map((m) => m.kind)).toContain('command');
    expect(mined.sourceText).toContain('/api/peer/feed');
    expect(mined.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('learns once per session+content hash and skips duplicate reruns', async () => {
    const dir = tmpdir();
    const transcript = path.join(dir, 'session-abc.jsonl');
    const statePath = path.join(dir, 'state.json');
    writeJsonl(transcript, [
      { message: { role: 'assistant', content: 'Learned: raw bun test shares module state, so reset test DB handles after env changes.' } },
      { message: { role: 'assistant', content: 'Changed src/db/index.ts and verified bun test 755 pass 0 fail.' } },
    ]);

    const learned: any[] = [];
    const learn = (pattern: string, source?: string, concepts?: string[]) => {
      learned.push({ pattern, source, concepts });
      return { id: 'learning_huginn', file: 'ψ/memory/learnings/huginn.md' };
    };

    const first = await captureSession({ transcriptPath: transcript, sessionId: 'abc', statePath, learn });
    expect(first.learned).toBe(true);
    expect(first.learningId).toBe('learning_huginn');
    expect(learned).toHaveLength(1);
    expect(learned[0].pattern).toContain('Huginn auto-capture session abc');
    expect(learned[0].concepts).toContain('huginn');

    const second = await captureSession({ transcriptPath: transcript, sessionId: 'abc', statePath, learn });
    expect(second.skipped).toBe('duplicate');
    expect(learned).toHaveLength(1);
  });

  it('does not learn empty/non-salient transcripts', async () => {
    const dir = tmpdir();
    const transcript = path.join(dir, 'quiet.jsonl');
    writeJsonl(transcript, [{ message: { role: 'assistant', content: 'ok' } }]);
    const result = await captureSession({ transcriptPath: transcript, learn: () => { throw new Error('should not learn'); } });
    expect(result.skipped).toBe('empty');
  });
});
