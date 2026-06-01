import { expect, test } from 'bun:test';
import { runCli } from '../_run.ts';

test('bundled unified manifest plugin still exposes a CLI command', async () => {
  const result = await runCli(['unified-example'], {
    ORACLE_API: undefined,
    NEO_ARRA_API: undefined,
  });

  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Hello from the unified-example plugin (cli surface)');
}, 15_000);
