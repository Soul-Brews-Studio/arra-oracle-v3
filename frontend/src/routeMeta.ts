export type Breadcrumb = {
  label: string;
  to?: string;
};

export type RouteMeta = {
  title: string;
  eyebrow: string;
  description: string;
  breadcrumbs: Breadcrumb[];
};

function decodeLabel(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function base(title: string, eyebrow: string, description: string, breadcrumbs: Breadcrumb[]): RouteMeta {
  return { title, eyebrow, description, breadcrumbs: [{ label: 'Control surface', to: '/menu' }, ...breadcrumbs] };
}

export function routeMeta(pathname: string, search = ''): RouteMeta {
  if (pathname.startsWith('/mcp/tools/')) {
    const name = decodeLabel(pathname.replace('/mcp/tools/', '')) || 'Tool detail';
    return base('MCP tool detail', 'MCP', `Inspect schema and metadata for ${name}.`, [
      { label: 'MCP tools', to: '/mcp' },
      { label: name },
    ]);
  }

  if (pathname === '/vector/results') {
    const query = new URLSearchParams(search).get('q')?.trim();
    return base('Vector search results', 'Vector', query ? `Semantic matches for “${query}”.` : 'Full-page vector search results.', [
      { label: 'Vector search', to: '/vector' },
      { label: query ? `Results: ${query}` : 'Results' },
    ]);
  }

  if (pathname === '/plugins') return base('Plugin list', 'Plugins', 'Registered plugins and exposed runtime surfaces.', [{ label: 'Plugins' }]);
  if (pathname === '/search') return base('Menu search', 'Search', 'Full-text search over /api/menu rows.', [{ label: 'Search' }]);
  if (pathname === '/vector') return base('Vector search', 'Vector', 'Semantic search against Oracle memory.', [{ label: 'Vector search' }]);
  if (pathname === '/mcp') return base('MCP tools', 'MCP', 'Browse available MCP tool schemas and groups.', [{ label: 'MCP tools' }]);
  if (pathname === '/settings') return base('Runtime settings', 'Settings', 'Storage, embedder, and migration status.', [{ label: 'Settings' }]);
  return base('Menu viewer', 'Menu', 'Navigation rows from /api/menu.', [{ label: 'Menu' }]);
}
