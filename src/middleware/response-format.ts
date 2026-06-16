import { Elysia } from 'elysia';

type StandardBody = {
  success: boolean;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
};

function statusCode(response: unknown, status: unknown): number {
  if (response instanceof Response) return response.status;
  return typeof status === 'number' ? status : 200;
}

function errorText(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (typeof error === 'string') return error;
  if (error != null) return String(error);
  const message = payload.message;
  return typeof message === 'string' ? message : 'Request failed';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Response)
    && !(value instanceof Uint8Array);
}

export function standardizeJsonResponse(response: unknown, status: unknown): StandardBody | undefined {
  if (response === undefined || response instanceof Response || typeof response === 'string' || response instanceof Uint8Array) return;

  const code = statusCode(response, status);
  const success = code < 400;
  if (Array.isArray(response)) return { success, data: response, ...(success ? {} : { error: 'Request failed' }) };
  if (!isPlainObject(response)) return { success, data: response };

  if (typeof response.success === 'boolean') return response as StandardBody;
  if (!success || typeof response.error === 'string') return { success: false, error: errorText(response), ...response };
  return { success: true, data: response, ...response };
}

export function createResponseFormatMiddleware() {
  return new Elysia({ name: 'standard-response-format' })
    .onAfterHandle({ as: 'global' }, ({ response, set }) => standardizeJsonResponse(response, set.status));
}
