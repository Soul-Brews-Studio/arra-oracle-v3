import { useCallback, useEffect, useState } from 'react';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import {
  groupState,
  loadToolConfig,
  saveEnabledTools,
  toggleGroup,
  toggleTool,
  type ToolConfigResponse,
} from './toolsConfigHelpers';

const STATE_LABEL = { all: 'All on', some: 'Partial', none: 'All off' } as const;

function SourceBanner({ config }: { config: ToolConfigResponse }) {
  return (
    <div className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Config source</p>
      <p className="mt-2 break-all text-sm text-text">{config.config_path || 'not resolved'}</p>
      <p className="mt-2 text-xs text-text-muted">
        {config.config_exists
          ? 'This file exists and is the one a save writes to.'
          : 'No file yet — saving creates it.'}{' '}
        Lookup is first-match-wins, so a repo-root <code>arra.config.json</code> shadows the global
        one entirely.
      </p>
      {config.env_override ? (
        <p className="mt-4 rounded-2xl border border-accent-border p-3 text-sm text-accent">
          <strong>Environment override active.</strong> ORACLE_ENABLED_TOOLS or
          ORACLE_DISABLED_TOOLS is set, and environment beats the file — saving here will not change
          the tools actually served until you unset it.
        </p>
      ) : null}
    </div>
  );
}

function AlwaysOn({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">
        On by default
      </p>
      <p className="mt-2 text-sm text-text-muted">
        These belong to no group, so group switches do not reach them. They are still disableable
        individually.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {tools.map((name) => (
          <span
            key={name}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm font-semibold text-text"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function GroupCard({
  config,
  group,
  busy,
  onToggleGroup,
  onToggleTool,
}: {
  config: ToolConfigResponse;
  group: string;
  busy: boolean;
  onToggleGroup: (group: string) => void;
  onToggleTool: (name: string) => void;
}) {
  const entry = config.groups.find((g) => g.group === group);
  if (!entry) return null;
  const state = groupState(config, group);

  return (
    <div className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">{group}</p>
          <p className="mt-2 text-sm text-text-muted">
            {entry.tools.length} tool{entry.tools.length === 1 ? '' : 's'} · {STATE_LABEL[state]}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onToggleGroup(group)}
          className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text"
        >
          {state === 'none' ? `Enable ${group}` : `Disable ${group}`}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {entry.tools.map((tool) => (
          <button
            key={tool.name}
            type="button"
            disabled={busy}
            aria-pressed={tool.enabled}
            onClick={() => onToggleTool(tool.name)}
            className={
              tool.enabled
                ? 'focus-ring flex items-center gap-3 rounded-2xl border border-accent-border bg-surface-muted px-4 py-3 text-sm font-semibold text-accent'
                : 'focus-ring flex items-center gap-3 rounded-2xl border border-border bg-field px-4 py-3 text-sm text-text-muted'
            }
          >
            {tool.enabled ? '●' : '○'} {tool.name}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ToolsConfigPage() {
  const [config, setConfig] = useState<ToolConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      setConfig(await loadToolConfig());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(async (enabled: string[]) => {
    setError('');
    setSaved('');
    setBusy(true);
    try {
      const next = await saveEnabledTools(enabled);
      setConfig(next);
      setSaved(`Saved — ${next.enabled_tools.length} tools enabled.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const retry = (
    <button
      type="button"
      onClick={() => void refresh()}
      className="focus-ring rounded-xl border border-border bg-field px-3 py-2 text-sm text-text"
    >
      Retry
    </button>
  );

  if (loading) return <LoadingPanel title="Loading tool configuration" />;
  if (error && !config) {
    return <ErrorMessage title="Could not load tool configuration" message={error} action={retry} />;
  }
  if (!config) return null;

  return (
    <div className="grid gap-4">
      {/* No page title here — AppShell renders it from routeMeta ('/tools/config').
          Repeating it would duplicate the heading and put a second <h1> on the page. */}
      <p className="text-sm text-text-muted">
        {config.enabled_tools.length} of{' '}
        {config.enabled_tools.length + config.disabled_tools.length} tools are served. Changes take
        effect without a restart — the config file is watched.
      </p>

      {error ? <ErrorMessage title="Save failed" message={error} action={retry} /> : null}
      {saved ? (
        <p className="rounded-2xl border border-accent-border p-3 text-sm text-accent">{saved}</p>
      ) : null}

      <SourceBanner config={config} />

      {config.groups.map((entry) => (
        <GroupCard
          key={entry.group}
          config={config}
          group={entry.group}
          busy={busy}
          onToggleGroup={(group) => void submit(toggleGroup(config, group))}
          onToggleTool={(name) => void submit(toggleTool(config, name))}
        />
      ))}

      <AlwaysOn tools={config.always_on_tools} />
    </div>
  );
}
