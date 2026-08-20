import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider } from '../types.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('LanceDB lifecycle diagnostics never contaminate MCP stdout', async () => {
  const dbPath = mkdtempSync(join(tmpdir(), 'arra-lancedb-stdio-'));
  tempDirs.push(dbPath);
  const embedder: EmbeddingProvider = {
    dimensions: 3,
    embed: async () => [[0, 0, 0]],
  };
  const stdout = spyOn(console, 'log').mockImplementation(() => {});
  const stderr = spyOn(console, 'error').mockImplementation(() => {});
  const store = new LanceDBAdapter('stdio_contract', dbPath, embedder);

  try {
    await store.connect();
    expect(stderr).toHaveBeenCalledWith('[LanceDB] Connected to local DB');
    expect(stdout).not.toHaveBeenCalledWith('[LanceDB] Connected to local DB');
  } finally {
    await store.close();
    stdout.mockRestore();
    stderr.mockRestore();
  }
});
