import { useState } from 'react';
import type { HubApi, NewInvite } from './api';
import { GRANTS, type Grant } from './format';
import { Card, ErrorLine, ghost, input, primary } from './ui';

export function InviteView({ api, onChange }: { api: HubApi; onChange: () => void }) {
  const [grant, setGrant] = useState<Grant>('1h');
  const [label, setLabel] = useState('');
  const [invite, setInvite] = useState<NewInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function make() {
    setBusy(true); setError(null);
    try { setInvite((await api.invite(grant, label.trim() || 'node')).invite); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const hubUrl = typeof location === 'undefined' ? 'http://<hub>:<port>' : `http://<this hub's tailnet name>:${location.port || 80}`;
  return (
    <div className="space-y-5">
      <Card title="Invite a node">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-sm text-text-muted">label
            <input className={`${input} mt-1 block w-56`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="node" />
          </label>
          <fieldset className="text-sm text-text-muted">
            <legend>the node lasts (--for)</legend>
            <div className="mt-1 flex gap-1">
              {GRANTS.map((g) => (
                <button key={g} type="button" aria-pressed={grant === g} onClick={() => setGrant(g)}
                  className={grant === g ? primary : ghost}>{g}</button>
              ))}
            </div>
          </fieldset>
          <button className={primary} disabled={busy} onClick={make}>{busy ? 'Making…' : 'Make invite code'}</button>
        </div>
        <ErrorLine error={error} />
        <p className="mt-3 text-xs text-text-muted">The code works once, for 10 minutes. The hub keeps only its sha256 hash.</p>
      </Card>
      {invite && (
        <Card title="Give this to the node">
          <div data-testid="invite-code" className="font-mono text-3xl tracking-widest text-ok-text">{invite.code}</div>
          <div className="mt-2 text-sm text-text-muted">label {invite.label} · node lasts {invite.grant} · code expires {new Date(invite.codeExpiresAt).toLocaleTimeString()}</div>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-field p-3 font-mono text-sm text-text">arra join {hubUrl} --code {invite.code}</pre>
          <button className={`${ghost} mt-3`} onClick={() => navigator.clipboard?.writeText(invite.code)}>Copy code</button>
        </Card>
      )}
    </div>
  );
}
