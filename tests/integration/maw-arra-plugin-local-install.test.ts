import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

type Registry = {
  plugin: string;
  surface: string;
  cli: string;
  menu: string;
  api: string;
  commands: Array<{ name: string; help: string }>;
};
type Handler = (ctx: { source?: string; args?: string[] | Record<string, unknown> }) => Promise<{ ok: boolean; output?: string; error?: string }>;

const maw = spawnSync('sh', ['-c', 'command -v maw'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } }).stdout.trim();
const root = mkdtempSync(join(tmpdir(), 'maw-arra-local-install-'));
const env = {
  PATH: process.env.PATH ?? '',
  HOME: join(root, 'home'),
  XDG_CONFIG_HOME: join(root, 'xdg-config'),
  XDG_DATA_HOME: join(root, 'xdg-data'),
  LANG: process.env.LANG ?? 'C.UTF-8',
  TERM: process.env.TERM ?? 'dumb',
  NO_COLOR: '1',
};
mkdirSync(env.HOME, { recursive: true });
mkdirSync(env.XDG_CONFIG_HOME, { recursive: true });
mkdirSync(env.XDG_DATA_HOME, { recursive: true });

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(args: string[]) {
  return spawnSync(maw, args, { cwd: root, env, encoding: 'utf8' });
}

function expectOk(result: ReturnType<typeof run>, command: string) {
  expect(result.status, `${command}\nstderr:\n${result.stderr}`).toBe(0);
  return result.stdout.trim();
}

function parseRegistry(output: string): Registry {
  return JSON.parse(output) as Registry;
}

describe.skipIf(!maw)('maw arra plugin local install integration', () => {
  test('installs ./arra --local and shares one command registry between CLI and menu', async () => {
    symlinkSync(join(import.meta.dir, '../../maw-plugin'), join(root, 'arra'), 'dir');

    const install = expectOk(run(['plugin', 'install', './arra', '--local']), 'maw plugin install ./arra --local');
    expect(install).toContain('arra@1.0.0 installed');
    expect(install).toContain('mode: linked');

    const help = expectOk(run(['arra', '--help']), 'maw arra --help');
    expect(help).toContain('usage: maw arra');
    expect(help).toContain('surfaces:');
    expect(help).toContain('api: GET/POST /api/arra');

    const cli = parseRegistry(expectOk(run(['arra', 'commands', '--json']), 'maw arra commands --json'));
    const installedEntry = join(root, '.maw', 'plugins', 'arra', 'index.ts');
    const mod = await import(`${pathToFileURL(installedEntry).href}?${Date.now()}`) as { default: Handler };
    const menuResult = await mod.default({ source: 'menu', args: {} });
    const menu = parseRegistry(menuResult.output ?? '{}');

    expect(menuResult.ok).toBe(true);
    expect(cli).toMatchObject({ plugin: 'arra', surface: 'cli', cli: 'arra', menu: '/plugins/arra' });
    expect(menu).toMatchObject({ plugin: 'arra', surface: 'menu', cli: 'arra', menu: '/plugins/arra' });
    expect(cli.commands).toEqual(menu.commands);
    expect(cli.commands).toContainEqual(expect.objectContaining({ name: 'commands', help: 'commands' }));
    expect(cli.commands.length).toBeGreaterThan(10);
  }, 30_000);
});
