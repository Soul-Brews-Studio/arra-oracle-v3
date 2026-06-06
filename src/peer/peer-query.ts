import { loadNamedPeers, type NamedPeers } from './peer-registry.ts';
import { pinPeerPubkey, PeerPubkeyMismatch, type PinStatus } from './peer-tofu.ts';
export interface PeerStatus { name: string; url: string; ok: boolean; node?: string; oracle?: string; pubkey?: string; pinStatus?: PinStatus; capabilities?: string[]; error?: string; }
function headers(token?: string) { return token ? { authorization: `Bearer ${token}` } : undefined; }
async function getJson(url: string, token?: string): Promise<any> { const res = await fetch(url, { headers: headers(token) }); if (!res.ok) throw new Error(`${res.status} ${res.statusText}`); return res.json(); }
export async function probePeer(name: string, url: string, opts: { token?: string } = {}): Promise<PeerStatus> {
  const base = url.replace(/\/+$/, '');
  try {
    const info = await getJson(`${base}/info`, opts.token);
    if (info?.maw?.schema !== '1') throw new Error('missing maw schema 1');
    const ident = await getJson(`${base}/api/identity`, opts.token);
    if (!ident?.node || !/^[0-9a-f]{64}$/i.test(ident?.pubkey ?? '')) throw new Error('invalid identity');
    const pinStatus = pinPeerPubkey(name, ident.pubkey);
    return { name, url: base, ok: true, node: ident.node, oracle: ident.oracle ?? info.oracle, pubkey: ident.pubkey.toLowerCase(), pinStatus, capabilities: info.maw.capabilities ?? [] };
  } catch (error) {
    if (error instanceof PeerPubkeyMismatch) return { name, url: base, ok: false, error: 'MISMATCH', pubkey: error.actual };
    return { name, url: base, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
export async function listPeerStatuses(peers: NamedPeers = loadNamedPeers(), opts: { token?: string } = {}) { return Promise.all(Object.entries(peers).map(([name, url]) => probePeer(name, url, opts))); }
export function formatPeerStatuses(statuses: PeerStatus[]) { return statuses.map(s => s.ok ? `${s.name}\tOK\t${s.node}\t${s.pinStatus}\t${s.url}` : `${s.name}\tFAIL\t${s.error}\t${s.url}`).join('\n'); }
