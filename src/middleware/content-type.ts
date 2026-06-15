import { Elysia } from 'elysia';

export const JSON_CONTENT_TYPE = 'application/json';
const WILDCARD_MEDIA = '*/*';

interface MediaRange {
  type: string;
  subtype: string;
  q: number;
  specificity: number;
}

type MutableHeaders = Record<string, string | number | string[]>;

function mediaRanges(accept: string): MediaRange[] {
  return accept
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(parseMediaRange)
    .filter((range): range is MediaRange => range !== null);
}

function parseMediaRange(value: string): MediaRange | null {
  const [rawType, ...params] = value.split(';').map(part => part.trim());
  const [type, subtype] = rawType.toLowerCase().split('/');
  if (!type || !subtype) return null;
  const qParam = params.find(param => param.toLowerCase().startsWith('q='));
  const q = qParam ? Number(qParam.slice(2)) : 1;
  if (!Number.isFinite(q) || q < 0 || q > 1) return null;
  const specificity = type === '*' && subtype === '*' ? 0 : subtype === '*' ? 1 : 2;
  return { type, subtype, q, specificity };
}

function matchesJson(range: MediaRange): boolean {
  if (range.type === '*' && range.subtype === '*') return true;
  if (range.type === 'application' && range.subtype === '*') return true;
  return range.type === 'application' && range.subtype === 'json';
}

export function acceptsJson(accept: string | null | undefined): boolean {
  if (!accept?.trim()) return true;
  const ranges = mediaRanges(accept).filter(matchesJson);
  if (ranges.length === 0) return false;
  ranges.sort((a, b) => b.specificity - a.specificity || b.q - a.q);
  return ranges[0]!.q > 0;
}

function hasContentType(headers: MutableHeaders): boolean {
  return headers['Content-Type'] !== undefined || headers['content-type'] !== undefined;
}

export function setJsonContentType(headers: MutableHeaders): void {
  if (!hasContentType(headers)) headers['Content-Type'] = JSON_CONTENT_TYPE;
}

export function notAcceptableBody(accept: string | null) {
  return {
    error: 'not_acceptable',
    message: 'Only application/json responses are supported.',
    accept: accept ?? null,
    supported: [JSON_CONTENT_TYPE],
  };
}

export function createContentTypeMiddleware() {
  return new Elysia({ name: 'content-type-negotiation' })
    .onBeforeHandle({ as: 'global' }, ({ request, set }) => {
      if (request.method === 'OPTIONS') return;
      const accept = request.headers.get('accept');
      if (acceptsJson(accept)) return;

      set.status = 406;
      setJsonContentType(set.headers);
      return notAcceptableBody(accept);
    })
    .onAfterHandle({ as: 'global' }, ({ set }) => {
      setJsonContentType(set.headers);
    })
    .onError({ as: 'global' }, ({ set }) => {
      setJsonContentType(set.headers);
    });
}
