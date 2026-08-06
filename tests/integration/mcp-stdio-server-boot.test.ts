import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REPO_ROOT, startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

type JsonRecord = Record<string, unknown>;
type ToolResult = { content?: Array<{ type?: string; text?: string }>; isError?: boolean };

let server: SmokeServer | null = null;
const tempDirs: string[] = [];

beforeAll(async () => {
  server = await startSmokeServer({ name: 'integration-mcp-stdio-server', withPlugin: true });
});

afterAll(async () => {
  await server?.stop();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function expectRecord(value: unknown): asserts value is JsonRecord {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
}

async function fetchJson(path: string, init: RequestInit = {}) {
  expect(server).not.toBeNull();
  const headers = new Headers(init.headers);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${server!.baseUrl}${path}`, { ...init, headers });
  const body = await response.json() as unknown;
  expectRecord(body);
  expect(response.headers.get('x-api-version')).toBe('v1');
  return { response, body };
}

function tempMcpEnv(baseUrl: string): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'arra-integration-mcp-stdio-'));
  tempDirs.push(root);
  const home = join(root, 'home');
  const dataDir = join(root, 'data');
  mkdirSync(home, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    ORACLE_DATA_DIR: dataDir,
    ORACLE_DB_PATH: join(dataDir, 'oracle.db'),
    ORACLE_REPO_ROOT: server?.repoRoot ?? REPO_ROOT,
    ORACLE_HTTP_URL: baseUrl,
    ORACLE_API: baseUrl,
    ORACLE_EMBEDDER: 'none',
    ORACLE_INDEXER_ENQUEUE: '0',
    ORACLE_TOOL_GROUPS_HOT_RELOAD: '0',
    ARRA_PLUGIN_HOT_RELOAD: '0',
  } as Record<string, string>;
}

function parseToolJson(result: ToolResult): JsonRecord {
  expect(result.isError).not.toBe(true);
  const text = result.content?.[0]?.text ?? '';
  const parsed = JSON.parse(text) as unknown;
  expectRecord(parsed);
  return parsed;
}

describe('integration MCP stdio and full server boot', () => {
  test('mounts core routes through the full server and /api/v1 rewrite', async () => {
    const health = await fetchJson('/api/v1/health');
    expect(health.response.status).toBe(200);
    expect(health.body.status).toBe('ok');

    const profile = await fetchJson('/api/v1/oracles/profiles/thor');
    expect(profile.response.status).toBe(200);
    expect(profile.body).toMatchObject({ id: 'thor-oracle', slug: 'thor' });

    const verify = await fetchJson('/api/v1/verify?check=true&type=all');
    expect(verify.response.status).toBe(200);
    expectRecord(verify.body.counts);

    const mcpTools = await fetchJson('/api/v1/mcp/tools');
    expect(mcpTools.response.status).toBe(200);
    expect(Array.isArray(mcpTools.body.tools)).toBe(true);
    expect(mcpTools.body.tools).toContainEqual(expect.objectContaining({ name: 'oracle_profile', remoteable: true }));

    const formats = await fetchJson('/api/v1/vector/export/formats');
    expect(formats.response.status).toBe(200);
    expect(Array.isArray(formats.body.formats)).toBe(true);

    const plugins = await fetchJson('/api/v1/plugins');
    expect(plugins.response.status).toBe(200);
    expect(plugins.body.plugins).toContainEqual(expect.objectContaining({ name: 'smoke-orbit' }));
  }, 30_000);

  test('completes MCP stdio initialize, tools/list, and tools/call against the booted server', async () => {
    expect(server).not.toBeNull();
    const transport = new StdioClientTransport({
      command: 'bun',
      args: [join(REPO_ROOT, 'src/index.ts')],
      cwd: REPO_ROOT,
      env: tempMcpEnv(server!.baseUrl),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'arra-integration-mcp-stdio', version: '0.0.0' }, { capabilities: {} });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const toolNames = listed.tools.map((tool) => tool.name);
      expect(toolNames).toContain('oracle_profile');
      expect(toolNames).toContain('oracle_verify');

      const result = await client.callTool({
        name: 'oracle_profile',
        arguments: { id: 'thor' },
      }) as ToolResult;
      const payload = parseToolJson(result);
      expect(payload).toMatchObject({ id: 'thor-oracle', slug: 'thor' });
    } finally {
      await client.close().catch(() => undefined);
    }
  }, 30_000);
});
