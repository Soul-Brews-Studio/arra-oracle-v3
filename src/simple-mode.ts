import { join } from 'node:path';

const SIMPLE_HTML = join(import.meta.dir, 'simple.html');
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
type HeaderSet = { headers: Record<string, string | number | string[]> };

export function simpleModeResponse(set: HeaderSet): Response {
  set.headers['Content-Type'] = HTML_CONTENT_TYPE;
  return new Response(Bun.file(SIMPLE_HTML), {
    headers: { 'Content-Type': HTML_CONTENT_TYPE },
  });
}
