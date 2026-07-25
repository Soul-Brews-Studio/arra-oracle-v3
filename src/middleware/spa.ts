/**
 * Serve the built React app from `frontend/dist`.
 *
 * CLAUDE.md documented single-process production mode ("the backend serves both
 * API endpoints and the built React app from frontend/dist/") but nothing
 * implemented it: `/settings`, `/plugins`, `/status` all 404'd while
 * `frontend/dist/index.html` sat on disk. See #2831.
 *
 * Two constraints shaped this:
 *
 * 1. `/` must keep returning the JSON root endpoint for non-browser clients.
 *    `maw arra` and the enrichment added in #2820 read it. So the SPA is served
 *    by CONTENT NEGOTIATION: a request that accepts `text/html` gets the app,
 *    everything else keeps today's JSON byte-for-byte.
 *
 * 2. API surfaces must never be shadowed. Anything under an API prefix falls
 *    through untouched, so a missing endpoint still 404s as JSON rather than
 *    silently returning HTML — which would turn a routing bug into a confusing
 *    parse error at the caller.
 */
import { Elysia } from 'elysia';
import { existsSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

/** Prefixes the SPA must never intercept. */
const RESERVED_PREFIXES = ['/api', '/mcp', '/simple', '/health', '/metrics', '/plugins/'];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(pathname: string): string {
  const dot = pathname.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return CONTENT_TYPES[pathname.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

export function isReservedPath(pathname: string): boolean {
  return RESERVED_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function wantsHtml(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  // `*/*` (curl, fetch defaults) must NOT count — otherwise every JSON client
  // gets HTML. Only an explicit text/html preference wins.
  return accept.split(',').some((part) => part.trim().toLowerCase().startsWith('text/html'));
}

/** Resolve a request path inside distDir, refusing anything that escapes it. */
export function safeAssetPath(distDir: string, pathname: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return null;
    }
  })();
  if (decoded == null || decoded.includes('\0')) return null;
  const root = resolve(distDir);
  const candidate = resolve(root, `.${normalize(decoded)}`);
  return candidate === root || candidate.startsWith(`${root}/`) ? candidate : null;
}

export function resolveDistDir(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.ORACLE_FRONTEND_DIST?.trim();
  if (explicit) return resolve(explicit);
  const repoRoot = env.ORACLE_REPO_ROOT?.trim() || process.cwd();
  return join(resolve(repoRoot), 'frontend', 'dist');
}

export type SpaOptions = { distDir?: string; env?: Record<string, string | undefined> };

export function createSpaMiddleware(options: SpaOptions = {}) {
  const distDir = options.distDir ?? resolveDistDir(options.env);
  const indexPath = join(distDir, 'index.html');

  return new Elysia({ name: 'spa' }).onRequest(({ request }) => {
    // A build may legitimately be absent (dev, CI, API-only deploys). Checked per
    // request rather than at construction so `bun run build` needs no restart.
    if (!existsSync(indexPath)) return;
    if (request.method !== 'GET' && request.method !== 'HEAD') return;

    const pathname = new URL(request.url).pathname;
    if (isReservedPath(pathname)) return;

    // Real build artefacts (/assets/*, favicon, …) are served regardless of Accept.
    if (pathname !== '/') {
      const asset = safeAssetPath(distDir, pathname);
      if (asset && asset !== indexPath && existsSync(asset)) {
        const file = Bun.file(asset);
        if (file.size > 0) {
          return new Response(file, { headers: { 'content-type': contentTypeFor(pathname) } });
        }
      }
    }

    // Everything else: browsers get the app shell so deep links work; JSON
    // clients fall through to the routes they asked for.
    if (!wantsHtml(request)) return;
    return new Response(Bun.file(indexPath), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    });
  });
}
