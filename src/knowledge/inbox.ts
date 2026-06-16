import fs from 'node:fs';
import path from 'node:path';
import { relativeKnowledgePath } from './handoff.ts';

export type InboxFile = { filename: string; path: string; created: string; preview: string; type: string };

export function parsePageInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function createdFromFilename(file: string): string {
  const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
  return dateMatch ? `${dateMatch[1]}T${dateMatch[2].replace('-', ':')}:00` : 'unknown';
}

export function listHandoffFiles(handoffDir: string, repoRoot: string): InboxFile[] {
  if (!fs.existsSync(handoffDir)) return [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(handoffDir).filter((file) => file.endsWith('.md')).sort().reverse();
  } catch {
    return [];
  }

  const results: InboxFile[] = [];
  for (const file of files) {
    const filePath = path.join(handoffDir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    results.push({
      filename: file,
      path: relativeKnowledgePath(repoRoot, filePath),
      created: createdFromFilename(file),
      preview: content.substring(0, 500),
      type: 'handoff',
    });
  }
  return results;
}
