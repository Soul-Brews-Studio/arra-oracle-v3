export function normalizeMenuPath(value: string): string {
  const trimmed = value.trim().replaceAll('\\', '/');
  if (!trimmed) return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/^\/+/, '/').replace(/\/+$/, '') || '/';
}

export function normalizeMenuPathList(values: unknown[]): string[] {
  const paths = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const path = normalizeMenuPath(value);
    if (path) paths.add(path);
  }
  return [...paths];
}
