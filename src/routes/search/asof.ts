export const AS_OF_SUPPORTED_ENDPOINTS = [
  '/api/search',
  '/api/list',
  '/api/vector/search',
  '/api/ask',
  '/api/memory/fanout',
  '/api/memory/recall',
  '/api/memory/search',
] as const;

export function asOfResponse(asOfMs: number | undefined): Record<string, unknown> {
  return asOfMs ? {
    asOf: new Date(asOfMs).toISOString(),
    asOfSupportedEndpoints: [...AS_OF_SUPPORTED_ENDPOINTS],
  } : {};
}
