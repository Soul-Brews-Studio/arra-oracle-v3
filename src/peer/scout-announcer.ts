import { randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { hostname } from 'node:os';

import { PORT } from '../config.ts';

export const SCOUT_MULTICAST_ADDR = '224.0.0.224';
export const SCOUT_MULTICAST_PORT = 31746;
export const SCOUT_VERSION = 1;
export const DEFAULT_SCOUT_INTERVAL_MS = 30_000;

const DEFAULT_CAPABILITIES = ['pair', 'feed', 'send', 'arra-search'] as const;
const DEFAULT_ORACLES = ['arra'] as const;

type Env = Record<string, string | undefined>;

export interface ScoutHelloMessage {
  type: 'maw-hello';
  version: number;
  zid: string;
  whatAmI: 'oracle';
  node: string;
  oracle: 'arra';
  locators: string[];
  capabilities: string[];
  oracles: string[];
  ts: number;
}

export interface ScoutAnnouncerConfig {
  zid: string;
  node: string;
  locator: string;
  intervalMs: number;
  capabilities: string[];
  oracles: string[];
}

export interface ScoutAnnouncer {
  readonly config: ScoutAnnouncerConfig;
  stop(): void;
  sendNow(): void;
}

function peerHost(env: Env = process.env): string {
  return env.ORACLE_HOST?.trim() || hostname();
}

function peerNode(host = peerHost(), env: Env = process.env): string {
  return env.ORACLE_NODE?.trim() || `arra@${host}`;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function defaultAnnounceHost(host: string): string {
  return host.includes('.') ? host : `${host}.local`;
}

function resolveLocator(host: string, env: Env): string {
  const explicit =
    env.ORACLE_SCOUT_URL?.trim() ||
    env.ORACLE_PUBLIC_URL?.trim() ||
    env.ORACLE_BASE_URL?.trim();
  if (explicit) return trimTrailingSlash(new URL(explicit).toString());

  const advertiseHost =
    env.MAW_ANNOUNCE_HOST?.trim() ||
    env.ORACLE_SCOUT_HOST?.trim() ||
    defaultAnnounceHost(host);
  return `http://${advertiseHost}:${Number(PORT)}`;
}

export function generateScoutZid(): string {
  return randomBytes(16).toString('hex');
}

export function createScoutAnnouncerConfig(env: Env = process.env): ScoutAnnouncerConfig {
  const host = peerHost(env);
  return {
    zid: generateScoutZid(),
    node: peerNode(host, env),
    locator: resolveLocator(host, env),
    intervalMs: parsePositiveInt(env.ORACLE_SCOUT_INTERVAL_MS, DEFAULT_SCOUT_INTERVAL_MS),
    capabilities: [...DEFAULT_CAPABILITIES],
    oracles: [...DEFAULT_ORACLES],
  };
}

export function makeScoutHello(
  config: Pick<ScoutAnnouncerConfig, 'zid' | 'node' | 'locator' | 'capabilities' | 'oracles'>,
  now = Date.now(),
): ScoutHelloMessage {
  return {
    type: 'maw-hello',
    version: SCOUT_VERSION,
    zid: config.zid,
    whatAmI: 'oracle',
    node: config.node,
    oracle: 'arra',
    locators: [config.locator],
    capabilities: config.capabilities,
    oracles: config.oracles,
    ts: now,
  };
}

export function startScoutAnnouncer(
  config = createScoutAnnouncerConfig(),
  deps: {
    createSocketFn?: typeof createSocket;
    log?: Pick<Console, 'log' | 'warn'>;
  } = {},
): ScoutAnnouncer {
  const log = deps.log ?? console;
  const createSocketFn = deps.createSocketFn ?? createSocket;
  const socket = createSocketFn({ type: 'udp4', reuseAddr: true });
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const sendNow = () => {
    if (closed) return;
    const hello = makeScoutHello(config);
    const buf = Buffer.from(JSON.stringify(hello));
    socket.send(buf, SCOUT_MULTICAST_PORT, SCOUT_MULTICAST_ADDR, (err) => {
      if (err) log.warn(`[scout] hello send failed: ${err.message}`);
    });
  };

  socket.on('error', (err) => {
    log.warn(`[scout] announcer socket error: ${err.message}`);
  });

  socket.bind(0, () => {
    try {
      socket.setMulticastTTL(2);
    } catch (err) {
      log.warn(`[scout] unable to set multicast TTL: ${err instanceof Error ? err.message : err}`);
    }
    sendNow();
    timer = setInterval(sendNow, config.intervalMs);
    timer.unref?.();
    socket.unref?.();
    log.log(
      `[scout] announcing ${config.node} at ${config.locator} on ${SCOUT_MULTICAST_ADDR}:${SCOUT_MULTICAST_PORT} (zid: ${config.zid.slice(0, 8)}…)`,
    );
  });

  return {
    config,
    sendNow,
    stop() {
      if (closed) return;
      closed = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      try {
        socket.close();
      } catch {
        // socket may already be closed after an error
      }
    },
  };
}
