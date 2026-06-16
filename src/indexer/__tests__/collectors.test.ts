import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllMarkdownFiles } from '../collectors.ts';

describe('getAllMarkdownFiles', () => {
  test('skips broken symlinks instead of crashing on ENOENT', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-md-scan-'));
    try {
      const keep = path.join(tmp, 'keep.md');
      fs.writeFileSync(keep, '# keep\n');
      fs.symlinkSync(path.join(tmp, 'missing.md'), path.join(tmp, 'broken.md'));

      expect(() => getAllMarkdownFiles(tmp)).not.toThrow();
      expect(getAllMarkdownFiles(tmp)).toEqual([keep]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
