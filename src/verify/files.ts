import fs from 'node:fs';
import path from 'node:path';
import { relativeSourcePath } from './paths.ts';

export interface FileInfo {
  relativePath: string;
  mtimeMs: number;
}

export function walkMarkdownFiles(dir: string, baseDir: string): FileInfo[] {
  const files: FileInfo[] = [];
  if (!fs.existsSync(dir)) return files;

  let items: string[] = [];
  try {
    items = fs.readdirSync(dir);
  } catch {
    return files;
  }

  for (const item of items) {
    const fullPath = path.join(dir, item);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath, baseDir));
    } else if (stat.isFile() && item.endsWith('.md')) {
      const relativePath = relativeSourcePath(baseDir, fullPath);
      if (relativePath) files.push({ relativePath, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}
