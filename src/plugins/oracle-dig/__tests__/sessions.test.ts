import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { ORACLE_SESSIONS_SINGLE_MACHINE_NOTE, oracleSessions } from '../sessions.ts';

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length) {
    const dir = cleanup.pop()!;
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }
});

function tempProjectsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-sessions-'));
  cleanup.push(dir);
  return dir;
}

describe('oracle_sessions scanner', () => {
  test('scans local claude project jsonl files without shelling out', async () => {
    const projectsDir = tempProjectsDir();
    const projectDir = join(projectsDir, 'github-com-Soul-Brews-Studio-arra-oracle-v3');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'session-a.jsonl'), [
      JSON.stringify({ sessionId: 'session-a', timestamp: '2026-07-12T00:00:00.000Z', message: { role: 'user', content: 'Find oracle dig schema' } }),
      'not json',
      JSON.stringify({ sessionId: 'session-a', timestamp: '2026-07-12T00:01:00.000Z', model: 'claude-opus', message: { role: 'assistant', content: [{ type: 'text', text: 'Found schema evidence' }] } }),
    ].join('\n'));
    writeFileSync(join(projectDir, 'ignore.txt'), '{}\n');

    const result = await oracleSessions({ projectsDir });

    expect(result.capability).toBe('oracle_sessions');
    expect(result.scope).toBe('single-machine');
    expect(result.note).toBe(ORACLE_SESSIONS_SINGLE_MACHINE_NOTE);
    expect(result.note).toContain('single-machine only');
    expect(result.total).toBe(1);
    expect(result.sessions[0]).toEqual(expect.objectContaining({
      sessionId: 'session-a',
      project: 'github-com-Soul-Brews-Studio-arra-oracle-v3',
      messageCount: 2,
      userMessages: 1,
      assistantMessages: 1,
      oracle: 'claude-opus',
      preview: 'Find oracle dig schema',
      firstTimestamp: Date.parse('2026-07-12T00:00:00.000Z'),
      lastTimestamp: Date.parse('2026-07-12T00:01:00.000Z'),
    }));
    expect(result.sessions[0].path.endsWith('session-a.jsonl')).toBe(true);
  });

  test('returns an empty single-machine result when the local cache is missing', async () => {
    const result = await oracleSessions({ projectsDir: join(tempProjectsDir(), 'missing') });
    expect(result.total).toBe(0);
    expect(result.sessions).toEqual([]);
  });
});
