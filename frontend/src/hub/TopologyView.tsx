/**
 * Topology tab (#3110): the live shape of the hub, refreshed every 5 s.
 * Owner: vault, hub, every node box (click to revoke), strangers, Ossie exit.
 * Visitor: only the public hub card; the server answers 403 for the rest.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HubApi, PublicHub } from './api';
import { ago, maskIp, shortSha } from './format';
import { topologyApi as defaultTopologyApi, type Topology, type TopologyApi } from './topology-api';
import { TopologyCanvas } from './TopologyCanvas';
import { TopologyLegend } from './TopologyLegend';
import { statusLine } from './topology-words';
import { Card, danger, ErrorLine, ghost, input, Stat } from './ui';

export const REFRESH_MS = 5000;

interface Props {
  api: HubApi; owner: boolean | null; publicHub: PublicHub | null; showIps: boolean;
  topoApi?: TopologyApi; initial?: Topology | null; auto?: boolean; onChange?: () => void;
}

export function TopologyView({ api, owner, publicHub, showIps, topoApi = defaultTopologyApi, initial = null, auto = true, onChange }: Props) {
  const [t, setT] = useState<Topology | null>(initial);
  const [pub, setPub] = useState<PublicHub | null>(publicHub);
  const [live, setLive] = useState(auto);
  const [picked, setPicked] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (owner) setT(await topoApi.topology());
      else setPub(await api.publicHub());
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [api, owner, topoApi]);

  useEffect(() => { if (owner !== null && !initial) void load(); }, [load, owner, initial]);
  useEffect(() => {
    if (!live || owner === null) return;
    const id = setInterval(() => { void load(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [live, load, owner]);

  const node = t?.nodes.find((n) => n.id === picked) ?? null;
  async function revoke(id: string) {
    setBusy(true); setError(null);
    try { await api.revoke(id, why.trim() || 'revoked from the hub Topology view'); setWhy(''); await load(); onChange?.(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
      <span data-testid="updated">{owner ? (t ? `updated ${ago(t.at)}` : 'loading…') : 'public card'}</span>
      <label className="flex items-center gap-2 py-2"><input type="checkbox" className="h-4 w-4" checked={live} onChange={(e) => setLive(e.target.checked)} /> refresh every 5s</label>
      <button className={ghost} onClick={() => void load()}>Refresh</button>
    </div>
  );

  if (owner === false) {
    return (
      <Card title="Topology (public card)" right={toolbar}>
        {pub ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="hub" value={`hub:${pub.hub}`} />
            <Stat label="vault commit" value={shortSha(pub.sha)} />
            <Stat label="active nodes" value={pub.nodes} />
          </div>
        ) : <p className="text-sm text-text-muted">The hub card is not reachable from here.</p>}
        <p data-testid="visitor-note" className="mt-4 text-xs text-text-muted">
          You are on another machine, so you see the public card only. Machine details, refusals, the Ossie status and revoke are shown on the hub machine itself.
        </p>
        <ErrorLine error={error} />
      </Card>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <Card title="Topology" right={toolbar}>
        {t ? <div className="overflow-x-auto"><div className="min-w-[880px]"><TopologyCanvas t={t} selected={picked} onPick={(id) => { setPicked(id === picked ? null : id); setError(null); }} /></div></div>
          : <p className="text-sm text-text-muted">loading…</p>}
        <TopologyLegend />
        <ErrorLine error={error} />
      </Card>
      {node && (
        <Card title={`Node ${node.label}`}>
          <div data-testid="node-panel" className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-text md:grid-cols-4">
              {[
                ['status', statusLine(node)],
                ['last seen', ago(node.lastSeenAt)],
                ['calls', String(node.calls)],
                ['turned away', node.refused.count ? `${node.refused.count} (HTTP 403)` : 'never'],
                ['joined', ago(node.joinedAt)],
                ['address', showIps ? node.lastIp ?? '-' : maskIp(node.lastIp)],
                ['node id', node.id],
              ].map(([k, v]) => <div key={k}><dt className="text-xs text-text-muted">{k}</dt><dd className="break-all font-mono">{v}</dd></div>)}
            </dl>
            {node.state === 'revoked'
              ? <p className="text-err-text">Revoked {ago(node.revokedAt)}: {node.revokeReason}</p>
              : (
                <div className="flex flex-wrap items-center gap-3">
                  <input className={`${input} w-72 py-2`} placeholder="why (goes into RETIRED.md)" value={why} onChange={(e) => setWhy(e.target.value)} />
                  <button className={`${danger} px-4 py-2`} disabled={busy} onClick={() => revoke(node.id)}>Revoke {node.label}</button>
                </div>
              )}
          </div>
        </Card>
      )}
    </div>
  );
}
