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

  if (pathname === '/vector/search') {
    const query = new URLSearchParams(search).get('q')?.trim();
    return base('Vector search preview', 'Vector', query ? `Preview semantic matches for “${query}”.` : 'Preview semantic matches by collection.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'Preview' },
    ]);
  }

  if (pathname === '/vector/documents') {
    return base('Vector documents', 'Vector', 'Browse indexed document content and metadata by collection.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'Documents' },
    ]);
  }

  if (pathname === '/vector/results') {
    const query = new URLSearchParams(search).get('q')?.trim();
    return base('Vector search results', 'Vector', query ? `Semantic matches for “${query}”.` : 'Full-page vector search results.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: query ? `Results: ${query}` : 'Results' },
    ]);
  }

  if (pathname === '/vector/export') {
    return base('Vector export', 'Vector', 'Download vector collections as JSON or CSV.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'Export' },
    ]);
  }

  if (pathname === '/plugins') return base('Plugin list', 'Plugins', 'Registered plugins and exposed runtime surfaces.', [{ label: 'Plugins' }]);
  if (pathname === '/metrics') return base('Metrics dashboard', 'Metrics', 'Runtime counters from /api/v1/metrics.', [{ label: 'Metrics' }]);
  if (pathname === '/search') return base('Menu search', 'Search', 'Full-text search over /api/menu rows.', [{ label: 'Search' }]);
  if (pathname === '/learn') return base('Learn entries', 'Learn', 'Capture and edit Oracle learnings.', [{ label: 'Learn' }]);
  if (pathname === '/vector') return base('Vector dashboard', 'Vector', 'Collection health, search, and export status.', [{ label: 'Vector dashboard' }]);
  if (pathname === '/mcp') return base('MCP tools', 'MCP', 'Browse available MCP tool schemas and groups.', [{ label: 'MCP tools' }]);
  if (pathname === '/settings') return base('Runtime settings', 'Settings', 'Storage, embedder, and migration status.', [{ label: 'Settings' }]);
  return base('Menu viewer', 'Menu', 'Navigation rows from /api/menu.', [{ label: 'Menu' }]);
}
