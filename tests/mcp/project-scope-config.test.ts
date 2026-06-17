import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { launcherRoot, mcpEntrypoint } from '../../bin/mcp.ts';

const repoRoot = process.cwd();

describe('project-scope MCP launcher config', () => {
  test('.mcp.json does not require CLAUDE_PLUGIN_ROOT interpolation', async () => {
    const config = await Bun.file('.mcp.json').json() as any;
    const server = config.mcpServers['arra-oracle'];
    expect(server.command).toBe('bun');
    expect(JSON.stringify(server.args)).not.toContain('CLAUDE_PLUGIN_ROOT}');
    expect(server.args.join(' ')).toContain('bin/mcp.ts');
  });

  test('launcher resolves the repo-local MCP entrypoint from its own directory', () => {
    expect(launcherRoot()).toBe(repoRoot);
    expect(mcpEntrypoint()).toBe(join(repoRoot, 'src', 'index.ts'));
  });

  test('fresh project clone can resolve entry without plugin env', async () => {
    const proc = Bun.spawn(['bun', 'bin/mcp.ts', '--resolve-entry'], {
      cwd: repoRoot,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: undefined },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(join(repoRoot, 'src', 'index.ts'));
  });
});
