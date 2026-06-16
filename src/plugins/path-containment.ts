import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

function isContained(parent: string, child: string): boolean {
  const parentRoot = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(parentRoot);
}

function assertContained(pluginDir: string, entryPath: string): void {
  if (!isContained(pluginDir, entryPath)) throw new Error('plugin entry escapes plugin directory');
}

export function isContainedPluginPath(rootDir: string, candidatePath: string): boolean {
  try {
    return isContained(realpathSync(rootDir), realpathSync(candidatePath));
  } catch {
    return false;
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
