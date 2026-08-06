import fs from 'node:fs';
import path from 'node:path';
import type { OkfDocument } from './mapper.ts';

export function generateIndexes(outDir: string, docs: OkfDocument[]): void {
  const dirs = collectDirs(docs);
  for (const dir of [...dirs].sort()) writeIndex(outDir, dir, dirs, docs);
  writeLog(outDir, docs);
}

function collectDirs(docs: OkfDocument[]): Set<string> {
  const dirs = new Set<string>(['']);
  for (const doc of docs) {
    let dir = path.posix.dirname(doc.relPath);
    if (dir === '.') dir = '';
    while (true) {
      dirs.add(dir);
      if (!dir) break;
      const parent = path.posix.dirname(dir);
      dir = parent === '.' ? '' : parent;
    }
  }
  return dirs;
}

function writeIndex(outDir: string, dir: string, dirs: Set<string>, docs: OkfDocument[]): void {
  const childDirs = directChildDirs(dir, dirs);
  const childDocs = docs.filter((doc) => dirname(doc.relPath) === dir).sort(byTitle);
  const lines: string[] = [];
  if (!dir) lines.push('---', 'okf_version: "0.1"', '---', '');
  lines.push(`# ${dir ? titleize(path.posix.basename(dir)) : 'Contents'}`);

  if (childDirs.length > 0) {
    lines.push('', '## Subdirectories');
    for (const child of childDirs) {
      const summary = summarizeDir(child, docs);
      lines.push(`* [${titleize(path.posix.basename(child))}](${relativeLink(dir, `${child}/index.md`)}) - ${summary}`);
    }
  }

  if (childDocs.length > 0) {
    lines.push('', '## Documents');
    for (const doc of childDocs) {
      lines.push(`* [${doc.title}](${relativeLink(dir, doc.relPath)}) - ${doc.description}`);
    }
  }

  const target = path.join(outDir, dir, 'index.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
}

function writeLog(outDir: string, docs: OkfDocument[]): void {
  const groups = new Map<string, OkfDocument[]>();
  for (const doc of docs) {
    const day = doc.timestamp.slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), doc]);
  }
  const lines = ['# Bundle Update Log'];
  for (const day of [...groups.keys()].sort().reverse()) {
    lines.push('', `## ${day}`);
    for (const doc of (groups.get(day) ?? []).sort(byTitle)) {
      lines.push(`* **Export**: [${doc.title}](/${doc.relPath}) - ${doc.description}`);
    }
  }
  fs.writeFileSync(path.join(outDir, 'log.md'), `${lines.join('\n')}\n`, 'utf8');
}

function directChildDirs(parent: string, dirs: Set<string>): string[] {
  return [...dirs].filter((dir) => dir && dirname(dir) === parent).sort();
}

function summarizeDir(dir: string, docs: OkfDocument[]): string {
  const children = docs.filter((doc) => doc.relPath.startsWith(`${dir}/`));
  return children[0]?.description ?? `${children.length} document${children.length === 1 ? '' : 's'}`;
}

function relativeLink(fromDir: string, target: string): string {
  return path.posix.relative(fromDir || '.', target) || path.posix.basename(target);
}

function dirname(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === '.' ? '' : dir;
}

function titleize(value: string): string {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function byTitle(a: OkfDocument, b: OkfDocument): number {
  return a.title.localeCompare(b.title) || a.relPath.localeCompare(b.relPath);
}
