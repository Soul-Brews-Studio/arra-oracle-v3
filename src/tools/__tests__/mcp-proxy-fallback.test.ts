/**
 * Regression for #5 Phase 1:
 * ORACLE_HTTP_URL toggles MCP dual-mode behavior.
 * - unset: direct embedded mode for standalone usage
 * - set: covered tools stay on the single HTTP writer path
 */

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(import.meta.dir, '../../..');
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('MCP uses embedded mode when ORACLE_HTTP_URL is unset', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-mcp-fallback-'));
  tempDirs.push(dataDir);

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(repoRoot, 'src/index.ts')],
    env: {
      ...process.env,
      ORACLE_HTTP_URL: '',
      ORACLE_API: '',
      NEO_ARRA_API: '',
      ORACLE_DATA_DIR: dataDir,
      ORACLE_INDEXER_ENQUEUE: '0',
    },
    stderr: 'pipe',
  });

  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));

  const client = new Client(
    { name: 'mcp-proxy-fallback-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: 'oracle_search',
      arguments: { query: 'standalone fallback smoke', mode: 'fts', limit: 1 },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.text).toContain('"results"');
    expect(stderr.join('')).toContain('Running in embedded mode');
  } finally {
    await client.close();
  }
}, 20_000);

test('MCP covered tools return HTTP error when ORACLE_HTTP_URL is unreachable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'arra-mcp-http-'));
  tempDirs.push(dataDir);

  const transport = new StdioClientTransport({
    command: 'bun',
    args: [join(repoRoot, 'src/index.ts')],
    env: {
      ...process.env,
      ORACLE_HTTP_URL: 'http://127.0.0.1:1',
      ORACLE_API: '',
      NEO_ARRA_API: '',
      ORACLE_DATA_DIR: dataDir,
      ORACLE_INDEXER_ENQUEUE: '0',
    },
    stderr: 'pipe',
  });

  const stderr: string[] = [];
  transport.stderr?.on('data', (chunk) => stderr.push(chunk.toString()));

  const client = new Client(
    { name: 'mcp-proxy-http-test', version: '0.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: 'oracle_search',
      arguments: { query: 'http proxy smoke', mode: 'fts', limit: 1 },
    }) as { content?: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain('Cannot reach ARRA Oracle at http://127.0.0.1:1');
    expect(stderr.join('')).toContain('Running in HTTP-proxy mode');
    expect(stderr.join('')).not.toContain('lazy-opening embedded fallback');
  } finally {
    await client.close();
  }
}, 20_000);
