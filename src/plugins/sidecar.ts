import { Elysia } from 'elysia';
import type { LoadedPlugin } from './types';

export function createSidecarProxy(plugin: LoadedPlugin): Elysia | null {
  if (plugin.manifest.type !== 'http' || plugin.status === 'disabled') return null;
  const m = plugin.manifest;
  const base = `http://localhost:${m.port}`;

  const app = new Elysia({ name: `sidecar:${m.name}` });

  for (const route of m.routes) {
    app.all(`${route.prefix}/*`, async ({ request }) => {
      const url = new URL(request.url);
      const target = `${base}${url.pathname}${url.search}`;
      try {
        const res = await fetch(target, {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: `sidecar ${m.name} unreachable`, detail: String(err) }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
    });

    app.all(route.prefix, async ({ request }) => {
      const url = new URL(request.url);
      const target = `${base}${url.pathname}${url.search}`;
      try {
        const res = await fetch(target, {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: `sidecar ${m.name} unreachable` }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
    });
  }

  return app;
}

export async function healthCheckSidecar(plugin: LoadedPlugin): Promise<boolean> {
  if (plugin.manifest.type !== 'http') return false;
  const m = plugin.manifest;
  const url = `http://localhost:${m.port}${m.healthPath ?? '/health'}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    plugin.status = res.ok ? 'healthy' : 'degraded';
    return res.ok;
  } catch {
    plugin.status = 'degraded';
    return false;
  }
}
