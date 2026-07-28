import { loadNamedPeers, type NamedPeers } from './peer-registry.ts';
import { PeerPubkeyMismatch, pinPeerPubkey, type PinStatus } from './peer-tofu.ts';

export interface PeerStatus {
  name: string;
  url: string;
  ok: boolean;
  node?: string;
  oracle?: string;
  pubkey?: string;
  pinStatus?: PinStatus;
  capabilities?: string[];
  error?: string;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function probePeer(name: string, url: string): Promise<PeerStatus> {
  const base = url.replace(/\/+$/, '');
  try {
    const info = await fetchJson(`${base}/info`);
    if (info?.maw?.schema !== '1') throw new Error('missing maw schema 1');
    const identity = await fetchJson(`${base}/api/identity`);
    if (!identity?.node || !/^[0-9a-f]{64}$/i.test(identity?.pubkey ?? '')) throw new Error('invalid identity');
    const pubkey = String(identity.pubkey).toLowerCase();
    return {
      name,
      url: base,
      ok: true,
      node: String(identity.node),
      oracle: typeof identity.oracle === 'string' ? identity.oracle : info.oracle,
      pubkey,
      pinStatus: pinPeerPubkey(name, pubkey),
      capabilities: Array.isArray(info?.maw?.capabilities) ? info.maw.capabilities : [],
    };
  } catch (error) {
    if (error instanceof PeerPubkeyMismatch) return { name, url: base, ok: false, error: 'MISMATCH', pubkey: error.actual };
    return { name, url: base, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function listPeerStatuses(peers: NamedPeers = loadNamedPeers()): Promise<PeerStatus[]> {
  return Promise.all(Object.entries(peers).map(([name, url]) => probePeer(name, url)));
}
