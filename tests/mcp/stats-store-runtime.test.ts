import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sourceRoot = resolve(import.meta.dir, '../..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('oracle_stats reports the canonical data store of its stdio MCP process', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arra-stats-mcp-'));
  tempDirs.push(root);
  const dataDir = join(root, 'alternate-store');
  const repoRoot = join(root, 'unrelated-repo');
  const dbDir = join(root, 'unrelated-db');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(dbDir, { recursive: true });

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(sourceRoot, 'src/index.ts')],
    cwd: sourceRoot,
    env: {
      ...process.env,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dbDir, 'oracle.db'),
      ORACLE_REPO_ROOT: repoRoot,
      ORACLE_EMBEDDER: 'none',
      ORACLE_INDEXER_ENQUEUE: '0',
      ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
      ARRA_PLUGIN_HOT_RELOAD: '0',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stats-store-runtime-test', version: '0.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'oracle_stats', arguments: {} }) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content?.[0]?.text ?? '{}') as Record<string, unknown>;

    expect(payload.store).toBe(realpathSync(dataDir));
    expect(payload.store).not.toBe(realpathSync(repoRoot));
    expect(payload.store).not.toBe(realpathSync(dbDir));
  } finally {
    await client.close().catch(() => undefined);
  }
}, 30_000);
