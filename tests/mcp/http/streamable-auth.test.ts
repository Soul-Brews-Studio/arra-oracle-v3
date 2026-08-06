import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../../../src/server.ts';
import { createMcpStreamableRoutes } from '../../../src/routes/mcp/index.ts';
import type { ToolGroupConfig } from '../../../src/config/tool-groups.ts';
import type { UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';

const originalEnv = {
  ORACLE_HTTP_URL: process.env.ORACLE_HTTP_URL,
  ORACLE_MCP_HTTP_TOKEN: process.env.ORACLE_MCP_HTTP_TOKEN,
  ARRA_API_TOKEN: process.env.ARRA_API_TOKEN,
  ORACLE_REPO_ROOT: process.env.ORACLE_REPO_ROOT,
};

const allToolGroups: ToolGroupConfig = {
  search: true,
  knowledge: true,
  session: true,
  forum: true,
  oracle: true,
  trace: true,
  standalone: true,
};

beforeEach(() => {
  process.env.ORACLE_HTTP_URL = 'http://127.0.0.1:1';
  delete process.env.ORACLE_MCP_HTTP_TOKEN;
  delete process.env.ARRA_API_TOKEN;
});

afterEach(() => {
  restoreEnv('ORACLE_HTTP_URL', originalEnv.ORACLE_HTTP_URL);
  restoreEnv('ORACLE_MCP_HTTP_TOKEN', originalEnv.ORACLE_MCP_HTTP_TOKEN);
  restoreEnv('ARRA_API_TOKEN', originalEnv.ARRA_API_TOKEN);
  restoreEnv('ORACLE_REPO_ROOT', originalEnv.ORACLE_REPO_ROOT);
});

describe('Streamable HTTP MCP bearer auth', () => {
  test('does not require a token for existing /api/health route', async () => {
    process.env.ORACLE_MCP_HTTP_TOKEN = 'mcp-secret';
    const app = createApp({ unifiedPlugins: runtime() });

    const res = await app.handle(new Request('http://local/api/health'));

    expect(res.status).toBe(200);
  });

  test('rejects unauthenticated /mcp requests', async () => {
    const app = mcpApp({ ORACLE_MCP_HTTP_TOKEN: 'mcp-secret' });
    const res = await postMcp(app, initializeRequest());

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  test('accepts ORACLE_MCP_HTTP_TOKEN and exposes only remoteable tools', async () => {
    const app = mcpApp({ ORACLE_MCP_HTTP_TOKEN: 'mcp-secret' });
    const sessionId = await initialize(app, 'mcp-secret');
    await notifyInitialized(app, sessionId, 'mcp-secret');

    const names = await listToolNames(app, sessionId, 'mcp-secret');

    expect(names).toContain('oracle_search');
    expect(names).not.toContain('____IMPORTANT');
    expect(names).not.toContain('oracle_recap');
    expect(names).not.toContain('oracle_mcp_call');
  });

  test('applies read-only filtering to remote HTTP sessions', async () => {
    const app = mcpApp({ ORACLE_MCP_HTTP_TOKEN: 'mcp-secret', ORACLE_READ_ONLY: 'true' });
    const sessionId = await initialize(app, 'mcp-secret');
    await notifyInitialized(app, sessionId, 'mcp-secret');

    const names = await listToolNames(app, sessionId, 'mcp-secret');

    expect(names).toContain('oracle_search');
    expect(names).not.toContain('oracle_learn');
    expect(names).not.toContain('oracle_verify');
  });

  test('layers existing tool group filters under the remote allowlist', async () => {
    const app = mcpApp({ ORACLE_MCP_HTTP_TOKEN: 'mcp-secret' }, { toolGroups: { ...allToolGroups, search: false } });
    const sessionId = await initialize(app, 'mcp-secret');
    await notifyInitialized(app, sessionId, 'mcp-secret');

    const names = await listToolNames(app, sessionId, 'mcp-secret');

    expect(names).not.toContain('oracle_search');
    expect(names).toContain('oracle_stats');
  });

  test('remote allowlist blocks local-only tool calls even when explicitly enabled', async () => {
    const toolGroups = { ...allToolGroups, enabled_tools: ['oracle_mcp_call'] };
    const app = mcpApp({ ORACLE_MCP_HTTP_TOKEN: 'mcp-secret' }, { toolGroups });
    const sessionId = await initialize(app, 'mcp-secret');
    await notifyInitialized(app, sessionId, 'mcp-secret');

    const names = await listToolNames(app, sessionId, 'mcp-secret');
    const res = await postMcp(app, toolCallRequest('oracle_mcp_call'), 'mcp-secret', sessionId);
    const body = await res.json() as any;

    expect(names).not.toContain('oracle_mcp_call');
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('Unknown tool: oracle_mcp_call');
  });

  test('falls back to ARRA_API_TOKEN and deletes sessions', async () => {
    const app = mcpApp({ ARRA_API_TOKEN: 'fallback-secret' });
    const sessionId = await initialize(app, 'fallback-secret');

    const deleted = await app.handle(new Request('http://local/mcp', {
      method: 'DELETE',
      headers: authedHeaders('fallback-secret', sessionId),
    }));
    const afterDelete = await postMcp(app, toolsListRequest(), 'fallback-secret', sessionId);

    expect(deleted.status).toBe(200);
    expect(afterDelete.status).toBe(404);
  });

  test('disables and re-enables /mcp by config live', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-streamable-gate-'));
    try {
      const configPath = path.join(repoRoot, 'arra.config.json');
      fs.writeFileSync(configPath, JSON.stringify({ mcp: false }));

      const app = mcpApp({
        ORACLE_MCP_HTTP_TOKEN: 'mcp-secret',
        ORACLE_REPO_ROOT: repoRoot,
      });
      const offResponse = await postMcp(app, initializeRequest(), 'mcp-secret');
      expect(offResponse.status).toBe(404);

      fs.writeFileSync(configPath, JSON.stringify({ mcp: true }));
      const onResponse = await postMcp(app, initializeRequest(), 'mcp-secret');
      expect(onResponse.status).toBe(200);
      expect(onResponse.headers.get('mcp-session-id')).not.toBeNull();
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

function mcpApp(env: Record<string, string>, options: { toolGroups?: ToolGroupConfig; readOnly?: boolean } = {}) {
  return new Elysia().use(createMcpStreamableRoutes({ env, enableJsonResponse: true, ...options }));
}

async function initialize(app: Elysia, token: string): Promise<string> {
  const res = await postMcp(app, initializeRequest(), token);
  expect(res.status).toBe(200);
  const sessionId = res.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

async function notifyInitialized(app: Elysia, sessionId: string, token: string) {
  const res = await postMcp(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, token, sessionId);
  expect(res.status).toBe(202);
}

async function listToolNames(app: Elysia, sessionId: string, token: string): Promise<string[]> {
  const res = await postMcp(app, toolsListRequest(), token, sessionId);
  const body = await res.json() as any;
  expect(res.status).toBe(200);
  return body.result.tools.map((tool: { name: string }) => tool.name);
}

function postMcp(app: Elysia, body: unknown, token?: string, sessionId?: string) {
  return app.handle(new Request('http://local/mcp', {
    method: 'POST',
    headers: token ? authedHeaders(token, sessionId) : { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  }));
}

function authedHeaders(token: string, sessionId?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-11-25' } : {}),
  };
}

function initializeRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } },
  };
}

function toolsListRequest() {
  return { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
}

function toolCallRequest(name: string) {
  return { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: {} } };
}

function runtime(): UnifiedRuntime {
  return {
    pluginCount: 0,
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => ({}),
    pluginStatuses: () => [],
    pluginRegistry: () => [],
    init: async () => {},
    reload: async () => {},
    stop: async () => {},
  };
}

function restoreEnv(name: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
