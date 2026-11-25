/**
 * arra hub pages (#3110): the Studio route /hub (one app, one dist), on `arra serve --hub`.
 * Status · Topology · Nodes · Search · Graph · Ontology · Invite. On the hub machine (loopback) everything works; from any
 * other machine /api/arra answers 403, so only the public hub card shows and the rest says
 * "owner only". Invite and revoke can never run from another machine: the server refuses.
 */

import { useCallback, useEffect, useState } from 'react';
import { hubApi as defaultApi, OwnerOnlyError, type ArraStatus, type HubApi, type HubNodeRow, type InviteRow, type PublicHub } from './api';
import { TABS, tabFromHash, type Tab } from './format';
import { GraphView } from './GraphView';
import { InviteView } from './InviteView';
import { OntologyView } from './OntologyView';
import { NodesView } from './NodesView';
import { SearchView } from './SearchView';
import { StatusView } from './StatusView';
import { TopologyView } from './TopologyView';
import { ErrorLine, OwnerOnly } from './ui';

const LABEL: Record<Tab, string> = { status: 'Status', topology: 'Topology', nodes: 'Nodes', search: 'Search', graph: 'Graph', ontology: 'Ontology', invite: 'Invite' };

export function HubApp({ api = defaultApi }: { api?: HubApi }) {
  const [tab, setTab] = useState<Tab>(() => (typeof location === 'undefined' ? 'status' : tabFromHash(location.hash)));
  const [owner, setOwner] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ArraStatus | null>(null);
  const [publicHub, setPublicHub] = useState<PublicHub | null>(null);
  const [nodes, setNodes] = useState<{ nodes: HubNodeRow[]; invites: InviteRow[] }>({ nodes: [], invites: [] });
  const [showIps, setShowIps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    api.publicHub().then(setPublicHub, () => setPublicHub(null));
    try {
      const s = await api.status();
      setStatus(s); setOwner(true);
      if (s.hub) setNodes(await api.nodes());
    } catch (e) {
      if (e instanceof OwnerOnlyError) { setOwner(false); setStatus(null); }
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onHash = () => setTab(tabFromHash(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  const hubName = status?.hub?.name ?? publicHub?.hub ?? null;
  return (
    <div className="grid min-w-0 gap-4">
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-2">
        <nav className="flex flex-wrap gap-1" aria-label="hub pages">
          {TABS.map((t) => (
            <a key={t} href={`#/${t}`} aria-current={tab === t ? 'page' : undefined}
              className={`focus-ring rounded-xl px-4 py-2 text-sm font-semibold transition ${tab === t ? 'border border-accent-border bg-accent-soft text-accent' : 'border border-transparent text-text-muted hover:text-text'}`}>{LABEL[t]}</a>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3 px-2 text-sm">
          <span className="font-semibold text-text">{hubName ? `hub:${hubName}` : 'not a hub'}</span>
          <span data-testid="viewer" className={`rounded-full border px-3 py-0.5 text-xs font-semibold ${owner ? 'status-ok' : 'status-warn'}`}>
            {owner === null ? 'checking…' : owner ? 'owner (this machine)' : 'visitor (read-only)'}
          </span>
          {owner && <label className="flex items-center gap-2 text-text-muted"><input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={showIps} onChange={(e) => setShowIps(e.target.checked)} /> show addresses</label>}
        </div>
      </div>
      <div className="grid min-w-0 gap-4">
        <ErrorLine error={error} />
        {tab === 'status' && <StatusView status={status} publicHub={publicHub} />}
        {tab === 'topology' && <TopologyView api={api} owner={owner} publicHub={publicHub} showIps={showIps} onChange={load} />}
        {tab !== 'status' && tab !== 'topology' && owner === false && <OwnerOnly what={LABEL[tab]} />}
        {tab === 'nodes' && owner && <NodesView api={api} nodes={nodes.nodes} invites={nodes.invites} onChange={load} showIps={showIps} />}
        {tab === 'search' && owner && <SearchView api={api} />}
        {tab === 'graph' && owner && <GraphView />}
        {tab === 'ontology' && owner && <OntologyView />}
        {tab === 'invite' && owner && <InviteView api={api} onChange={load} />}
      </div>
    </div>
  );
}
