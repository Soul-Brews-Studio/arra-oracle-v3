/** Vector sidecar passthrough backed by the unified proxy manifest shape. */
import {
  defaultVectorProxyManifest,
  loadVectorConfig,
  type VectorProxyManifest,
} from './config.ts';
import { proxyRequestForManifest } from '../plugins/proxy-surface.ts';

export function activeVectorProxyManifest(): VectorProxyManifest[] {
  return loadVectorConfig()?.proxy ?? defaultVectorProxyManifest();
}

export function proxyVectorSidecarRequest(
  request: Request,
  manifests: VectorProxyManifest[] = activeVectorProxyManifest(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response | undefined> {
  return proxyRequestForManifest(request, manifests, env);
}
