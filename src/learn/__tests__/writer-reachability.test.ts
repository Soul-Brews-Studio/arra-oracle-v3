import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('active learning writer archival import guard', () => {
  test('has no direct imports of archival vault handler or migrate modules', () => {
    for (const file of [
      'src/routes/learn/crud.ts', 'src/tools/learn.ts', 'src/server/handlers.ts', 'src/trace/learning-files.ts',
      'src/learn/authority.ts', 'src/learn/target.ts',
    ]) {
      const source = readFileSync(resolve(file), 'utf8');
      expect(source).not.toMatch(/vault\/(handler|migrate)\.ts/);
    }
  });
});
