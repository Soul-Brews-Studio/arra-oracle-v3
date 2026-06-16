import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findProcesses } from '../../src/process-manager/index.ts';

test('process search treats shell metacharacters as literal text', async () => {
  if (process.platform === 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'arra-process-pattern-'));
  const marker = join(dir, 'marker');
  try {
    await findProcesses(`__arra_no_match__"; touch "${marker}"; echo "`);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
