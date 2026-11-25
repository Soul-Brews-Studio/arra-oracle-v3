/**
 * arra hub web UI (#3110): served at /hub by `arra serve --hub`.
 * Status · Nodes · Search · Invite. On the hub machine (loopback) everything works; from any
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
import { ErrorLine, OwnerOnly } from './ui';

const LABEL: Record<Tab, string> = { status: 'Status', nodes: 'Nodes', search: 'Search', graph: 'Graph', ontology: 'Ontology', invite: 'Invite' };

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
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900/60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">arra hub</div>
            <h1 className="text-xl font-semibold">{hubName ? `hub:${hubName}` : 'not a hub'}</h1>
          </div>
          <nav className="flex gap-1" aria-label="hub pages">
            {TABS.map((t) => (
              <a key={t} href={`#/${t}`} aria-current={tab === t ? 'page' : undefined}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{LABEL[t]}</a>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-xs">
            <span data-testid="viewer" className={`rounded-full px-2 py-0.5 ring-1 ${owner ? 'text-emerald-300 ring-emerald-500/40' : 'text-amber-300 ring-amber-500/40'}`}>
              {owner === null ? 'checking…' : owner ? 'owner (this machine)' : 'visitor (read-only)'}
            </span>
            {owner && <label className="flex items-center gap-1 text-gray-400"><input type="checkbox" checked={showIps} onChange={(e) => setShowIps(e.target.checked)} /> show addresses</label>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">
        <ErrorLine error={error} />
        {tab === 'status' && <StatusView status={status} publicHub={publicHub} />}
        {tab !== 'status' && owner === false && <OwnerOnly what={LABEL[tab]} />}
        {tab === 'nodes' && owner && <NodesView api={api} nodes={nodes.nodes} invites={nodes.invites} onChange={load} showIps={showIps} />}
        {tab === 'search' && owner && <SearchView api={api} />}
        {tab === 'graph' && owner && <GraphView />}
        {tab === 'ontology' && owner && <OntologyView />}
        {tab === 'invite' && owner && <InviteView api={api} onChange={load} />}
      </main>
    </div>
  );
}
