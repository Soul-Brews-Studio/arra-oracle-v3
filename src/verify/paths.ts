import path from 'node:path';

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripDotPrefix(value: string): string {
  return value.replace(/^\.\/+/, '');
}

export function normalizeRelativeSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = path.posix.normalize(toPosix(trimmed));
  return stripDotPrefix(normalized);
}

export function normalizeSourceFile(value: string, repoRoot: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const repo = toPosix(path.resolve(repoRoot)).replace(/\/+$/, '');
  const resolved = toPosix(path.resolve(trimmed));
  if (path.isAbsolute(trimmed) && resolved.startsWith(`${repo}/`)) {
    return normalizeRelativeSource(resolved.slice(repo.length + 1));
  }

  return normalizeRelativeSource(trimmed);
}

export function relativeSourcePath(baseDir: string, fullPath: string): string | null {
  return normalizeRelativeSource(path.relative(baseDir, fullPath));
}
