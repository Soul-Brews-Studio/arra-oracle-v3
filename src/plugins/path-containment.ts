import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

function assertContained(pluginDir: string, entryPath: string): void {
  const pluginRoot = pluginDir.endsWith(sep) ? pluginDir : `${pluginDir}${sep}`;
  if (entryPath !== pluginDir && !entryPath.startsWith(pluginRoot)) {
    throw new Error('plugin entry escapes plugin directory');
  }
}

export function resolveContainedPluginEntry(pluginDir: string, entry: string): string {
  const root = realpathSync(pluginDir);
  const resolved = resolve(root, entry);
  assertContained(root, resolved);
  if (!existsSync(resolved)) return resolved;
  const realEntry = realpathSync(resolved);
  assertContained(root, realEntry);
  return realEntry;
}
