import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPlugin } from './build.ts';

type SmokeOptions = { root?: string; workDir?: string; keep?: boolean };
type SmokeResult = {
  installDir: string;
  manifestName: string;
  entry: string;
  sha256: string;
  output: string;
};

type Handler = (ctx: { source?: string; args?: string[] }) => Promise<{ ok: boolean; output?: string; error?: string }>;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function extract(tgzPath: string, installDir: string): void {
  mkdirSync(installDir, { recursive: true });
  const tar = spawnSync('tar', ['-xzf', tgzPath, '-C', installDir], { encoding: 'utf8' });
  if (tar.status !== 0) throw new Error(tar.stderr || 'tar extract failed');
}

export async function smokeInstall(options: SmokeOptions = {}): Promise<SmokeResult> {
  const root = resolve(options.root ?? process.cwd());
  const workDir = resolve(options.workDir ?? mkdtempSync(join(tmpdir(), 'maw-plugin-arra-smoke-')));
  const outDir = join(workDir, 'dist');
  const installDir = join(workDir, 'installed', 'arra');

  try {
    const built = await buildPlugin({ root, outDir });
    extract(built.tgzPath, installDir);
    const manifest = JSON.parse(readFileSync(join(installDir, 'plugin.json'), 'utf8')) as {
      name: string;
      entry: string;
      artifact: { path: string; sha256: string };
    };
    const entryPath = join(installDir, manifest.artifact.path);
    const actualSha = hash(entryPath);
    if (actualSha !== manifest.artifact.sha256) throw new Error('installed entry sha256 mismatch');

    const mod = await import(`${pathToFileURL(entryPath).href}?${Date.now()}`) as { default: Handler };
    const result = await mod.default({ source: 'cli', args: ['help'] });
    if (!result.ok || !result.output?.includes('maw arra')) throw new Error(result.error || 'installed handler smoke failed');

    return { installDir, manifestName: manifest.name, entry: manifest.entry, sha256: actualSha, output: result.output };
  } finally {
    if (!options.keep) rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  smokeInstall({ root: option('--root'), workDir: option('--work-dir'), keep: process.argv.includes('--keep') })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
