/**
 * TurboVec Adapter
 *
 * Sidecar vector DB that speaks the vector proxy protocol. Storage and
 * embedding behavior live in the external TurboVec service.
 */

import { ProxyVectorAdapter } from './proxy.ts';

export function resolveTurboVecEndpoint(endpoint?: string): string {
  const resolved = endpoint || process.env.ORACLE_TURBOVEC_URL || process.env.TURBOVEC_URL;
  if (!resolved) throw new Error('turbovec adapter requires endpoint, ORACLE_TURBOVEC_URL, or TURBOVEC_URL');
  return resolved;
}

export class TurboVecAdapter extends ProxyVectorAdapter {
  readonly name = 'turbovec';

  constructor(collectionName: string, endpoint?: string, requestTimeoutMs?: number) {
    super(collectionName, resolveTurboVecEndpoint(endpoint), requestTimeoutMs);
  }
}
