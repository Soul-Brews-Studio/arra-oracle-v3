import type { ArraStatus, PublicHub } from './api';
import { maskUrl, shortSha } from './format';
import { Card, Stat } from './ui';

export function StatusView({ status, publicHub }: { status: ArraStatus | null; publicHub: PublicHub | null }) {
  if (!status) {
    return (
      <Card title="Hub (public card)">
        {publicHub ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="hub" value={publicHub.hub} />
            <Stat label="active nodes" value={publicHub.nodes} />
            <Stat label="vault commit" value={shortSha(publicHub.sha)} />
          </div>
        ) : <p className="text-sm text-text-muted">This server is not a hub, or the hub card is not reachable from here.</p>}
        <p className="mt-4 text-xs text-text-muted">You are viewing from another machine: nodes, search, invite and revoke are owner only.</p>
      </Card>
    );
  }
  const sources = Object.entries(status.docs.bySource).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="hub" value={status.hub?.name ?? '-'} hint={status.hub ? 'serving /api/federation' : 'not a hub'} />
        <Stat label="active nodes" value={status.hub?.nodes ?? 0} />
        <Stat label="open invites" value={status.hub?.invitesOpen ?? 0} hint="codes last 10 minutes" />
        <Stat label="documents" value={status.docs.total} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Documents by source">
          <ul className="space-y-2 font-mono text-sm">
            {sources.length === 0 && <li className="text-text-muted">no documents yet</li>}
            {sources.map(([source, n]) => (
              <li key={source} className="flex justify-between gap-4">
                <span className={source === 'self' ? 'text-accent' : 'text-accent2'}>{source}</span>
                <span className="text-text">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Vaults">
          <ul className="space-y-2 text-sm">
            {status.vaults.length === 0 && <li className="text-text-muted">no vault</li>}
            {status.vaults.map((v) => (
              <li key={v.name} className="flex justify-between gap-4 font-mono">
                <span className="text-text">{v.name}</span>
                <span className="text-text-muted">{shortSha(v.sha)}{v.dirty ? ' · dirty' : ''}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
            embedder {status.embedder.provider}{status.embedder.model ? ` · ${status.embedder.model}` : ''} · snapshots {status.snapshots.length}
          </div>
        </Card>
      </div>
      {status.hubs.length > 0 && (
        <Card title="Hubs this machine joined">
          <ul className="space-y-1 font-mono text-sm text-text">
            {status.hubs.map((h) => <li key={h.name}>hub:{h.name} · {maskUrl(h.url)} · last sync {h.lastSyncAt ?? 'never'}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
