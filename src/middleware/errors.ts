import { Elysia } from 'elysia';
import { apiRequestPath } from './api-version.ts';
import { REQUEST_ID_HEADER, RESPONSE_TIME_HEADER, requestIdFor, responseTimeFor } from './correlation.ts';

export type ApiErrorResponse = {
  success: false;
  error: string;
  code: number;
  details?: unknown;
};

export type StructuredErrorResponse = {
  success: false;
  error: string;
  message: string;
  statusCode: number;
  correlationId: string;
};

export function apiErrorResponse<const T extends string, const C extends number, D>(
  error: T,
  code: C,
  details: D,
): { success: false; error: T; code: C; details: D } {
  return { success: false, error, code, details };
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
    readonly error = statusLabel(statusCode),
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request') {
    super(message, 400, 'Bad Request');
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(message, 404, 'Not Found');
  }
}

export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable entity') {
    super(message, 422, 'Unprocessable Entity');
  }
}

const STATUS_LABELS: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function statusLabel(statusCode: number): string {
  return STATUS_LABELS[statusCode] ?? (statusCode >= 500 ? 'Internal Server Error' : 'Request Error');
}

function numericStatus(value: unknown): number | null {
  const status = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function normalizedPath(pathname: string): string {
  return pathname.replace(/^\/api\/v[^/]+(?=\/)/, '/api');
}

function isLearnPath(pathname: string): boolean {
  const path = normalizedPath(pathname);
  return path === '/api/learn' || path.startsWith('/api/learn/');
}

function isParseError(code: string, error: unknown): boolean {
  return code === 'PARSE' || errorName(error) === 'BadRequestError' || error instanceof SyntaxError;
}

function knownStatus(code: string, error: unknown, pathname: string): number {
  if (isLearnPath(pathname) && (code === 'PARSE' || error instanceof SyntaxError)) return 500;
  if (error instanceof HttpError) return error.statusCode;
  const explicit = numericStatus((error as { status?: unknown })?.status) ?? numericStatus((error as { statusCode?: unknown })?.statusCode);
  if (explicit) return explicit;
  if (code === 'NOT_FOUND' || errorName(error) === 'NotFoundError') return 404;
  if (code === 'VALIDATION' || errorName(error) === 'ValidationError') return 422;
  if (isParseError(code, error)) return 400;
  const message = errorMessage(error);
  if (message.includes('disk I/O') || message.includes('database is locked') || message.includes('SQLITE_BUSY')) return 503;
  return 500;
}

type ErrorLogger = (entry: { requestId: string; statusCode: number; code: string; message: string }) => void;

function defaultErrorLogger(entry: { requestId: string; statusCode: number; code: string; message: string }) {
  if (entry.statusCode < 500) return;
  console.error(`[HTTP:${entry.requestId}] ${entry.statusCode} ${entry.code}: ${entry.message}`);
}

function logSafely(logger: ErrorLogger, entry: Parameters<ErrorLogger>[0]): void {
  try { logger(entry); } catch {}
}

export function createErrorMiddleware(logger: ErrorLogger = defaultErrorLogger) {
  return new Elysia({ name: 'structured-errors' }).onError({ as: 'global' }, ({ code, error, request, set }) => {
    const statusCode = knownStatus(String(code), error, apiRequestPath(request));
    const id = requestIdFor(request);
    const message = statusCode === 404 && code === 'NOT_FOUND' ? 'Route not found' : errorMessage(error);
    set.status = statusCode;
    set.headers[REQUEST_ID_HEADER] = id;
    set.headers[RESPONSE_TIME_HEADER] = responseTimeFor(request);
    set.headers['x-correlation-id'] = id;
    logSafely(logger, { requestId: id, statusCode, code: String(code), message });
    return apiErrorResponse(error instanceof HttpError ? error.error : statusLabel(statusCode), statusCode, {
      message,
      correlationId: id,
    }) satisfies ApiErrorResponse;
  });
}
