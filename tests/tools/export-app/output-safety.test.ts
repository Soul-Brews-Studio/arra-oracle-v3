import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runExportApp, validateCliOptions } from '../../../tools/export-app/index.ts';

const root = mkdtempSync(join(tmpdir(), 'arra-export-output-safety-'));
const dbPath = join(root, 'oracle.db');
const outputDir = join(root, 'backup');
writeFileSync(dbPath, '');
mkdirSync(outputDir);
writeFileSync(join(outputDir, 'stale.json'), '{"old":true}\n');

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('export app output directory safety', () => {
  test('rejects non-empty backup directories by default', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runExportApp(
      ['--output', outputDir, '--db', dbPath],
      (message) => stdout.push(message),
      (message) => stderr.push(message),
    );

    expect(code).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('output directory is not empty');
    expect(stderr.join('')).toContain('--allow-nonempty-output');
  });

  test('allows explicit non-empty output override and dry-run validation', () => {
    expect(parseArgs(['--output', outputDir, '--allow-nonempty-output']))
      .toMatchObject({ allowNonemptyOutput: true });
    expect(() => validateCliOptions(parseArgs(['--output', outputDir, '--db', dbPath, '--allow-nonempty-output'])))
      .not.toThrow();
    expect(() => validateCliOptions(parseArgs(['--output', outputDir, '--db', dbPath, '--dry-run']), { willWrite: false }))
      .not.toThrow();
  });
});
