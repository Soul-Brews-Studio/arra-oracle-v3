import { homedir } from 'node:os';
import { dirname, join, parse } from 'node:path';

function uniqueDirs(dirs: string[]): string[] {
  return [...new Set(dirs.filter(Boolean))];
}

function cwdMawPluginDirs(cwd = process.cwd()): string[] {
  const dirs: string[] = [];
  let current = cwd;
  const root = parse(current).root;
  while (true) {
    dirs.push(join(current, '.maw', 'plugins'));
    if (current === root) return dirs;
    current = dirname(current);
  }
}

export function defaultUnifiedPluginDirs(extra: string[] = []): string[] {
  return uniqueDirs([
    ...cwdMawPluginDirs(),
    process.env.MAW_PLUGINS_DIR ?? '',
    join(homedir(), '.maw', 'plugins'),
    join(homedir(), '.arra', 'plugins'),
    join(homedir(), '.oracle', 'plugins'),
    ...extra,
  ]);
}

