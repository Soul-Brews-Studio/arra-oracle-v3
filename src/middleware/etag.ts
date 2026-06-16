import { Elysia } from 'elysia';

export const ETAG_HEADER = 'ETag';
export const IF_NONE_MATCH_HEADER = 'If-None-Match';

const encoder = new TextEncoder();

type HeaderValue = string | number | string[];
type HeaderMap = Record<string, HeaderValue>;

function statusCode(response: unknown, status: unknown): number {
  if (response instanceof Response) return response.status;
  return typeof status === 'number' ? status : 200;
}

function hasHeader(headers: HeaderMap, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function hasExplicitEtag(response: unknown, headers: HeaderMap): boolean {
  return hasHeader(headers, ETAG_HEADER) || (response instanceof Response && response.headers.has(ETAG_HEADER));
}

function isEligibleGet(request: Request, response: unknown, status: unknown, headers: HeaderMap): boolean {
  if (request.method !== 'GET') return false;
  const code = statusCode(response, status);
  return code >= 200 && code < 300 && code !== 204 && code !== 205 && !hasExplicitEtag(response, headers);
}

export async function responseBodyBytes(response: unknown): Promise<Uint8Array> {
  if (response instanceof Response) return new Uint8Array(await response.clone().arrayBuffer());
  if (response === undefined || response === null) return new Uint8Array();
  if (response instanceof Uint8Array) return response;
  if (typeof response === 'string') return encoder.encode(response);
  return encoder.encode(JSON.stringify(response));
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function etagForBody(response: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await responseBodyBytes(response));
  return `"sha256-${hex(digest)}"`;
}

function withoutWeakPrefix(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith('w/') ? trimmed.slice(2).trim() : trimmed;
}

export function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header?.trim()) return false;
  return header.split(',').map(withoutWeakPrefix).some((candidate) => candidate === '*' || candidate === etag);
}

function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { [ETAG_HEADER]: etag } });
}

export function createEtagMiddleware() {
  return new Elysia({ name: 'etag' }).onAfterHandle({ as: 'global' }, async ({ request, response, set }) => {
    if (!isEligibleGet(request, response, set.status, set.headers)) return;

    const etag = await etagForBody(response);
    set.headers[ETAG_HEADER] = etag;

    if (ifNoneMatchMatches(request.headers.get(IF_NONE_MATCH_HEADER), etag)) {
      set.status = 304;
      return notModified(etag);
    }
  });
}
