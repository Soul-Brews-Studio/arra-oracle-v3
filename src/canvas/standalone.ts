import { Elysia } from 'elysia';
import { canvasRoutes } from '../routes/canvas/index.ts';
import { handleCanvasRequest, type CanvasWorkerEnv } from '../workers/canvas/index.ts';

export interface CanvasServeOptions {
  port: number;
  apiBase?: string;
  hostname?: string;
}

export const DEFAULT_CANVAS_PORT = 47779;

export function createCanvasStandaloneApp(env: CanvasWorkerEnv = {}) {
  return new Elysia({ name: 'canvas-standalone' })
    .use(canvasRoutes)
    .all('*', ({ request }) => handleCanvasRequest(request, env));
}

function readFlag(args: string[], name: string): string | undefined {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

export function parseCanvasServeOptions(args: string[], env: Record<string, string | undefined> = process.env): CanvasServeOptions {
  const rawPort = readFlag(args, '--port') ?? env.CANVAS_PORT ?? String(DEFAULT_CANVAS_PORT);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be 1-65535');
  return {
    port,
    apiBase: readFlag(args, '--api-base') ?? env.ORACLE_API_BASE,
    hostname: readFlag(args, '--host') ?? env.CANVAS_HOST ?? '0.0.0.0',
  };
}

export function canvasServeSummary(options: CanvasServeOptions) {
  return {
    url: `http://localhost:${options.port}`,
    host: 'canvas.buildwithoracle.com',
    port: options.port,
    apiBase: options.apiBase ?? 'https://studio.buildwithoracle.com',
  };
}
