import fs from 'fs';
import path from 'path';

export function safeClose(watchers: Array<{ close: () => void }>): void {
  for (const watcher of watchers) {
    try { watcher.close(); } catch {}
  }
}

export function safeClearTimeout(id: ReturnType<typeof setTimeout> | undefined): void {
  if (id !== undefined) clearTimeout(id);
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function listDirs(root: string): string[] {
  const dirs = [root];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    dirs.push(...listDirs(path.join(root, entry.name)));
  }
  return dirs;
}

export function listFiles(root: string, include: (filePath: string) => boolean): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, include));
    else if (entry.isFile() && include(fullPath)) files.push(fullPath);
  }
  return files;
}

export function watchDir(dir: string, onFileEvent: (filePath: string) => void): fs.FSWatcher | null {
  try {
    return fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (filename) onFileEvent(path.join(dir, filename));
    });
  } catch {
    return null;
  }
}
