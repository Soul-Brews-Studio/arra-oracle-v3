import { useState } from 'react';
import type { HubApi, HubNodeRow, InviteRow } from './api';
import { ago, maskIp, stateClass } from './format';
import { Badge, Card, danger, ErrorLine, ghost, input } from './ui';

interface Props { api: HubApi; nodes: HubNodeRow[]; invites: InviteRow[]; onChange: () => void; showIps: boolean }

export function NodesView({ api, nodes, invites, onChange, showIps }: Props) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ip = (v: string | null) => (showIps ? v ?? '-' : maskIp(v));

  async function revoke(id: string) {
    setBusy(true); setError(null);
    try { await api.revoke(id, why.trim() || 'revoked from the hub UI'); setRevoking(null); setWhy(''); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Card title={`Nodes (${nodes.length})`} right={<button className={ghost} onClick={onChange}>Refresh</button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-gray-500">
              <tr><th className="py-2 pr-4">node</th><th className="pr-4">state</th><th className="pr-4">expires</th><th className="pr-4">last seen</th><th className="pr-4">from</th><th className="pr-4">calls</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {nodes.length === 0 && <tr><td colSpan={7} className="py-4 text-gray-500">No node has joined yet. Make an invite.</td></tr>}
              {nodes.map((n) => (
                <tr key={n.id} data-node={n.id} className="align-top">
                  <td className="py-2 pr-4"><div className="text-gray-100">{n.label}</div><div className="font-mono text-xs text-gray-500">{n.id}</div></td>
                  <td className="pr-4 pt-2"><Badge className={stateClass(n.state)}>{n.state}</Badge></td>
                  <td className="pr-4 pt-2 font-mono text-xs text-gray-300">{n.state === 'revoked' ? `revoked ${ago(n.revokedAt)}` : n.expiresAt ? n.left : 'forever'}</td>
                  <td className="pr-4 pt-2 text-gray-300">{ago(n.lastSeenAt)}</td>
                  <td className="pr-4 pt-2 font-mono text-xs text-gray-400">{ip(n.lastIp)}</td>
                  <td className="pr-4 pt-2 font-mono text-gray-300">{n.calls}</td>
                  <td className="pt-1 text-right">
                    {n.state !== 'revoked' && revoking !== n.id && <button className={danger} onClick={() => { setRevoking(n.id); setError(null); }}>Revoke</button>}
                    {revoking === n.id && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <input className={`${input} w-48`} placeholder="why (RETIRED.md row)" value={why} onChange={(e) => setWhy(e.target.value)} />
                        <button className={danger} disabled={busy} onClick={() => revoke(n.id)}>Confirm revoke</button>
                        <button className={ghost} onClick={() => setRevoking(null)}>Cancel</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ErrorLine error={error} />
        <p className="mt-3 text-xs text-gray-500">Revoke stops the token at once and writes a RETIRED.md row in the hub vault. Nothing is deleted.</p>
      </Card>
      <Card title={`Invites (${invites.length})`}>
        <ul className="space-y-1 text-sm">
          {invites.length === 0 && <li className="text-gray-500">none</li>}
          {invites.slice().reverse().map((i) => (
            <li key={i.createdAt} className="flex flex-wrap gap-3 font-mono text-xs text-gray-300">
              <Badge className={i.state === 'open' ? stateClass('active') : i.state === 'used' ? 'bg-gray-500/15 text-gray-300 ring-gray-500/40' : stateClass('expired')}>{i.state}</Badge>
              <span>{i.label}</span><span className="text-gray-500">--for {i.grant}</span>
              <span className="text-gray-500">{i.usedBy ? `→ ${i.usedBy}` : `made ${ago(i.createdAt)}`}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
