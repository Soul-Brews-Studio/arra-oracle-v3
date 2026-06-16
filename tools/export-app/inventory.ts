import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ExportInventoryFile {
  path: string;
  size: number;
}

export interface ExportInventory {
  version: 1;
  generatedAt: string;
  fileCount: number;
  files: ExportInventoryFile[];
}

export async function writeExportInventory(
  outputDir: string,
  now: () => Date = () => new Date(),
): Promise<ExportInventory> {
  const files = await listFiles(outputDir);
  const inventory = {
    version: 1 as const,
    generatedAt: now().toISOString(),
    fileCount: files.length,
    files,
  };
  await writeFile(path.join(outputDir, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  return inventory;
}

async function listFiles(root: string, dir = root): Promise<ExportInventoryFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(root, fullPath);
    if (!entry.isFile() || path.relative(root, fullPath) === 'inventory.json') return [];
    const info = await stat(fullPath);
    return [{ path: slash(path.relative(root, fullPath)), size: info.size }];
  }));
  return files.flat().sort((a, b) => a.path.localeCompare(b.path));
}

function slash(value: string): string {
  return value.split(path.sep).join('/');
}
