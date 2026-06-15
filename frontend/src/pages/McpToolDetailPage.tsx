import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchMcpTools } from '../api';
import { groupLabel, schemaText, toolMode } from '../components/toolView';
import type { McpTool } from '../types';

type PageState = 'loading' | 'ready' | 'error';

function DetailRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <dt className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm text-slate-200">{value || '—'}</dd>
    </div>
  );
}

function ToolDetail({ tool }: { tool: McpTool }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">MCP tool</p>
        <h2 className="mt-2 break-all font-mono text-2xl font-semibold text-white">{tool.name}</h2>
        <p className="mt-4 text-sm leading-6 text-slate-300">{tool.description || 'No description supplied.'}</p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <DetailRow label="Group" value={groupLabel(tool)} />
          <DetailRow label="Mode" value={toolMode(tool)} />
          <DetailRow label="Source" value={tool.source ?? 'core'} />
          <DetailRow label="Plugin" value={tool.plugin} />
        </dl>
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-950/60 p-5">
        <h3 className="text-lg font-semibold text-white">Input schema</h3>
        <p className="mt-1 text-sm text-slate-500">JSON schema advertised by /api/mcp/tools.</p>
        <pre className="mt-4 max-h-[36rem] overflow-auto rounded-xl bg-black/30 p-4 text-xs text-slate-300">{schemaText(tool)}</pre>
      </section>
    </div>
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

export function McpToolDetailPage() {
  const toolName = routeName(useParams().name);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setState('loading');
    setError('');
    fetchMcpTools()
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
  }, [toolName]);

  const tool = useMemo(() => tools.find((entry) => entry.name === toolName), [toolName, tools]);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="tool-detail-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Detail viewer</p>
          <h1 id="tool-detail-title" className="mt-2 text-3xl font-semibold text-white">MCP tool detail</h1>
        </div>
        <Link className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" to="/mcp">
          Back to MCP tools
        </Link>
      </div>
      {state === 'loading' ? <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">Loading tool detail…</p> : null}
      {state === 'error' ? <p className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-100">{error}</p> : null}
      {state === 'ready' && tool ? <ToolDetail tool={tool} /> : null}
      {state === 'ready' && !tool ? <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-400">No MCP tool named {toolName}.</p> : null}
    </section>
  );
}
