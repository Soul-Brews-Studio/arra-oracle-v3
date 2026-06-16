/**
 * Regression for #1244 Phase 2 (trace-create gap): oracle_trace should proxy
 * through ORACLE_API instead of lazy-opening embedded SQLite when the HTTP
 * server is reachable.
 */

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(import.meta.dir, '../../..');
const tempDirs: string[] = [];
const childProcesses: Array<{ kill: () => void }> = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function waitForHealth(baseUrl: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch { /* server still booting */ }
    await Bun.sleep(250);
  }
  throw new Error(`server did not become healthy: ${baseUrl}`);
}

afterEach(() => {
  for (const proc of childProcesses.splice(0)) proc.kill();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('oracle_trace proxies through ORACLE_API without opening the MCP DB', async () => {
  const port = 48600 + Math.floor(Math.random() * 500);
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverDataDir = tempDir('arra-trace-proxy-server-');
  const serverRepoRoot = tempDir('arra-trace-proxy-repo-');
  const mcpDataDir = tempDir('arra-trace-proxy-mcp-');
  const mcpDbPath = join(mcpDataDir, 'oracle.db');

  const server = Bun.spawn(['bun', 'src/server.ts'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ORACLE_PORT: String(port),
      ORACLE_DATA_DIR: serverDataDir,
      ORACLE_DB_PATH: join(serverDataDir, 'oracle.db'),
      ORACLE_REPO_ROOT: serverRepoRoot,
      ORACLE_INDEXER_ENQUEUE: '0',
    },
  });
  childProcesses.push(server);
  await waitForHealth(baseUrl);

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(repoRoot, 'src/index.ts')],
    env: {
      ...process.env,
      ORACLE_API: baseUrl,
      ORACLE_DATA_DIR: mcpDataDir,
      ORACLE_DB_PATH: mcpDbPath,
      ORACLE_INDEXER_ENQUEUE: '0',
    },
    stderr: 'pipe',
  });

  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));

  const client = new Client(
    { name: 'mcp-trace-proxy-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'oracle_trace',
      arguments: { query: 'trace proxy route smoke', scope: 'project', project: 'test/repo' },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
    expect(payload.success).toBe(true);
    expect(payload.trace_id).toBeString();
    expect(stderr.join('')).not.toContain('ORACLE_API unavailable for oracle_trace');
    expect(existsSync(mcpDbPath)).toBe(false);
  } finally {
    await client.close();
  }
}, 30_000);
