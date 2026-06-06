import os from 'os';
import pkg from '../../package.json' with { type: 'json' };
import { PORT } from '../config.ts';
import { getIdentityPubkey } from './identity-key.ts';

export const FEDERATION_CAPABILITIES = ['arra-search', 'feed'] as const;
export const SCOUT_CAPABILITIES = ['pair', 'feed', 'send', 'arra-search'] as const;

export function nodeName() { return `arra@${os.hostname()}`; }
export function locators() { return [`http://${os.hostname()}:${PORT}`]; }
export function federationInfo() {
  return { maw: { schema: '1', capabilities: [...FEDERATION_CAPABILITIES] }, node: nodeName(), oracle: 'arra', locators: locators(), version: pkg.version, ts: Date.now() };
}
export function identityDocument() {
  return { pubkey: getIdentityPubkey(), node: nodeName(), oracle: 'arra', version: pkg.version, uptime: process.uptime(), clockUtc: new Date().toISOString() };
}
