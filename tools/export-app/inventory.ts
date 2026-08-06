import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ExportFileInventoryEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export async function exportFileInventory(
  rootDir: string,
  options: { exclude?: Iterable<string> } = {},
): Promise<ExportFileInventoryEntry[]> {
  const root = path.resolve(rootDir);
  const exclude = new Set(options.exclude ?? []);
  const entries: ExportFileInventoryEntry[] = [];

  await walk(root, '');
  return entries.sort((a, b) => a.path.localeCompare(b.path));

  async function walk(dir: string, relativeDir: string): Promise<void> {
    const names = await readdir(dir);
    for (const name of names) {
      const relativePath = slash(relativeDir ? path.join(relativeDir, name) : name);
      if (exclude.has(relativePath)) continue;

      const fullPath = path.join(dir, name);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (info.isFile()) {
        entries.push({ path: relativePath, bytes: info.size, sha256: await sha256File(fullPath) });
      }
    }
  }
}

async function sha256File(file: string): Promise<string> {
  const bytes = await readFile(file);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function slash(value: string): string {
  return value.split(path.sep).join('/');
}
