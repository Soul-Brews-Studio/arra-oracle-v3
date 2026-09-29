import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type Entry = { source: string; relativePath: string; sha256: string; bytes: number };
type Roots = Record<string, string>;

function arg(name: string, args: string[]): string {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`${name} is required`);
  return args[index + 1];
}

function rootsFrom(args: string[]): Roots {
  const roots: Roots = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--root') continue;
    const pair = args[++index] ?? '';
    const split = pair.indexOf('=');
    if (split < 1) throw new Error('--root expects name=path');
    roots[pair.slice(0, split)] = pair.slice(split + 1);
  }
  return roots;
}

function inside(root: string, target: string): boolean {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return target === root || target.startsWith(prefix);
}

function safeSourceFile(rootInput: string, relativePath: string): string {
  if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) throw new Error(`unsafe corpus path: ${relativePath}`);
  const root = resolve(rootInput);
  if (lstatSync(root).isSymbolicLink()) throw new Error(`corpus root is a symlink: ${root}`);
  const lexical = resolve(root, relativePath);
  if (!inside(root, lexical)) throw new Error(`corpus path escapes root: ${relativePath}`);
  let current = root;
  for (const part of relativePath.split('/').filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`corpus path contains symlink: ${relativePath}`);
  }
  const realRoot = realpathSync(root);
  const realFile = realpathSync(lexical);
  if (!inside(realRoot, realFile) || !lstatSync(realFile).isFile()) throw new Error(`corpus file is outside or not regular: ${relativePath}`);
  return realFile;
}

function copyManifest(manifestPath: string, destination: string, roots: Roots): Entry[] {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { entries?: Entry[] };
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) throw new Error('corpus manifest has no entries');
  const copied: Entry[] = [];
  for (const entry of parsed.entries) {
    const root = roots[entry.source];
    if (!root) throw new Error(`corpus root is not configured: ${entry.source}`);
    const source = safeSourceFile(root, entry.relativePath);
    const bytes = readFileSync(source);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256 || bytes.byteLength !== entry.bytes) throw new Error(`corpus hash changed before backup: ${entry.source}|${entry.relativePath}`);
    const target = join(destination, entry.source, entry.relativePath);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { mode: 0o600 });
    copied.push({ ...entry });
  }
  writeFileSync(join(destination, 'snapshot-manifest.json'), `${JSON.stringify({ entries: copied }, null, 2)}\n`, { mode: 0o600 });
  return copied;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const manifest = arg('--manifest', args);
  const destination = arg('--dest', args);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const entries = copyManifest(manifest, destination, rootsFrom(args));
  console.log(`corpus snapshot verified: ${entries.length} files`);
}

export { copyManifest, safeSourceFile };
