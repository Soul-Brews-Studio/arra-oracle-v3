/**
 * #987 / #1244 architecture guard:
 * with ORACLE_API set, oracle_learn must run through the HTTP server and avoid
 * opening the stdio MCP's embedded SQLite/vector path entirely.
 */

import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

test('oracle_learn proxies through ORACLE_API without opening the MCP DB', async () => {
  const port = 49600 + Math.floor(Math.random() * 300);
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverDataDir = tempDir('arra-learn-proxy-server-');
  const serverRepoRoot = tempDir('arra-learn-proxy-repo-');
  const mcpDataDir = tempDir('arra-learn-proxy-mcp-');
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
    { name: 'mcp-learn-proxy-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: 'oracle_learn',
      arguments: {
        pattern: `#987 learn proxy smoke ${Date.now()}`,
        concepts: ['proxy', 'sqlite-contention'],
        project: 'github.com/soul-brews-studio/arra-oracle-v3',
      },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content?.[0]?.text ?? '{}');
    expect(payload.success).toBe(true);
    expect(payload.file).toContain('ψ/memory/learnings/');
    expect(stderr.join('')).not.toContain('ORACLE_API unavailable for oracle_learn');
    expect(existsSync(mcpDbPath)).toBe(false);
  } finally {
    await client.close();
  }
}, 30_000);
