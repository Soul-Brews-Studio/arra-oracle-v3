import { afterEach, describe, expect, test } from 'bun:test';
import { canvasPluginsCommand } from '../../../src/cli/commands/canvas-plugins.ts';

const originalLog = console.log;
const originalError = console.error;
let stdout: string[] = [];
let stderr: string[] = [];

async function run(args: string[]) {
  stdout = [];
  stderr = [];
  console.log = (message?: unknown) => stdout.push(String(message));
  console.error = (message?: unknown) => stderr.push(String(message));
  const code = await canvasPluginsCommand(['canvas-plugins', ...args]);
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

describe('canvas-plugins CLI validation', () => {
  test('rejects missing or invalid option values', async () => {
    const missingKind = await run(['--kind']);
    const badKind = await run(['--kind', 'vue']);
    const blankId = await run(['--id', '   ']);

    expect(missingKind.code).toBe(1);
    expect(missingKind.stderr).toContain('--kind requires a value');
    expect(badKind.code).toBe(1);
    expect(badKind.stderr).toContain('--kind must be one of');
    expect(blankId.code).toBe(1);
    expect(blankId.stderr).toContain('--id requires a value');
  });

  test('accepts equals-form filters and trims ids', async () => {
    const result = await run(['--kind=react', '--id', ' map ', '--json']);
    const payload = JSON.parse(result.stdout);

    expect(result.code).toBe(0);
    expect(payload.count).toBe(1);
    expect(payload.plugins[0].id).toBe('map');
  });
});
