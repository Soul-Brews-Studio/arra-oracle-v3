import { Elysia } from 'elysia';
import { hostname, userInfo } from 'node:os';

import { PORT } from '../../config.ts';
import pkg from '../../../package.json' with { type: 'json' };

function peerHost(): string {
  return process.env.ORACLE_HOST?.trim() || hostname();
}

function peerNode(host = peerHost()): string {
  return process.env.ORACLE_NODE?.trim() || `arra@${host}`;
}

function peerUser(): string | undefined {
  if (process.env.ORACLE_USER?.trim()) return process.env.ORACLE_USER.trim();
  if (process.env.USER?.trim()) return process.env.USER.trim();
  try { return userInfo().username; } catch { return undefined; }
}

export const peerInfoRoute = new Elysia().get('/info', () => {
  const host = peerHost();
  return {
    maw: { schema: '1', capabilities: ['arra-search'] },
    node: peerNode(host),
    oracle: 'arra',
    version: pkg.version,
    ts: new Date().toISOString(),
    host,
    user: peerUser(),
    port: Number(PORT),
    nickname: process.env.ORACLE_NICKNAME?.trim() || 'arra',
  };
}, {
  detail: {
    tags: ['peer'],
    menu: { group: 'hidden' },
    summary: 'Maw peer handshake gate',
  },
});
