import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sourceRoot = resolve(import.meta.dir, '../../..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('fresh MCP runs the complete retro ingest → search → read lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'arra-retro-mcp-'));
  tempDirs.push(root);
  const repoRoot = join(root, 'oracle');
  const dataDir = join(root, 'data');
  const filePath = join(repoRoot, 'ψ/memory/retrospectives/2026-08/18/11.33_lifecycle.md');
  const sentinel = `oracle retro lifecycle sentinel ${Date.now()}`;
  mkdirSync(resolve(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `# Lifecycle retro\n\n## Outcome\n\n${sentinel}. This section is deliberately long enough for the retrospective parser.\n`);

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(sourceRoot, 'src/index.ts')],
    env: {
      ...process.env,
      ORACLE_REPO_ROOT: repoRoot,
      ORACLE_DATA_DIR: dataDir,
      ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
      ORACLE_VECTOR_DB_PATH: join(dataDir, 'vectors.db'),
      ORACLE_INDEXER_ENQUEUE: '0',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'retro-lifecycle-test', version: '0.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('oracle_index_retro');

    const indexed = await client.callTool({
      name: 'oracle_index_retro',
      arguments: { repoRoot, filePath },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    expect(indexed.isError).not.toBe(true);
    expect(JSON.parse(indexed.content?.[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      repoRoot,
      filePath,
    });

    const searched = await client.callTool({
      name: 'oracle_search',
      arguments: { query: sentinel, type: 'retro', mode: 'fts', limit: 3 },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    expect(searched.isError).not.toBe(true);
    const searchPayload = JSON.parse(searched.content?.[0]?.text ?? '{}');
    const exact = searchPayload.results.find((result: { source_file?: string }) =>
      result.source_file === 'ψ/memory/retrospectives/2026-08/18/11.33_lifecycle.md');
    expect(exact).toBeDefined();

    const read = await client.callTool({
      name: 'oracle_read',
      arguments: { id: exact.id },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    expect(read.isError).not.toBe(true);
    const readPayload = JSON.parse(read.content?.[0]?.text ?? '{}');
    expect(readPayload).toMatchObject({ source: 'file', resolved_path: realpathSync(filePath) });
    expect(readPayload.content).toContain(sentinel);
    expect(existsSync(join(dataDir, 'oracle.db'))).toBe(true);
  } finally {
    await client.close();
  }
}, 30_000);
