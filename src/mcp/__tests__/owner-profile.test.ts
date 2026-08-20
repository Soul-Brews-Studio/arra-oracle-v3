import { afterEach, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const repoRoot = resolve(import.meta.dir, '../../..');
const clients: Client[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connectOwner(extraEnv: Record<string, string> = {}): Promise<Client> {
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-owner-'));
  tempDirs.push(dataDir);
  for (const file of ['oracle.db', 'vectors.db']) {
    const db = new Database(join(dataDir, file));
    db.close();
  }
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ORACLE_PROFILE: 'owner',
    ORACLE_HTTP_URL: 'http://127.0.0.1:1',
    // An explicit owner profile must win over an inherited read-only flag.
    ORACLE_READ_ONLY: 'true',
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_VECTOR_DB: 'sqlite-vec',
    ORACLE_VECTOR_DB_PATH: join(dataDir, 'vectors.db'),
    ...extraEnv,
  };
  delete env.ORACLE_REMOTE_WRITE_URL;
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [resolve(repoRoot, 'src/index.ts')],
    cwd: repoRoot,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'owner-test', version: '0.0.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}

test('owner profile advertises the full approved write surface through HTTP owner core', async () => {
  const client = await connectOwner();
  const names = (await client.listTools()).tools.map((tool) => tool.name);

  for (const writeTool of [
    'oracle_learn',
    'oracle_supersede',
    'oracle_handoff',
    'oracle_thread',
    'oracle_trace',
    'oracle_verify',
  ]) {
    expect(names).toContain(writeTool);
  }
  expect(names).toContain('oracle_search');
  expect(names).toContain('oracle_read');
}, 30000);

test('owner profile fails closed without an HTTP owner core', async () => {
  await expect(connectOwner({ ORACLE_HTTP_URL: '' })).rejects.toThrow();
}, 30000);
