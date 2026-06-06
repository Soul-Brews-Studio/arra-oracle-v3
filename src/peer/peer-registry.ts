import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ORACLE_DATA_DIR } from '../config.ts';

export type NamedPeers = Record<string, string>;

function normalize(raw: unknown): NamedPeers {
  const source = raw && typeof raw === 'object' && 'namedPeers' in raw
    ? (raw as { namedPeers?: unknown }).namedPeers
    : raw;
  if (!source || typeof source !== 'object') return {};
  const peers: NamedPeers = {};
  for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const url = value.trim().replace(/\/+$/, '');
    if (/^https?:\/\//.test(url)) peers[name] = url;
  }
  return peers;
}

export function loadNamedPeers(configPath = process.env.ARRA_PEERS_CONFIG || join(ORACLE_DATA_DIR, 'peers.json')): NamedPeers {
  const envPeers = process.env.ARRA_NAMED_PEERS?.trim();
  if (envPeers) return normalize(JSON.parse(envPeers));
  if (!existsSync(configPath)) return {};
  return normalize(JSON.parse(readFileSync(configPath, 'utf8')));
}
