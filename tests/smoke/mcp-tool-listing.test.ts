import { expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { createSmokeEnv, logSmoke, REPO_ROOT } from './_helpers.ts';

async function listMcpTools(env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  const script = `
    const { OracleMCPServer } = await import('./src/mcp/server.ts');
    const groups = { search: true, knowledge: true, session: true, forum: true, trace: true, standalone: true };
    const server = new OracleMCPServer({ toolGroups: groups });
    const raw = server.server._requestHandlers.get('tools/list');
    const result = await raw({ method: 'tools/list', params: {} });
    console.log(JSON.stringify(result.tools.map((tool) => tool.name)));
    await server.cleanup();
  `;
  const proc = Bun.spawn(['bun', '--eval', script], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env, ORACLE_HTTP_URL: 'http://127.0.0.1:1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

test('MCP tools/list exposes search and bridge tools in proxy mode', async () => {
  const smoke = createSmokeEnv('mcp-tools');
  try {
    const result = await listMcpTools(smoke.env);
    expect(result.code).toBe(0);
    const names = JSON.parse(result.stdout) as string[];
    expect(names).toContain('oracle_search');
    expect(names).toContain('oracle_mcp_call');
    logSmoke('mcp-tool-listing', { count: names.length, hasSearch: names.includes('oracle_search') });
  } finally {
    rmSync(smoke.root, { recursive: true });
  }
});
