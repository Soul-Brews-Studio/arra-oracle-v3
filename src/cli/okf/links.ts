import path from 'node:path';

export interface LinkTarget {
  relPath: string;
}

export function rewriteWikilinks(body: string, targets: LinkTarget[]): string {
  const resolver = new WikilinkResolver(targets.map((target) => target.relPath));
  return body.replace(/\[\[([^\]\n]+)\]\]/g, (full, inner: string) => {
    const [rawTarget, rawLabel] = inner.split('|');
    const target = rawTarget?.trim() ?? '';
    const relPath = resolver.resolve(target);
    if (!relPath) return full;
    const label = (rawLabel?.trim() || target.split(/[\\/#]/).pop() || target).replace(/\]/g, '\\]');
    return `[${label}](/${relPath})`;
  });
}

class WikilinkResolver {
  private readonly noExtPaths: string[];
  private readonly exact = new Map<string, string | null>();

  constructor(private readonly relPaths: string[]) {
    this.noExtPaths = relPaths.map((rel) => stripMd(rel));
    for (const rel of relPaths) {
      this.add(stripMd(rel), rel);
      this.add(path.posix.basename(rel, '.md'), rel);
    }
  }

  resolve(rawTarget: string): string | null {
    const normalized = normalizeTarget(rawTarget);
    if (!normalized) return null;
    const direct = this.exact.get(normalized);
    if (direct !== undefined) return direct;

    const matches = this.noExtPaths
      .map((noExt, index) => ({ noExt, rel: this.relPaths[index]! }))
      .filter(({ noExt }) => noExt === normalized || noExt.endsWith(`/${normalized}`));
    return matches.length === 1 ? matches[0]!.rel : null;
  }

  private add(key: string, rel: string): void {
    if (!key) return;
    if (this.exact.has(key) && this.exact.get(key) !== rel) this.exact.set(key, null);
    else this.exact.set(key, rel);
  }
}

function normalizeTarget(target: string): string {
  const withoutHeading = target.split('#')[0] ?? '';
  return stripMd(withoutHeading.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').trim());
}

function stripMd(value: string): string {
  return value.endsWith('.md') ? value.slice(0, -3) : value;
}
