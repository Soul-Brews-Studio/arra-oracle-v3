import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';
export type PinStatus = 'new' | 'pinned';
export class PeerPubkeyMismatch extends Error { constructor(public peer: string, public expected: string, public actual: string) { super(`Peer pubkey mismatch for ${peer}`); this.name = 'PeerPubkeyMismatch'; } }
function pinPath() { return process.env.ARRA_PEERS_TOFU_PATH || join(ORACLE_DATA_DIR, 'peers-tofu.json'); }
function readPins(path = pinPath()): Record<string,string> { if (!existsSync(path)) return {}; return JSON.parse(readFileSync(path, 'utf8')); }
function writePins(pins: Record<string,string>, path = pinPath()) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(pins, null, 2) + '\n', { mode: 0o600 }); try { chmodSync(path, 0o600); } catch {} }
export function pinPeerPubkey(peer: string, pubkey: string, path = pinPath()): PinStatus {
  if (!/^[0-9a-f]{64}$/i.test(pubkey)) throw new Error('Invalid peer pubkey');
  const pins = readPins(path); const key = pubkey.toLowerCase();
  if (!pins[peer]) { pins[peer] = key; writePins(pins, path); return 'new'; }
  if (pins[peer] !== key) throw new PeerPubkeyMismatch(peer, pins[peer], key);
  return 'pinned';
}
