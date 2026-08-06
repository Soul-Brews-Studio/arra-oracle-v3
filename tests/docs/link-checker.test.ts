import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

const repoRoot = process.cwd();
const markdownRoots = ['docs'];
const rootDocs = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'MORNING-TAPE.md'];
const urlSchemes = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

type LinkRef = { source: string; line: number; target: string };

function walkMarkdown(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return walkMarkdown(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

function markdownFiles(): string[] {
  return [
    ...markdownRoots.flatMap((dir) => walkMarkdown(dir)),
    ...rootDocs.filter((path) => existsSync(path)),
  ].sort();
}

function stripFencedCode(markdown: string): string[] {
  let fenced = false;
  return markdown.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return '';
    }
    return fenced ? '' : line;
  });
}

function cleanTarget(raw: string): string {
  return raw.trim().replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '');
}

function linksFrom(source: string): LinkRef[] {
  const refs: LinkRef[] = [];
  const lines = stripFencedCode(readFileSync(source, 'utf8'));
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    for (const match of line.matchAll(/!?\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const target = cleanTarget(match[1].split(/\s+(?=["'])/)[0]);
      if (target) refs.push({ source, line: lineNo, target });
    }
    const ref = line.match(/^\s*\[[^\]]+\]:\s+(\S+)/);
    if (ref) refs.push({ source, line: lineNo, target: cleanTarget(ref[1]) });
  });
  return refs;
}

function slugFor(heading: string): string {
  return heading.toLowerCase()
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function anchorsFor(markdownPath: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  for (const line of stripFencedCode(readFileSync(markdownPath, 'utf8'))) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) {
      const base = slugFor(heading);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      anchors.add(count ? `${base}-${count}` : base);
    }
    for (const match of line.matchAll(/<a\s+[^>]*name=["']([^"']+)["'][^>]*>/gi)) anchors.add(match[1]);
    for (const match of line.matchAll(/<a\s+[^>]*id=["']([^"']+)["'][^>]*>/gi)) anchors.add(match[1]);
  }
  return anchors;
}

function localTarget(ref: LinkRef): { path: string; fragment: string } | null {
  if (urlSchemes.test(ref.target)) return null;
  if (ref.target.startsWith('/')) return null;
  const [pathPart, fragment = ''] = ref.target.split('#');
  const withoutQuery = pathPart.split('?')[0];
  if (!withoutQuery && !fragment) return null;
  const decoded = decodeURIComponent(withoutQuery || ref.source);
  return { path: normalize(resolve(dirname(ref.source), decoded)), fragment: decodeURIComponent(fragment) };
}

function findFailures(): string[] {
  const failures: string[] = [];
  for (const ref of markdownFiles().flatMap(linksFrom)) {
    const target = localTarget(ref);
    if (!target) continue;
    const relative = target.path.startsWith(repoRoot) ? target.path.slice(repoRoot.length + 1) : target.path;
    if (!target.path.startsWith(repoRoot) || !existsSync(target.path)) {
      failures.push(`${ref.source}:${ref.line} -> ${ref.target} missing local target (${relative})`);
      continue;
    }
    if (target.fragment && target.path.endsWith('.md')) {
      const anchors = anchorsFor(target.path);
      if (!anchors.has(target.fragment)) failures.push(`${ref.source}:${ref.line} -> ${ref.target} missing anchor #${target.fragment}`);
    }
  }
  return failures;
}

describe('docs local link integrity', () => {
  test('all local markdown links point at existing files and anchors', () => {
    expect(findFailures()).toEqual([]);
  });
});
