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

  if (pathname === '/vector/first-run') {
    return base('First-run setup', 'Vector', 'Use the local backend default, review cost, and start the first vector index.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'First-run setup' },
    ]);
  }

  if (pathname === '/vector/index') {
    return base('Index Manager', 'Vector', 'Track vector backfill jobs and reindex collections.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'Index Manager' },
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
    return base('Vector export', 'Vector', 'Download vector collections in available formats.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'Export' },
    ]);
  }

  if (pathname === '/vector/settings') {
    return base('Vector settings', 'Vector', 'Manage vector collection config and index jobs.', [
      { label: 'Vector dashboard', to: '/vector' },
      { label: 'Settings' },
    ]);
  }

  if (pathname === '/memory') {
    const query = new URLSearchParams(search).get('q')?.trim();
    const description = query
      ? `Provenance, confidence, heat, valid-time, and recency signals for “${query}”.`
      : 'Provenance, confidence, heat, valid-time, and recency across Studio memory.';
    return base('Memory dashboard', 'Memory', description, [{ label: 'Memory dashboard' }]);
  }

  if (pathname === '/plugins') return base('Plugin list', 'Plugins', 'Registered plugins and exposed runtime surfaces.', [{ label: 'Plugins' }]);
  if (pathname === '/status') return base('Server status', 'Status', 'Server health from /api/v1/health.', [{ label: 'Status' }]);
  if (pathname === '/canvas') return base('Canvas app', 'Canvas', 'Studio alias for canvas.buildwithoracle.com.', [{ label: 'Canvas app' }]);
  if (pathname === '/canvas/plugins') return base('Canvas plugins', 'Canvas', 'Canvas plugin registry and standalone status.', [{ label: 'Canvas plugins' }]);
  if (pathname === '/metrics') return base('Runtime metrics', 'Metrics', 'Runtime counters from /api/v1/metrics.', [{ label: 'Metrics' }]);
  if (pathname === '/search') return base('Search', 'Search', 'Search menu, plugin, and MCP tool surfaces.', [{ label: 'Search' }]);
  if (pathname === '/export') return base('Export app', 'Export', 'Connect to an old Oracle v2 backend and download JSON, CSV, or Markdown backups.', [{ label: 'Export app' }]);
  if (pathname === '/feed') return base('Document feed', 'Feed', 'DB-backed document feed from /api/list, independent of vector collections.', [{ label: 'Feed' }]);
  if (pathname === '/learn') return base('Learn entries', 'Learn', 'Capture and edit Oracle learnings.', [{ label: 'Learn' }]);
  if (pathname === '/vector') return base('Vector dashboard', 'Vector', 'Collection health, search, and export status.', [{ label: 'Vector dashboard' }]);
  if (pathname === '/mcp') return base('MCP tools', 'MCP', 'Browse available MCP tool schemas and groups.', [{ label: 'MCP tools' }]);
  if (pathname === '/storage') return base('Storage backend', 'Storage', 'Backend config viewer from /api/settings/system.', [{ label: 'Storage' }]);
  if (pathname === '/settings') return base('Runtime settings', 'Settings', 'Storage, embedder, and DB status.', [{ label: 'Settings' }]);
  return base('Menu viewer', 'Menu', 'Navigation rows from /api/menu.', [{ label: 'Menu' }]);
}
