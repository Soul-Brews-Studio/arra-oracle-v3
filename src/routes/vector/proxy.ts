/** Manifest-driven vector sidecar pass-through. */
import { Elysia } from 'elysia';
import { activeVectorProxyManifest, proxyVectorSidecarRequest } from '../../vector/proxy-manifest.ts';

function routePath(publicPath: string): string {
  const withoutApi = publicPath.startsWith('/api/') ? publicPath.slice('/api'.length) : publicPath;
  const rooted = withoutApi.startsWith('/') ? withoutApi : `/${withoutApi}`;
  return `${rooted.replace(/\/+$/, '')}*`;
}

export const vectorProxyEndpoint = new Elysia({ name: 'vector-proxy-manifest' });

for (const manifest of activeVectorProxyManifest()) {
  (vectorProxyEndpoint as any).route('ALL', routePath(manifest.path), ({ request }: any) =>
    proxyVectorSidecarRequest(request, [manifest]));
}
