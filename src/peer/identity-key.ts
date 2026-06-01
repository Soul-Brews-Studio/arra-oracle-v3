import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ORACLE_DATA_DIR } from '../config.ts';

const HEX_32_BYTES = /^[0-9a-f]{64}$/i;
const DEFAULT_KEY_PATH = join(ORACLE_DATA_DIR, 'peer-key.hex');
const cache = new Map<string, string>();

export function peerKeyPath(dataDir = ORACLE_DATA_DIR): string {
  return join(dataDir, 'peer-key.hex');
}

export function resetPubkeyCache(): void {
  cache.clear();
}

function validate(hex: string, source: string): string {
  const trimmed = hex.trim();
  if (!HEX_32_BYTES.test(trimmed)) {
    throw new Error(`${source} must contain a 64-char hex peer key`);
  }
  return trimmed.toLowerCase();
}

export function getPubkeyHex(keyPath = DEFAULT_KEY_PATH): string {
  const cached = cache.get(keyPath);
  if (cached) return cached;

  if (existsSync(keyPath)) {
    const existing = validate(readFileSync(keyPath, 'utf8'), keyPath);
    try { chmodSync(keyPath, 0o600); } catch { /* best-effort for non-POSIX filesystems */ }
    cache.set(keyPath, existing);
    return existing;
  }

  mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
  const generated = randomBytes(32).toString('hex');
  writeFileSync(keyPath, `${generated}\n`, { mode: 0o600 });
  try { chmodSync(keyPath, 0o600); } catch { /* best-effort for non-POSIX filesystems */ }
  cache.set(keyPath, generated);
  return generated;
}
