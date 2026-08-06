import { describe, expect, test } from 'bun:test';
import { parseIndexerCliArgs } from '../../../src/indexer/cli.ts';

describe('indexer CLI argument parsing', () => {
  test('parses read-only and repo root options', () => {
    const result = parseIndexerCliArgs(['--repo-root', '/tmp/repo', '--read-only']);

    expect(result).toEqual({ repoRoot: '/tmp/repo', readOnly: true, help: false });
  });

  test('parses equals-form repo root and help aliases', () => {
    expect(parseIndexerCliArgs(['--repo-root=/tmp/repo']).repoRoot).toBe('/tmp/repo');
    expect(parseIndexerCliArgs(['-h']).help).toBe(true);
    expect(parseIndexerCliArgs(['--help']).help).toBe(true);
  });

  test('rejects missing option values and bad flags', () => {
    expect(() => parseIndexerCliArgs(['--repo-root'])).toThrow('--repo-root requires a path');
    expect(() => parseIndexerCliArgs(['--repo-root='])).toThrow('--repo-root requires a path');
    expect(() => parseIndexerCliArgs(['--bogus'])).toThrow('unknown index option: --bogus');
  });
});
