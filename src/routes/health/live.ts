import { Elysia } from 'elysia';
import { PORT } from '../../config.ts';
import { MCP_SERVER_NAME } from '../../const.ts';
import pkg from '../../../package.json' with { type: 'json' };
import type { HealthEndpointOptions } from './health.ts';

type LivenessEndpointOptions = Pick<HealthEndpointOptions, 'isDraining' | 'uptimeSeconds'>;

export function createLivenessEndpoint(options: LivenessEndpointOptions = {}) {
  return new Elysia().get('/health/live', () => {
    const draining = options.isDraining?.() ?? false;
    const uptimeSeconds = Math.round(Number(options.uptimeSeconds?.() ?? process.uptime()) * 1000) / 1000;

    return {
      status: draining ? 'draining' : 'ok',
      state: draining ? 'draining' : 'live',
      checked_at: new Date().toISOString(),
      server: MCP_SERVER_NAME,
      version: pkg.version,
      port: Number(PORT),
      pid: process.pid,
      uptimeSeconds,
      draining,
    };
  }, {
    detail: {
      tags: ['health'],
      menu: { group: 'hidden' },
      description: 'Reports process liveness without probing database, vector, embedder, or plugin dependencies.',
      summary: 'Lightweight process liveness',
    },
  });
}

export const livenessEndpoint = createLivenessEndpoint();
