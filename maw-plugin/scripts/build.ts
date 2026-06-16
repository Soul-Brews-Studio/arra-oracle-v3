import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Artifact = { path: string; sha256: string };
type Manifest = { name: string; version: string; entry: string; artifact?: Artifact; [key: string]: unknown };
type BuildOptions = { root?: string; outDir?: string };
type BuildResult = {
  outDir: string;
  manifestPath: string;
  lockPath: string;
  tgzPath: string;
  sha256: string;
  packageSha256: string;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readManifest(root: string): Manifest {
  const path = join(root, 'plugin.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Partial<Manifest>;
  if (!manifest.name || !manifest.version || !manifest.entry) {
    throw new Error('plugin.json must include name, version, and entry');
  }
  return manifest as Manifest;
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeLock(outDir: string, manifest: Manifest, tgzName: string, artifact: Artifact, packageSha256: string): string {
  const lock = {
    version: 1,
    plugins: {
      [manifest.name]: {
        version: manifest.version,
        package: tgzName,
        packageSha256,
        artifact,
        pinned: true,
      },
    },
  };
  const lockPath = join(outDir, 'plugins.lock');
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  return lockPath;
}

function pack(outDir: string, manifest: Manifest): string {
  const tgzName = `${manifest.name}-${manifest.version}.tgz`;
  const tgzPath = join(outDir, tgzName);
  const result = spawnSync('tar', ['-czf', tgzPath, '-C', outDir, 'index.js', 'plugin.json'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'tar failed');
  return tgzPath;
}

export async function buildPlugin(options: BuildOptions = {}): Promise<BuildResult> {
  const root = resolve(options.root ?? process.cwd());
  const outDir = resolve(options.outDir ?? join(root, 'dist'));
  const manifest = readManifest(root);
  const entry = resolve(root, manifest.entry);
  if (!existsSync(entry)) throw new Error(`entry file not found: ${entry}`);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const build = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: 'bun',
    format: 'esm',
    minify: true,
    naming: 'index.js',
  });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n') || 'Bun.build failed');

  const artifact = { path: './index.js', sha256: sha256(join(outDir, 'index.js')) };
  const distManifest = { ...manifest, entry: './index.js', artifact };
  const manifestPath = join(outDir, 'plugin.json');
  writeFileSync(manifestPath, `${JSON.stringify(distManifest, null, 2)}\n`);
  const tgzPath = pack(outDir, manifest);
  const packageSha256 = sha256(tgzPath);
  const lockPath = writeLock(outDir, manifest, tgzPath.split('/').at(-1)!, artifact, packageSha256);
  return { outDir, manifestPath, lockPath, tgzPath, sha256: artifact.sha256, packageSha256 };
}

if (import.meta.main) {
  buildPlugin({ root: arg('--root'), outDir: arg('--out') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
