import { Elysia } from 'elysia';
import { hostname } from 'node:os';

import { getPubkeyHex } from '../../peer/identity-key.ts';
import pkg from '../../../package.json' with { type: 'json' };

function peerHost(): string {
  return process.env.ORACLE_HOST?.trim() || hostname();
}

function peerNode(host = peerHost()): string {
  return process.env.ORACLE_NODE?.trim() || `arra@${host}`;
}

export function createPeerIdentityRoute(keyPath?: string) {
  return new Elysia().get('/api/identity', () => {
    const host = peerHost();
    return {
      pubkey: getPubkeyHex(keyPath),
      node: peerNode(host),
      oracle: 'arra',
      version: pkg.version,
      host,
      uptime: process.uptime(),
      clockUtc: new Date().toISOString(),
    };
  }, {
    detail: {
      tags: ['peer'],
      menu: { group: 'hidden' },
      summary: 'Maw peer identity (TOFU-pinned pubkey)',
    },
  });
}

export const peerIdentityRoute = createPeerIdentityRoute();
