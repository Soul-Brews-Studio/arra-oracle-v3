import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface ExportFileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export async function buildFileManifest(
  rootDir: string,
  exclude = new Set(['manifest.json']),
): Promise<ExportFileEntry[]> {
  const files: ExportFileEntry[] = [];
  await collectFiles(rootDir, '', exclude, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collectFiles(
  rootDir: string,
  relativeDir: string,
  exclude: Set<string>,
  files: ExportFileEntry[],
): Promise<void> {
  const dir = path.join(rootDir, relativeDir);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relativePath = slash(path.join(relativeDir, entry.name));
    if (exclude.has(relativePath)) continue;
    const fullPath = path.join(rootDir, relativePath);
    if (entry.isDirectory()) {
      await collectFiles(rootDir, relativePath, exclude, files);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      files.push({
        path: relativePath,
        bytes: content.byteLength,
        sha256: createHash('sha256').update(content).digest('hex'),
      });
    }
  }
}

function slash(value: string): string {
  return value.split(path.sep).join('/');
}
