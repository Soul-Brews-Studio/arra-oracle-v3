import { afterEach, describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getPubkeyHex, peerKeyPath, resetPubkeyCache } from '../../peer/identity-key.ts';
import { peerInfoRoute } from '../../routes/peer/info.ts';
import { createPeerIdentityRoute } from '../../routes/peer/identity.ts';

const tmpDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-peer-identity-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  resetPubkeyCache();
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('maw peer handshake identity', () => {
  it('serves /info as JSON from its own path', async () => {
    const app = new Elysia().use(peerInfoRoute);
    const response = await app.handle(new Request('http://localhost/info'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.maw.schema).toBe('1');
    expect(payload.maw.capabilities).toContain('arra-search');
    expect(payload.node).toMatch(/^arra@.+/);
    expect(payload.oracle).toBe('arra');
  });

  it('creates and reuses a persisted 0600 peer pubkey', () => {
    const dir = makeTempDir();
    const keyFile = peerKeyPath(dir);

    const first = getPubkeyHex(keyFile);
    const second = getPubkeyHex(keyFile);
    const mode = fs.statSync(keyFile).mode & 0o777;

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(mode).toBe(0o600);
  });

  it('serves /api/identity with pubkey, node, and oracle fields', async () => {
    const dir = makeTempDir();
    const keyFile = peerKeyPath(dir);
    const app = new Elysia().use(createPeerIdentityRoute(keyFile));

    const response = await app.handle(new Request('http://localhost/api/identity'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.node).toMatch(/^arra@.+/);
    expect(payload.oracle).toBe('arra');
    expect(fs.existsSync(keyFile)).toBe(true);
  });
});
