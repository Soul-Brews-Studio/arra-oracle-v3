import fs from 'node:fs';
import path from 'node:path';
import { slugifyTitle } from '../util/slug.ts';

/**
 * Sanitising a caller-supplied slug is what keeps `../../` out of the filename, so this
 * must stay a strip-and-rebuild, not a validation. It now strips by character class
 * rather than by alphabet, so a Thai handoff keeps its title — path separators, dots and
 * every other traversal character are outside \p{L}\p{N}\p{M} and still cannot survive.
 */
export function safeHandoffSlug(raw: unknown, content: string): string {
  const fallback = content.substring(0, 50);
  const source = typeof raw === 'string' && raw.trim() ? raw : fallback;
  return slugifyTitle(source, 80) || 'handoff';
}

export function containedHandoffFile(dirPath: string, filename: string): string {
  const root = path.resolve(dirPath);
  const filePath = path.resolve(root, filename);
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Invalid handoff path');
  return filePath;
}

export function handoffFilename(slug: string, now = new Date()): string {
  const dateStr = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  const timeStr = [String(now.getHours()).padStart(2, '0'), String(now.getMinutes()).padStart(2, '0')].join('-');
  return `${dateStr}_${timeStr}_${slug}.md`;
}

export function writeHandoffFile(dirPath: string, content: string, slug: string, now = new Date()): string {
  fs.mkdirSync(dirPath, { recursive: true });
  const base = handoffFilename(slug, now);
  for (let i = 0; i < 100; i += 1) {
    const suffix = i === 0 ? '' : `-${i}`;
    const filePath = containedHandoffFile(dirPath, base.replace(/\.md$/, `${suffix}.md`));
    try {
      fs.writeFileSync(filePath, content, { encoding: 'utf-8', flag: 'wx' });
      return filePath;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Unable to allocate unique handoff filename');
}

export function relativeKnowledgePath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}
