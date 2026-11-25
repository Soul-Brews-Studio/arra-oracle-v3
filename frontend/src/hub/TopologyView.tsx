/**
 * Topology tab (#3110): the live shape of the hub, refreshed every 5 s.
 * Owner: vault, hub, every node box (click to revoke), strangers, Ossie exit.
 * Visitor: only the public hub card; the server answers 403 for the rest.
 */

import { useCallback, useEffect, useState } from 'react';
import type { HubApi, PublicHub } from './api';
import { ago, shortSha } from './format';
import { topologyApi as defaultTopologyApi, type Topology, type TopologyApi } from './topology-api';
import { TopologyCanvas } from './TopologyCanvas';
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
    <div className="flex items-center gap-3 text-xs text-gray-400">
      <span data-testid="updated">{owner ? (t ? `updated ${ago(t.at)}` : 'loading…') : 'public card'}</span>
      <label className="flex items-center gap-1"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> auto 5s</label>
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
        ) : <p className="text-sm text-gray-400">The hub card is not reachable from here.</p>}
        <p data-testid="visitor-note" className="mt-4 text-xs text-gray-500">
          You are viewing from another machine. Node boxes, refusals, the Ossie status and revoke are owner only.
        </p>
        <ErrorLine error={error} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Topology" right={toolbar}>
        {t ? <TopologyCanvas t={t} selected={picked} showIps={showIps} onPick={(id) => { setPicked(id === picked ? null : id); setError(null); }} />
          : <p className="text-sm text-gray-500">loading…</p>}
        <p className="mt-3 text-xs text-gray-500">{t?.privateNote} Ossie is an exit only: the vault stays the truth. Click a node box to revoke it.</p>
        <ErrorLine error={error} />
      </Card>
      {node && (
        <Card title={`Node ${node.label}`}>
          <div data-testid="node-panel" className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-mono text-xs text-gray-400">{node.id} · {node.state} · joined {ago(node.joinedAt)}</span>
            {node.state === 'revoked'
              ? <span className="text-rose-300">revoked {ago(node.revokedAt)}: {node.revokeReason}</span>
              : (
                <>
                  <input className={`${input} w-64`} placeholder="why (RETIRED.md row)" value={why} onChange={(e) => setWhy(e.target.value)} />
                  <button className={danger} disabled={busy} onClick={() => revoke(node.id)}>Revoke {node.label}</button>
                </>
              )}
          </div>
        </Card>
      )}
    </div>
  );
}
