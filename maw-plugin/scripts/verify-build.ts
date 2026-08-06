import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

type VerifyOptions = { root?: string; keep?: boolean };
type Lock = { plugins?: Record<string, { version?: string; sha256?: string; source?: string }> };

export type VerifyBuildResult = {
  workDir: string;
  pluginDir: string;
  entryPath: string;
  manifestPath: string;
  tgzPath: string;
  lockPath: string;
  artifactSha256: string;
  packageSha256: string;
  lockSha256: string;
};

function run(cmd: string, args: string[], cwd: string, home: string): string {
  const result = spawnSync(cmd, args, { cwd, env: { ...process.env, HOME: home }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${cmd} failed`);
  return `${result.stdout}${result.stderr}`;
}

function sha256(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function copyPlugin(root: string, pluginDir: string): void {
  cpSync(root, pluginDir, {
    recursive: true,
    filter: (src) => !['dist', '.maw'].includes(basename(src)) && !src.endsWith('.tgz'),
  });
}

export function verifyMawPluginBuild(options: VerifyOptions = {}): VerifyBuildResult {
  const root = resolve(options.root ?? process.cwd());
  const workDir = mkdtempSync(join(tmpdir(), 'arra-maw-build-'));
  const home = join(workDir, 'home');
  const pluginDir = join(workDir, 'arra');
  try {
    copyPlugin(root, pluginDir);
    run('maw', ['plugin', 'build'], pluginDir, home);
    const manifestPath = join(pluginDir, 'dist', 'plugin.json');
    const entryPath = join(pluginDir, 'dist', 'index.js');
    const tgzPath = join(pluginDir, 'arra-1.0.0.tgz');
    if (!existsSync(entryPath) || !existsSync(manifestPath) || !existsSync(tgzPath)) {
      throw new Error('maw plugin build did not emit dist/index.js, dist/plugin.json, and tgz');
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { artifact?: { sha256?: string } };
    const artifactSha256 = sha256(entryPath);
    if (manifest.artifact?.sha256 !== artifactSha256) throw new Error('artifact sha256 mismatch');

    run('maw', ['plugin', 'install', './arra-1.0.0.tgz', '--local', '--pin'], pluginDir, home);
    const lockPath = join(home, '.maw', 'plugins.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Lock;
    const lockSha256 = lock.plugins?.arra?.sha256;
    if (lock.plugins?.arra?.version !== '1.0.0' || lockSha256 !== artifactSha256) {
      throw new Error('plugins.lock did not pin arra with the built artifact sha256');
    }
    return { workDir, pluginDir, entryPath, manifestPath, tgzPath, lockPath, artifactSha256, packageSha256: sha256(tgzPath), lockSha256 };
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(verifyMawPluginBuild({ root: option('--root'), keep: process.argv.includes('--keep') }), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
