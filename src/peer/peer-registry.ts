import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';
export type NamedPeers = Record<string, string>;
function normalize(v: unknown): NamedPeers {
  const source = (v && typeof v === 'object' && 'namedPeers' in (v as any)) ? (v as any).namedPeers : v;
  if (!source || typeof source !== 'object') return {};
  const out: NamedPeers = {};
  for (const [k, val] of Object.entries(source as Record<string, unknown>)) {
    if (typeof val === 'string' && /^https?:\/\//.test(val)) out[k] = val.replace(/\/+$/, '');
  }
  return out;
}
export function loadNamedPeers(configPath = process.env.ARRA_PEERS_CONFIG || join(ORACLE_DATA_DIR, 'peers.json')): NamedPeers {
  if (process.env.ARRA_NAMED_PEERS?.trim()) return normalize(JSON.parse(process.env.ARRA_NAMED_PEERS));
  if (existsSync(configPath)) return normalize(JSON.parse(readFileSync(configPath, 'utf8')));
  return {};
}
