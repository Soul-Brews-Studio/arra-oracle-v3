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

async function connectReadOnly(extraEnv: Record<string, string>): Promise<Client> {
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-ro-remote-'));
  tempDirs.push(dataDir);
  // Read-only config validation requires existing DB files.
  for (const file of ['oracle.db', 'vectors.db']) {
    const db = new Database(join(dataDir, file));
    db.exec('PRAGMA user_version = 0;');
    db.close();
  }
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ORACLE_READ_ONLY: 'true',
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_VECTOR_DB: 'sqlite-vec',
    ORACLE_VECTOR_DB_PATH: join(dataDir, 'vectors.db'),
  };
  delete env.DATABASE_URL;
  delete env.ORACLE_REMOTE_WRITE_URL;
  delete env.ORACLE_HTTP_URL; // embedded reads — ORACLE_REMOTE_WRITE_URL must not flip them to proxy
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
  const client = new Client({ name: 'ro-test', version: '0.0.0' });
  clients.push(client);
  await client.connect(transport);
  return client;
}

test('read-mostly guide matches the bounded-retro catalog', async () => {
  const client = await connectReadOnly({ ORACLE_REMOTE_WRITE_URL: 'http://127.0.0.1:1' });
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  const result = await client.callTool({ name: '____IMPORTANT', arguments: {} }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;
  expect(names).toContain('oracle_index_retro');
  expect(names).not.toContain('oracle_learn');
  expect(names).not.toContain('oracle_supersede');
  expect(text).toContain('oracle_index_retro');
  expect(text).not.toContain('oracle_learn');
  expect(text).not.toContain('oracle_supersede');
}, 30000);

test('read-only guide and catalog omit bounded retro without the owner core', async () => {
  const client = await connectReadOnly({});
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  const result = await client.callTool({ name: '____IMPORTANT', arguments: {} }) as { content: Array<{ text: string }> };
  const text = result.content[0].text;
  expect(names).not.toContain('oracle_index_retro');
  expect(text).not.toContain('oracle_index_retro');
}, 30000);

test('regression: enabling bounded write leaves oracle_search on the local embedded payload shape', async () => {
  const client = await connectReadOnly({ ORACLE_REMOTE_WRITE_URL: 'http://127.0.0.1:1' });
  const result = await client.callTool({ name: 'oracle_search', arguments: { query: 'anything' } }) as { content: Array<{ text: string }>; isError?: boolean };
  const payload = JSON.parse(result.content[0].text);
  // Local MCP payload keeps mode under metadata; the HTTP payload hoists it to
  // the top level — the exact shape drift Riddler's seat regression caught.
  expect(payload.metadata?.mode).toBeDefined();
  expect(payload.mode).toBeUndefined();
}, 30000);
