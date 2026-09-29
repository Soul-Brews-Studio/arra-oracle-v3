import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { normalizeUnifiedPluginManifest, type NormalizedUnifiedPluginManifest } from './unified-manifest.ts';
import { defaultUnifiedPluginDirs } from './plugin-dirs.ts';
import { isContainedPluginPath, resolveContainedPluginEntry } from './path-containment.ts';
import type { LoadedUnifiedPlugin, UnifiedLoaderOptions } from './unified-loader.ts';

function warn(options: UnifiedLoaderOptions, message: string): void {
  options.warn?.(`[unified-plugin] ${message}`);
}

function assertStrictEntryPath(dir: string, manifestEntry: string, resolvedEntry: string): void {
  // Check the lexical path before realpath resolution. Otherwise an in-root
  // symlink can resolve to a regular file and evade a post-resolution lstat.
  const lexical = resolve(dir, manifestEntry);
  const parts = relative(resolve(dir), lexical).split('/').filter(Boolean);
  let current = resolve(dir);
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`strict plugin policy rejects symlink entry: ${current}`);
    }
  }
  if (!existsSync(resolvedEntry) || lstatSync(resolvedEntry).isSymbolicLink()) {
    throw new Error(`strict plugin policy rejects missing or symlink entry: ${resolvedEntry}`);
  }
}

async function readPluginDir(dir: string, options: UnifiedLoaderOptions): Promise<LoadedUnifiedPlugin | null> {
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  try {
    if (options.strict && lstatSync(manifestPath).isSymbolicLink()) throw new Error(`strict plugin policy rejects symlink manifest: ${manifestPath}`);
    const raw = await Bun.file(manifestPath).json();
    const manifest: NormalizedUnifiedPluginManifest = normalizeUnifiedPluginManifest(raw);
    if (manifest.enabled === false) return null;
    const entryPath = resolveContainedPluginEntry(dir, manifest.entry);
    if (options.strict) assertStrictEntryPath(dir, manifest.entry, entryPath);
    return { manifest, dir, entryPath };
  } catch (error) {
    if (options.strict) throw error;
    warn(options, `skipped ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function discoverUnifiedPluginManifests(options: UnifiedLoaderOptions = {}): Promise<LoadedUnifiedPlugin[]> {
  const found: LoadedUnifiedPlugin[] = [];
  const seen = new Set<string>();
  const strict = options.strict;
  const dirs = options.dirs ?? (strict ? [strict.root] : defaultUnifiedPluginDirs());
  if (strict && (dirs.length !== 1 || resolve(dirs[0]) !== resolve(strict.root))) {
    throw new Error(`strict plugin policy requires exactly root ${strict.root}`);
  }
  for (const baseDir of dirs) {
    if (!existsSync(baseDir)) {
      if (strict) throw new Error(`strict plugin root missing: ${baseDir}`);
      continue;
    }
    if (strict && (!lstatSync(baseDir).isDirectory() || lstatSync(baseDir).isSymbolicLink())) {
      throw new Error(`strict plugin root must be a real directory: ${baseDir}`);
    }
    let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
    try { entries = readdirSync(baseDir, { withFileTypes: true }); }
    catch (error) { warn(options, `skipped ${baseDir}: ${error instanceof Error ? error.message : String(error)}`); continue; }
    for (const entry of entries) {
      const entryPath = join(baseDir, entry.name);
      if (entry.isSymbolicLink()) {
        if (strict) throw new Error(`strict plugin policy rejects symlink: ${entryPath}`);
        if (!isContainedPluginPath(baseDir, entryPath)) warn(options, `skipped ${entryPath}: plugin directory symlink escapes plugin root`);
        continue;
      }
      if (!entry.isDirectory()) continue;
      if (!isContainedPluginPath(baseDir, entryPath)) {
        if (strict) throw new Error(`plugin directory escapes plugin root: ${entryPath}`);
        warn(options, `skipped ${entryPath}: plugin directory symlink escapes plugin root`); continue;
      }
      const loaded = await readPluginDir(entryPath, options);
      if (!loaded) continue;
      if (seen.has(loaded.manifest.name)) {
        if (strict) throw new Error(`strict plugin policy rejects duplicate plugin name: ${loaded.manifest.name}`);
        warn(options, `skipped duplicate plugin name: ${loaded.manifest.name}`);
        continue;
      }
      seen.add(loaded.manifest.name); found.push(loaded);
    }
  }
  if (strict) {
    const actual = new Set(found.map((plugin) => plugin.manifest.name));
    const expected = new Set(strict.requiredNames);
    const missing = strict.requiredNames.filter((name) => !actual.has(name));
    const unexpected = [...actual].filter((name) => !expected.has(name));
    if (missing.length || unexpected.length) throw new Error(`strict plugin policy required plugin set mismatch (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`);
  }
  return found;
}
