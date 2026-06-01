import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../_run.ts';

const temps: string[] = [];
const tmp = () => (temps.push(mkdtempSync(join(tmpdir(), 'arra-plugin-toggle-'))), temps.at(-1)!);
const env = (xdg: string) => ({ XDG_CONFIG_HOME: xdg, ORACLE_API: undefined, NEO_ARRA_API: undefined });

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('plugin disable/enable writes server plugin config toggles', async () => {
  const xdg = tmp();
  const configPath = join(xdg, 'arra', 'config.json');

  const disabled = await runCli(['plugin', 'disable', 'federation'], env(xdg));
  expect(disabled.code).toBe(0);
  expect(disabled.stdout).toContain('disabled server plugin: federation');
  expect(disabled.stdout).toContain(`Config: ${configPath}`);
  expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
    disabledPlugins: ['federation'],
  });

  const enabled = await runCli(['plugin', 'enable', 'federation'], env(xdg));
  expect(enabled.code).toBe(0);
  expect(enabled.stdout).toContain('enabled server plugin: federation');
  expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
    enabledPlugins: ['federation'],
  });
});

test('plugin disable refuses known core server plugins before writing config', async () => {
  const xdg = tmp();
  const result = await runCli(['plugin', 'disable', 'search'], env(xdg));
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('Cannot disable core server plugin "search"');
});
