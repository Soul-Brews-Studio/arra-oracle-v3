import dgram from 'dgram';
import { getIdentityPubkey } from './identity-key.ts';
import { locators, nodeName, SCOUT_CAPABILITIES } from './identity.ts';
export const SCOUT_GROUP = process.env.ARRA_SCOUT_GROUP || '224.0.0.224';
export const SCOUT_PORT = Number(process.env.ARRA_SCOUT_PORT || 31746);
export function shouldStartScoutAnnouncer() { return process.env.ARRA_SCOUT_ANNOUNCE === '1'; }
export class ScoutAnnouncer {
  private socket: dgram.Socket | null = null; private timer: Timer | null = null;
  constructor(private intervalMs = Number(process.env.ARRA_SCOUT_INTERVAL_MS || 5000)) {}
  payload() { const pub = getIdentityPubkey(); return { type: 'maw-hello', version: 1, zid: pub.slice(0, 16), whatAmI: 'oracle', node: nodeName(), oracle: 'arra', locators: locators(), capabilities: [...SCOUT_CAPABILITIES], oracles: ['arra'], ts: Date.now() }; }
  start() { if (this.socket) return; this.socket = dgram.createSocket('udp4'); this.socket.bind(() => { this.socket?.setMulticastTTL(2); this.announce(); this.timer = setInterval(() => this.announce(), this.intervalMs); }); }
  announce() { if (!this.socket) return; const buf = Buffer.from(JSON.stringify(this.payload())); this.socket.send(buf, SCOUT_PORT, SCOUT_GROUP); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.socket?.close(); this.socket = null; }
}
