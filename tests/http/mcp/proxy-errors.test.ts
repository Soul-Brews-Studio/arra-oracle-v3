import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { handleMcpCall, handleMcpListTools } from '../../../src/tools/mcp-in.ts';

function errorText(response: Awaited<ReturnType<typeof handleMcpListTools>>) {
  expect(response.isError).toBe(true);
  return JSON.parse(response.content[0].text) as { error: string };
}

function writeSilentServer() {
  const dir = mkdtempSync(join(tmpdir(), 'arra-mcp-silent-'));
  const script = join(dir, 'silent.mjs');
  writeFileSync(script, `
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
`);
  return { script, cleanup: () => rmSync(dir, { recursive: true }) };
}

test('MCP-IN list reports command spawn failures without hanging', async () => {
  const response = await handleMcpListTools({ command: 'definitely-not-an-arra-mcp-command', timeoutMs: 50 });
  const body = errorText(response);

  expect(body.error).toContain('failed to start external MCP server');
  expect(body.error).toContain('command not found');
});

test('MCP-IN list times out unresponsive external servers', async () => {
  const fixture = writeSilentServer();
  try {
    const response = await handleMcpListTools({ command: 'bun', args: [fixture.script], timeoutMs: 50 });
    const body = errorText(response);

    expect(body.error).toContain('external MCP server timed out after 50ms');
  } finally {
    fixture.cleanup();
  }
});

test('MCP-IN call rejects bad external server config before spawning', async () => {
  const response = await handleMcpCall({
    command: 'bun',
    args: ['server.mjs'],
    timeoutMs: 0,
    toolName: 'echo',
  });
  const body = errorText(response);

  expect(body.error).toBe('timeoutMs must be an integer between 1 and 60000');
});
