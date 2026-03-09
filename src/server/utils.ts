/**
 * Server Utilities
 * Reusable helpers for HTTP handlers
 */

import type { ServerResponse } from 'http';

/**
 * Wrap an async handler for use in synchronous HTTP server
 * Handles errors and JSON responses automatically
 */
export function asyncHandler<T>(
  res: ServerResponse,
  handler: () => Promise<T>
): void {
  (async () => {
    try {
      const result = await handler();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result, null, 2));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error'
      }));
    }
  })();
}

/**
 * Validate required query parameters
 * Returns error response if missing, null if valid
 */
export function validateRequired(
  res: ServerResponse,
  params: Record<string, any>,
  required: string[]
): string | null {
  for (const param of required) {
    if (!params[param]) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `Missing required parameter: ${param}` }));
      return param;
    }
  }
  return null;
}

/**
 * Combined async handler with validation
 * Usage:
 *   asyncHandlerWithValidation(res, query, ['q'], async () => {
 *     return await handleSearch(query.q);
 *   });
 */
export function asyncHandlerWithValidation<T>(
  res: ServerResponse,
  params: Record<string, any>,
  required: string[],
  handler: () => Promise<T>
): void {
  if (validateRequired(res, params, required)) {
    return; // Response already sent
  }
  asyncHandler(res, handler);
}
