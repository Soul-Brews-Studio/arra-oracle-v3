import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import { ORACLE_DATA_DIR } from '../config.ts';

export function identityKeyPath() { return join(ORACLE_DATA_DIR, 'peer-key.hex'); }
export function getIdentityPubkey(path = identityKeyPath()): string {
  if (existsSync(path)) {
    const key = readFileSync(path, 'utf8').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error(`Invalid peer identity key at ${path}`);
    return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32).toString('hex');
  writeFileSync(path, `${key}\n`, { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch {}
  return key;
}
