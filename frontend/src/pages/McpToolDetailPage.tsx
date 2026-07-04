import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchMcpTools } from '../api';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { groupLabel, schemaText, toolMode } from '../components/toolView';
import { mcpToolsPath, pluginInventoryPath } from '../routePaths';
import type { McpTool } from '../types';

type PageState = 'loading' | 'ready' | 'error';
type ToolFetcher = () => Promise<{ tools: McpTool[] }>;

export function toolDetailSource(tool: McpTool): string {
  if (tool.source === 'plugin' || tool.plugin) return tool.plugin ? `plugin:${tool.plugin}` : 'plugin';
  return tool.source ?? 'core';
}

export function toolPluginInventoryPath(tool: McpTool): string | null {
  return tool.plugin ? pluginInventoryPath({ q: tool.plugin, surface: 'mcp' }) : null;
}

export function toolBrowserReturnPath(tool?: McpTool | null): string {
  if (!tool) return '/mcp';
  if (tool.source === 'plugin' || tool.plugin) return mcpToolsPath({ q: tool.plugin ?? tool.name, source: 'plugin' });
  return mcpToolsPath({ q: tool.name, source: 'core' });
}

function DetailCard({ label, value, href }: { label: string; value?: string; href?: string | null }) {
  return (
    <div className="glass rounded-xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-3">
      <dt className="text-xs uppercase tracking-[0.18em] text-text-muted">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-text">
        {href && value ? <a className="focus-ring text-accent hover:text-accent" href={href}>{value}</a> : value || '—'}
      </dd>
    </div>
  );
}

function ToolSummaryCard({ tool }: { tool: McpTool }) {
  return (
    <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="tool-summary-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">MCP tool</p>
      <h2 id="tool-summary-title" className="mt-2 break-all text-2xl font-semibold text-text">{tool.name}</h2>
      <p className="mt-4 text-sm leading-6 text-text-muted">{tool.description || 'No description supplied.'}</p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <DetailCard label="Group" value={groupLabel(tool)} />
        <DetailCard label="Mode" value={toolMode(tool)} />
        <DetailCard label="Source" value={toolDetailSource(tool)} />
        <DetailCard label="Plugin" value={tool.plugin} href={toolPluginInventoryPath(tool)} />
      </dl>
    </section>
  );
}

function ToolSchemaCard({ tool }: { tool: McpTool }) {
  return (
    <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="tool-schema-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Schema</p>
      <h2 id="tool-schema-title" className="mt-2 text-2xl font-semibold text-text">Input schema</h2>
      <p className="mt-2 text-sm text-text-muted">JSON schema advertised by /api/mcp/tools.</p>
      <pre className="glass mt-4 max-h-[36rem] overflow-auto rounded-xl bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4 text-xs text-text-muted">{schemaText(tool)}</pre>
    </section>
  );
}

function StatusCard({ status, message, onRetry }: { status: 'ready' | 'loading' | 'error'; message?: string; onRetry?: () => void }) {
  if (status === 'loading') return <LoadingPanel title="Loading tool detail…" detail="Fetching /api/mcp/tools and matching by name." />;
  if (status === 'error') {
    return <ErrorMessage title="Could not load MCP tool details." message={message ?? 'Request failed.'} />;
  }

  return (
    <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-label="Tool not found">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Tool lookup</p>
      <h2 className="mt-2 text-2xl font-semibold text-text">No tool found</h2>
      <p className="mt-2 text-sm text-text-muted">{message || 'No MCP tool matched this route parameter.'}</p>
      {onRetry ? (
        <button
          className="mt-4 inline-flex rounded-xl border border-border px-3 py-2 text-sm text-text transition-all duration-200 hover:border-[oklch(1_0_0/0.12)]"
          type="button"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </section>
  );
}

function routeName(value?: string): string {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function McpToolDetailPage({
  initialTools,
  fetcher = fetchMcpTools,
}: {
  initialTools?: McpTool[];
  fetcher?: ToolFetcher;
} = {}) {
  const toolName = routeName(useParams().name);
  const [tools, setTools] = useState<McpTool[]>(initialTools ?? []);
  const [state, setState] = useState<PageState>(initialTools ? 'ready' : 'loading');
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialTools) return;
    let active = true;
    setState('loading');
    setError('');
    fetcher()
      .then((response) => {
        if (!active) return;
        setTools(response.tools);
        setState('ready');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [fetcher, initialTools, toolName]);

  const tool = useMemo(() => tools.find((entry) => entry.name === toolName), [toolName, tools]);
  const refresh = () => {
    fetcher()
      .then((response) => setTools(response.tools))
      .catch(() => undefined);
  };

  return (
    <div className="grid gap-5">
      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="tool-detail-title">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Detail viewer</p>
            <h1 id="tool-detail-title" className="mt-2 text-3xl font-semibold text-text">MCP tool detail</h1>
            <p className="mt-2 text-sm text-text-muted">Inspect MCP tool metadata and input schema.</p>
          </div>
          <Link className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" to={toolBrowserReturnPath(tool)}>
            Back to MCP tools
          </Link>
        </div>
      </section>

      {state === 'error' ? <StatusCard status={state} message={error} onRetry={refresh} /> : null}
      {state === 'loading' ? <StatusCard status="loading" /> : null}
      {state === 'ready' && !tool ? <StatusCard status="ready" message={`No MCP tool named "${toolName}".`} /> : null}
      {state === 'ready' && tool ? (
        <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <ToolSummaryCard tool={tool} />
          <ToolSchemaCard tool={tool} />
        </div>
      ) : null}
    </div>
  );
}
