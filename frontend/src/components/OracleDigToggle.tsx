import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, Spinner } from './AsyncState';
import { fetchJson } from '../pages/vectorSettingsHelpers';

export type OracleDigToggleResponse = {
  enabled?: boolean;
  mode?: 'mock' | 'live';
  findingCount?: number;
  evidenceCount?: number;
};

const TOGGLE_ENDPOINT = '/api/plugins/oracle-dig/toggle';
const mockStatus: Required<OracleDigToggleResponse> = {
  enabled: true,
  mode: 'mock',
  findingCount: 5,
  evidenceCount: 7,
};

function summary(status: OracleDigToggleResponse | null): string {
  if (!status) return 'Oracle Dig status has not loaded yet.';
  const findings = status.findingCount ?? mockStatus.findingCount;
  const evidence = status.evidenceCount ?? mockStatus.evidenceCount;
  return `${findings} mocked findings · ${evidence} typed evidence rows · ${status.mode ?? 'mock'} mode.`;
}

function fallbackMessage(nextEnabled: boolean, cause: unknown): string {
  const reason = cause instanceof Error ? cause.message : String(cause);
  return `Backend toggle endpoint is pending; locally mocked Oracle Dig ${nextEnabled ? 'enabled' : 'disabled'}. (${reason})`;
}

export function OracleDigToggle() {
  const [status, setStatus] = useState<OracleDigToggleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const enabled = status?.enabled !== false;
  const statusText = useMemo(() => summary(status), [status]);

  async function load() {
    setError('');
    setLoading(true);
    try {
      setStatus(mockStatus);
      setMessage('Oracle Dig is running from the local mock until the plugin endpoint ships.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggle(nextEnabled: boolean) {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetchJson<OracleDigToggleResponse>(TOGGLE_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      setStatus({ ...mockStatus, ...response, enabled: response.enabled ?? nextEnabled, mode: response.mode ?? 'live' });
      setMessage(`Oracle Dig ${nextEnabled ? 'enabled' : 'disabled'} through ${TOGGLE_ENDPOINT}.`);
    } catch (cause) {
      setStatus((current) => ({ ...mockStatus, ...current, enabled: nextEnabled, mode: 'mock' }));
      setMessage(fallbackMessage(nextEnabled, cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="oracle-dig-toggle-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Oracle Dig panel</p>
          <h2 id="oracle-dig-toggle-title" className="mt-2 text-2xl font-semibold text-text">Enable Oracle Dig</h2>
          <p className="mt-2 text-sm text-text-muted">Mock-first control for provenance finding capture. The future backend target is POST {TOGGLE_ENDPOINT}.</p>
          <p className="mt-2 text-xs text-text-muted">{loading ? 'Loading Oracle Dig switch…' : statusText}</p>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-border bg-surface-muted px-4 py-3 text-sm font-semibold text-text">
          <input checked={enabled} disabled={loading || saving} type="checkbox" onChange={(event) => void toggle(event.target.checked)} />
          {saving ? <Spinner label="Saving" /> : enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>
      {message ? <p className="mt-4 rounded-2xl border border-accent-border p-3 text-sm text-accent">{message}</p> : null}
      {error ? <div className="mt-4"><ErrorMessage title="Oracle Dig toggle failed." message={error} /></div> : null}
    </section>
  );
}
