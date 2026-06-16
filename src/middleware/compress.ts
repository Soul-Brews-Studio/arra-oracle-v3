import { Elysia } from 'elysia';

export const CONTENT_ENCODING_HEADER = 'Content-Encoding';
export const MIN_COMPRESSIBLE_BYTES = 1024;
const ACCEPT_ENCODING_HEADER = 'Accept-Encoding';
const VARY_HEADER = 'Vary';
const encoder = new TextEncoder();

type CompressionEncoding = 'gzip' | 'deflate';
type HeaderValue = string | number | string[];
type HeaderMap = Record<string, HeaderValue>;
const ENCODING_PREFERENCE: CompressionEncoding[] = ['gzip', 'deflate'];

function qValue(entry: string): number {
  const q = entry.split(';').slice(1).find((part) => part.trim().toLowerCase().startsWith('q='));
  if (!q) return 1;
  const parsed = Number(q.split('=')[1]?.trim());
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
}

function tokens(header: string | null): Map<string, number> {
  const result = new Map<string, number>();
  for (const raw of header?.split(',') ?? []) {
    const name = raw.split(';')[0]?.trim().toLowerCase();
    if (name) result.set(name, qValue(raw));
  }
  return result;
}

export function acceptedEncoding(header: string | null): CompressionEncoding | null {
  const accepted = tokens(header);
  let best: { encoding: CompressionEncoding; q: number } | null = null;
  for (const encoding of ENCODING_PREFERENCE) {
    const q = accepted.get(encoding) ?? accepted.get('*') ?? 0;
    if (q > 0 && (!best || q > best.q)) best = { encoding, q };
  }
  return best?.encoding ?? null;
}

function responseStatus(response: unknown, setStatus: unknown): number {
  if (response instanceof Response) return response.status;
  return typeof setStatus === 'number' ? setStatus : 200;
}

function isBodyAllowed(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

function hasHeader(headers: HeaderMap, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

function hasContentEncoding(response: unknown, headers: HeaderMap): boolean {
  return hasHeader(headers, CONTENT_ENCODING_HEADER)
    || (response instanceof Response && response.headers.has(CONTENT_ENCODING_HEADER));
}

export async function responseBodyBytes(response: unknown): Promise<Uint8Array> {
  if (response instanceof Response) return new Uint8Array(await response.clone().arrayBuffer());
  if (response === undefined || response === null) return new Uint8Array();
  if (response instanceof Uint8Array) return response;
  if (typeof response === 'string') return encoder.encode(response);
  return encoder.encode(JSON.stringify(response));
}

export function compressBytes(bytes: Uint8Array, encoding: CompressionEncoding): Uint8Array {
  const input = new Uint8Array(bytes);
  return encoding === 'gzip' ? Bun.gzipSync(input) : Bun.deflateSync(input);
}

function mergedHeaders(response: unknown, setHeaders: HeaderMap): Headers {
  const headers = new Headers(response instanceof Response ? response.headers : undefined);
  for (const [key, value] of Object.entries(setHeaders)) {
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}

function addVary(headers: Headers): void {
  const current = headers.get(VARY_HEADER);
  if (!current) return headers.set(VARY_HEADER, ACCEPT_ENCODING_HEADER);
  if (current === '*' || current.toLowerCase().split(',').map((part) => part.trim()).includes('accept-encoding')) return;
  headers.set(VARY_HEADER, `${current}, ${ACCEPT_ENCODING_HEADER}`);
}

export async function compressedResponse(
  request: Request,
  response: unknown,
  setStatus: unknown,
  setHeaders: HeaderMap,
): Promise<Response | undefined> {
  const encoding = acceptedEncoding(request.headers.get(ACCEPT_ENCODING_HEADER));
  const status = responseStatus(response, setStatus);
  if (!encoding || request.method === 'HEAD' || !isBodyAllowed(status) || hasContentEncoding(response, setHeaders)) return;

  const body = await responseBodyBytes(response);
  if (body.byteLength <= MIN_COMPRESSIBLE_BYTES) return;

  const headers = mergedHeaders(response, setHeaders);
  const compressed = compressBytes(body, encoding);
  headers.set(CONTENT_ENCODING_HEADER, encoding);
  headers.set('Content-Length', String(compressed.byteLength));
  addVary(headers);
  return new Response(compressed, { status, statusText: response instanceof Response ? response.statusText : undefined, headers });
}

export function createCompressMiddleware() {
  return new Elysia({ name: 'response-compression' }).onAfterHandle({ as: 'global' }, ({ request, response, set }) => {
    return compressedResponse(request, response, set.status, set.headers);
  });
}
