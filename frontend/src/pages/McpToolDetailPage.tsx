import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchMcpTools } from '../api';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { groupLabel, schemaText, toolMode } from '../components/toolView';
import type { McpTool } from '../types';

type PageState = 'loading' | 'ready' | 'error';
type ToolFetcher = () => Promise<{ tools: McpTool[] }>;

export function toolDetailSource(tool: McpTool): string {
  if (tool.source === 'plugin' || tool.plugin) return tool.plugin ? `plugin:${tool.plugin}` : 'plugin';
  return tool.source ?? 'core';
}

function DetailCard({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-slate-200">{value || '—'}</dd>
    </div>
  );
}

function ToolSummaryCard({ tool }: { tool: McpTool }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="tool-summary-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">MCP tool</p>
      <h2 id="tool-summary-title" className="mt-2 break-all text-2xl font-semibold text-white">{tool.name}</h2>
      <p className="mt-4 text-sm leading-6 text-slate-300">{tool.description || 'No description supplied.'}</p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <DetailCard label="Group" value={groupLabel(tool)} />
        <DetailCard label="Mode" value={toolMode(tool)} />
        <DetailCard label="Source" value={toolDetailSource(tool)} />
        <DetailCard label="Plugin" value={tool.plugin} />
      </dl>
    </section>
  );
}

function ToolSchemaCard({ tool }: { tool: McpTool }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="tool-schema-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Schema</p>
      <h2 id="tool-schema-title" className="mt-2 text-2xl font-semibold text-white">Input schema</h2>
      <p className="mt-2 text-sm text-slate-400">JSON schema advertised by /api/mcp/tools.</p>
      <pre className="mt-4 max-h-[36rem] overflow-auto rounded-xl bg-black/30 p-4 text-xs text-slate-300">{schemaText(tool)}</pre>
    </section>
  );
}

function StatusCard({ status, message, onRetry }: { status: 'ready' | 'loading' | 'error'; message?: string; onRetry?: () => void }) {
  if (status === 'loading') return <LoadingPanel title="Loading tool detail…" detail="Fetching /api/mcp/tools and matching by name." />;
  if (status === 'error') {
    return <ErrorMessage title="Could not load MCP tool details." message={message ?? 'Request failed.'} />;
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Tool not found">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Tool lookup</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">No tool found</h2>
      <p className="mt-2 text-sm text-slate-400">{message || 'No MCP tool matched this route parameter.'}</p>
      {onRetry ? (
        <button
          className="mt-4 inline-flex rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 transition hover:border-teal-300/40"
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
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="tool-detail-title">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Detail viewer</p>
            <h1 id="tool-detail-title" className="mt-2 text-3xl font-semibold text-white">MCP tool detail</h1>
            <p className="mt-2 text-sm text-slate-400">Inspect MCP tool metadata and input schema.</p>
          </div>
          <Link className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" to="/mcp">
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
