import { useEffect, useMemo, useState } from 'react';
import { fetchMcpTools } from '../api';
import { mcpToolsPath, pluginInventoryPath } from '../routePaths';
import { ErrorMessage, LoadingPanel, Spinner } from './AsyncState';
import { groupLabel, toolMode } from './toolView';
import type { McpTool } from '../types';

export type McpToolSourceFilter = 'all' | 'plugin' | 'core';
export type McpToolFilterDefaults = { query: string; source: McpToolSourceFilter };

const sourceFilters: McpToolSourceFilter[] = ['all', 'plugin', 'core'];

type McpToolsResponse = {
  tools: McpTool[];
  total: number;
};

function browserSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

function isSourceFilter(value: string | null): value is McpToolSourceFilter {
  return sourceFilters.includes(value as McpToolSourceFilter);
}

export function mcpToolFiltersFromSearch(search = ''): McpToolFilterDefaults {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const source = params.get('source');
  return {
    query: params.get('q') ?? params.get('query') ?? '',
    source: isSourceFilter(source) ? source : 'all',
  };
}

function sourceKind(tool: McpTool): Exclude<McpToolSourceFilter, 'all'> {
  return tool.source === 'plugin' || Boolean(tool.plugin) ? 'plugin' : 'core';
}

export function mcpToolSourceLabel(tool: McpTool): string {
  if (sourceKind(tool) === 'plugin') return tool.plugin ? `plugin:${tool.plugin}` : 'plugin';
  return 'core';
}

export function mcpToolPluginInventoryPath(tool: McpTool): string | null {
  return sourceKind(tool) === 'plugin' ? pluginInventoryPath({ q: tool.plugin, surface: 'mcp' }) : null;
}

export function mcpToolSourceCounts(tools: McpTool[]): Record<'plugin' | 'core', number> {
  return tools.reduce((counts, tool) => {
    counts[sourceKind(tool)] += 1;
    return counts;
  }, { plugin: 0, core: 0 });
}

export function filterMcpTools(tools: McpTool[], query: string, source: McpToolSourceFilter): McpTool[] {
  const q = query.trim().toLowerCase();
  return tools.filter((tool) => {
    if (source !== 'all' && sourceKind(tool) !== source) return false;
    const text = [
      tool.name,
      tool.description,
      groupLabel(tool),
      toolMode(tool),
      mcpToolSourceLabel(tool),
    ].join(' ').toLowerCase();
    return !q || text.includes(q);
  });
}

function SourceBadge({ tool }: { tool: McpTool }) {
  const label = mcpToolSourceLabel(tool);
  const href = mcpToolPluginInventoryPath(tool);
  const className = 'rounded-full border border-accent-border px-2 py-1 text-xs text-accent';
  return href ? <a className={`focus-ring ${className}`} href={href}>{label}</a> : <span className={className}>{label}</span>;
}

function ToolCard({ tool, onOpen }: { tool: McpTool; onOpen?: (tool: McpTool) => void }) {
  return (
    <article className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-mono text-sm text-accent">{tool.name}</h3>
        <span className="rounded-full bg-white/5 px-2 py-1 text-xs text-text-muted">{groupLabel(tool)}</span>
        <span className="rounded-full border border-accent2-border px-2 py-1 text-xs text-accent2">{toolMode(tool)}</span>
        <SourceBadge tool={tool} />
      </div>
      <p className="mt-3 text-sm leading-6 text-text-muted">{tool.description || 'No description supplied.'}</p>
      {onOpen ? (
        <button
          aria-label={`Open schema detail for ${tool.name}`}
          className="focus-ring mt-4 rounded-xl border border-border px-3 py-2 text-sm text-text hover:border-teal-300/40"
          type="button"
          onClick={() => onOpen(tool)}
        >
          Open schema detail
        </button>
      ) : null}
    </article>
  );
}

export function McpToolBrowser({
  onOpenTool,
  initialTools,
  initialFilter,
  initialSource,
  initialSearch,
  fetcher = fetchMcpTools,
}: {
  onOpenTool?: (tool: McpTool) => void;
  initialTools?: McpTool[];
  initialFilter?: string;
  initialSource?: McpToolSourceFilter;
  initialSearch?: string;
  fetcher?: () => Promise<McpToolsResponse>;
}) {
  const filterDefaults = mcpToolFiltersFromSearch(initialSearch ?? browserSearch());
  const [tools, setTools] = useState<McpTool[]>(initialTools ?? []);
  const [filter, setFilter] = useState(initialFilter ?? filterDefaults.query);
  const [source, setSource] = useState<McpToolSourceFilter>(initialSource ?? filterDefaults.source);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(initialTools ? 'ready' : 'loading');
  const [error, setError] = useState('');

  async function load() {
    setState('loading');
    setError('');
    try {
      const response = await fetcher();
      setTools(response.tools);
      setState('ready');
    } catch (err) {
      setTools([]);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    if (!initialTools) void load();
  }, []);

  const visible = useMemo(() => filterMcpTools(tools, filter, source), [filter, source, tools]);

  const groups = useMemo(() => new Set(tools.map(groupLabel)).size, [tools]);
  const sourceCounts = useMemo(() => mcpToolSourceCounts(tools), [tools]);
  const loading = state === 'loading';

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="mcp-tools-title">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">MCP</p>
          <h2 id="mcp-tools-title" className="mt-2 text-2xl font-semibold text-text">Tool browser</h2>
          <p className="mt-2 text-sm text-text-muted">Live tool schemas from /api/mcp/tools.</p>
        </div>
        <button
          aria-label="Reload MCP tool list"
          className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-teal-300/40 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          type="button"
          onClick={() => void load()}
        >
          {loading ? <Spinner label="Reloading" /> : 'Reload'}
        </button>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_12rem_auto] lg:items-center">
        <input
          aria-label="Filter MCP tools"
          className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-sm text-text placeholder:text-slate-600"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tools, groups, descriptions…"
          type="search"
        />
        <select
          aria-label="Filter MCP tool source"
          className="focus-ring rounded-xl border border-border bg-field px-3 py-3 text-sm text-text"
          value={source}
          onChange={(event) => setSource(event.currentTarget.value as McpToolSourceFilter)}
        >
          <option value="all">All sources</option>
          <option value="plugin">Plugin tools</option>
          <option value="core">Core tools</option>
        </select>
        <p className="text-sm text-text-muted">
          {loading ? <Spinner label="Loading tools" /> : `${visible.length}/${tools.length} tools · ${groups} groups · ${sourceCounts.plugin} plugin · ${sourceCounts.core} core`}
        </p>
      </div>
      <div className="mb-4 flex justify-end">
        <a className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:border-accent-border" href={mcpToolsPath({ q: filter, source })}>
          Share tool view
        </a>
      </div>

      {loading ? <LoadingPanel title="Loading MCP tools…" detail="Fetching /api/mcp/tools." /> : null}
      {state === 'error' ? (
        <ErrorMessage
          title="Could not load MCP tools."
          message={error}
          action={<button aria-label="Retry loading MCP tools" className="focus-ring rounded-lg border border-err-border px-3 py-2 font-semibold text-err-text hover:bg-err-bg" type="button" onClick={() => void load()}>Retry</button>}
        />
      ) : null}
      {state === 'ready' && !visible.length ? <p className="rounded-xl border border-dashed border-border p-6 text-sm text-text-muted">No MCP tools matched.</p> : null}
      <div className="grid gap-3 lg:grid-cols-2" aria-busy={loading}>
        {!loading ? visible.map((tool) => <ToolCard key={`${tool.source ?? 'core'}:${tool.name}`} tool={tool} onOpen={onOpenTool} />) : null}
      </div>
    </section>
  );
}
