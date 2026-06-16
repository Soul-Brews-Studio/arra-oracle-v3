/**
 * Gateway proxy dispatcher — forwards requests to upstream services.
 *
 * Uses built-in fetch(). No dependencies.
 * Returns 502 on connection refused, 504 on timeout.
 */
import type { ServiceConfig } from './config.ts';
import { currentTenantId, TENANT_HEADER, tenantIdFor } from '../middleware/tenant.ts';
import { cloneRetryableBody, retryableRequestBody, retryUpstreamRequest } from '../middleware/retry.ts';

const DEFAULT_TIMEOUT_MS = 15_000;

function safeTimeoutMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

export async function proxyToService(
  request: Request,
  service: ServiceConfig,
): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const targetBase = service.url.trim().replace(/\/+$/, '');
  const targetUrl = `${targetBase}${incomingUrl.pathname}${incomingUrl.search}`;
  const timeoutMs = safeTimeoutMs(service.timeout);

  try {
    const headers = new Headers(request.headers);
    headers.delete('host');
    const tenantId = currentTenantId() ?? tenantIdFor(request);
    if (tenantId) headers.set(TENANT_HEADER, tenantId);

    const body = await retryableRequestBody(request);

    const res = await retryUpstreamRequest(() => fetch(targetUrl, {
      method: request.method,
      headers: new Headers(headers),
      body: cloneRetryableBody(body),
      signal: AbortSignal.timeout(timeoutMs),
      duplex: 'half',
    }));

    // Stream the response back, preserving status and headers
    const responseHeaders = new Headers(res.headers);
    responseHeaders.set('X-Gateway-Service', targetBase);

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.includes('timeout') || msg.includes('aborted');

    console.warn(`[Gateway] proxy to ${targetBase} failed: ${msg}`);

    if (isTimeout) {
      return new Response(JSON.stringify({ error: 'Gateway timeout', target: targetBase }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Bad gateway', target: targetBase }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
