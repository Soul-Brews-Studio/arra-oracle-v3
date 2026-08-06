import { afterEach, describe, expect, test } from 'bun:test';
import { serveCommand } from '../../../src/cli/commands/serve.ts';

const originalLog = console.log;
const originalError = console.error;

async function run(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  console.log = (...parts: unknown[]) => stdout.push(parts.join(' '));
  console.error = (...parts: unknown[]) => stderr.push(parts.join(' '));
  const code = await serveCommand(args);
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

describe('serve CLI argument hardening', () => {
  test('prints help without starting the server', async () => {
    const result = await run(['serve', '--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('start [--foreground|--background]');
  });

  test('rejects bad status and stop options', async () => {
    const status = await run(['serve', 'status', '--verbose']);
    const stop = await run(['serve', 'stop', '--json']);

    expect(status.code).toBe(1);
    expect(status.stderr).toContain('unknown serve status option: --verbose');
    expect(stop.code).toBe(1);
    expect(stop.stderr).toContain('unknown serve stop option: --json');
  });

  test('rejects conflicting start mode flags before launching', async () => {
    const result = await run(['serve', 'start', '--foreground', '--background']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Cannot use --foreground and --background together');
  });

  test('rejects unknown start flags before launching', async () => {
    const result = await run(['serve', 'start', '--read-only']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unknown serve start option: --read-only');
  });
});
