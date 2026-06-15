export type AppRoute =
  | { kind: 'dashboard' }
  | { kind: 'tool-detail'; name: string }
  | { kind: 'vector-results'; query: string };

const toolPrefix = '/mcp-tools/';
const vectorPath = '/vector-search';

export function parseRouteHash(hash: string): AppRoute {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.startsWith(toolPrefix)) {
    const name = decodeURIComponent(raw.slice(toolPrefix.length));
    return name ? { kind: 'tool-detail', name } : { kind: 'dashboard' };
  }

  if (raw.startsWith(vectorPath)) {
    const queryText = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
    const query = new URLSearchParams(queryText).get('q')?.trim() ?? '';
    return { kind: 'vector-results', query };
  }

  return { kind: 'dashboard' };
}

export function routeHash(route: AppRoute): string {
  if (route.kind === 'tool-detail') return `#${toolPrefix}${encodeURIComponent(route.name)}`;
  if (route.kind === 'vector-results') {
    const qs = new URLSearchParams();
    if (route.query.trim()) qs.set('q', route.query.trim());
    return qs.toString() ? `#${vectorPath}?${qs}` : `#${vectorPath}`;
  }
  return '#/';
}
