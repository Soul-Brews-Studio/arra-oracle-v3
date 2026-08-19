import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Database } from 'bun:sqlite';

const repoRoot = resolve(import.meta.dir, '../../..');
const tempDirs: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => {});
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Birth spec v5 D3/blocker 5: the delegate seat must stay write-free even when
// the launcher's environment carries remote-write / proxy URLs, so every test
// here connects WITH those variables set — proving no default re-enables them.
async function connectDelegate(extraEnv: Record<string, string> = {}): Promise<Client> {
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-delegate-'));
  tempDirs.push(dataDir);
  for (const file of ['oracle.db', 'vectors.db']) {
    const db = new Database(join(dataDir, file));
    db.exec('PRAGMA user_version = 0;');
    db.close();
  }
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ORACLE_PROFILE: 'delegate',
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_VECTOR_DB: 'sqlite-vec',
    ORACLE_VECTOR_DB_PATH: join(dataDir, 'vectors.db'),
    ORACLE_REMOTE_WRITE_URL: 'http://127.0.0.1:1',
    ORACLE_HTTP_URL: 'http://127.0.0.1:1',
  };
  delete env.DATABASE_URL;
  delete env.ORACLE_READ_ONLY;
  delete env.ORACLE_API;
  delete env.NEO_ARRA_API;
  Object.assign(env, extraEnv);
  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(repoRoot, 'src/index.ts')],
    cwd: repoRoot,
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'delegate-test', version: '0.0.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}

test('delegate catalog and guide omit every write tool despite write URLs in env', async () => {
  const client = await connectDelegate();
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  const guide = await client.callTool({ name: '____IMPORTANT', arguments: {} }) as { content: Array<{ text: string }> };
  const guideText = guide.content[0].text;
  for (const writeTool of ['oracle_index_retro', 'oracle_learn', 'oracle_supersede']) {
    expect(names).not.toContain(writeTool);
    expect(guideText).not.toContain(writeTool);
  }
  expect(names).toContain('oracle_search');
  expect(names).toContain('oracle_read');
}, 30000);

test('delegate oracle_profile reports the trusted server capability field', async () => {
  const boundRoot = mkdtempSync(join(tmpdir(), 'arra-delegate-owner-'));
  tempDirs.push(boundRoot);
  const client = await connectDelegate({ ORACLE_MEMORY_OWNER_ROOT: boundRoot });
  const result = await client.callTool({ name: 'oracle_profile', arguments: {} }) as { content: Array<{ text: string }> };
  const payload = JSON.parse(result.content[0].text) as { server?: Record<string, unknown> };
  expect(payload.server).toMatchObject({
    profile: 'delegate',
    readOnly: true,
    remoteWriteApiBase: null,
    oracleApiBase: null,
    memoryOwnerRoot: boundRoot,
  });
}, 30000);

test('read-mostly behavior is unchanged when ORACLE_PROFILE is unset', async () => {
  const client = await connectDelegate({ ORACLE_PROFILE: '', ORACLE_READ_ONLY: 'true' });
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  // Same env otherwise (remote-write URL set) → bounded retro exception stays.
  expect(names).toContain('oracle_index_retro');
  expect(names).not.toContain('oracle_learn');
}, 30000);
