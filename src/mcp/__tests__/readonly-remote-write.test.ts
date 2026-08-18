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
  const env: Record<string, string> = { ...process.env as Record<string, string>, ORACLE_READ_ONLY: 'true', ORACLE_DATA_DIR: dataDir, ...extraEnv };
  delete env.ORACLE_HTTP_URL; // embedded reads — ORACLE_REMOTE_WRITE_URL must not flip them to proxy
  delete env.ORACLE_API;
  delete env.NEO_ARRA_API;
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

test('read-only seat WITH remote-write core advertises oracle_index_retro but no other write tools', async () => {
  const client = await connectReadOnly({ ORACLE_REMOTE_WRITE_URL: 'http://127.0.0.1:1' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).toContain('oracle_index_retro');
  expect(names).not.toContain('oracle_learn');
  expect(names).not.toContain('oracle_supersede');
}, 30000);

test('read-only seat WITHOUT remote-write core hides oracle_index_retro and rejects the call', async () => {
  const client = await connectReadOnly({});
  const names = (await client.listTools()).tools.map((t) => t.name);
  expect(names).not.toContain('oracle_index_retro');
  const result = await client.callTool({ name: 'oracle_index_retro', arguments: { repoRoot: '/tmp', filePath: '/tmp/x.md' } }) as { content: Array<{ text: string }> };
  expect(result.content[0].text).toContain('read-only mode');
}, 30000);

test('read-only seat with unreachable remote-write core fails closed instead of writing locally', async () => {
  const client = await connectReadOnly({ ORACLE_REMOTE_WRITE_URL: 'http://127.0.0.1:1' });
  const result = await client.callTool({ name: 'oracle_index_retro', arguments: { repoRoot: '/tmp', filePath: '/tmp/x.md' } }) as { content: Array<{ text: string }> };
  expect(result.content[0].text).toMatch(/Cannot reach|owner core/);
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
