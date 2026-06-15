import { Elysia } from 'elysia';
import { REQUEST_ID_HEADER, RESPONSE_TIME_HEADER, requestIdFor, responseTimeFor } from './correlation.ts';

export type ApiErrorResponse = {
  error: string;
  code: number;
  details?: unknown;
};

export type StructuredErrorResponse = {
  error: string;
  message: string;
  statusCode: number;
  correlationId: string;
};

export function apiErrorResponse<const T extends string, const C extends number, D>(
  error: T,
  code: C,
  details: D,
): { error: T; code: C; details: D } {
  return { error, code, details };
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

function statusLabel(statusCode: number): string {
  if (statusCode === 400) return 'Bad Request';
  if (statusCode === 401) return 'Unauthorized';
  if (statusCode === 404) return 'Not Found';
  if (statusCode === 422) return 'Unprocessable Entity';
  if (statusCode === 503) return 'Service Unavailable';
  return 'Internal Server Error';
}

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && value >= 400 && value <= 599 ? value : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

function knownStatus(code: string, error: unknown): number {
  if (error instanceof HttpError) return error.statusCode;
  const explicit = numericStatus((error as { status?: unknown })?.status) ?? numericStatus((error as { statusCode?: unknown })?.statusCode);
  if (explicit) return explicit;
  if (code === 'NOT_FOUND' || errorName(error) === 'NotFoundError') return 404;
  if (code === 'VALIDATION' || errorName(error) === 'ValidationError') return 422;
  if (code === 'PARSE' || errorName(error) === 'BadRequestError' || error instanceof SyntaxError) return 400;
  const message = errorMessage(error);
  if (message.includes('disk I/O') || message.includes('database is locked') || message.includes('SQLITE_BUSY')) return 503;
  return 500;
}

type ErrorLogger = (entry: { requestId: string; statusCode: number; code: string; message: string }) => void;

function defaultErrorLogger(entry: { requestId: string; statusCode: number; code: string; message: string }) {
  if (entry.statusCode < 500) return;
  console.error(`[HTTP:${entry.requestId}] ${entry.statusCode} ${entry.code}: ${entry.message}`);
}

export function createErrorMiddleware(logger: ErrorLogger = defaultErrorLogger) {
  return new Elysia({ name: 'structured-errors' }).onError({ as: 'global' }, ({ code, error, request, set }) => {
    const statusCode = knownStatus(String(code), error);
    const id = requestIdFor(request);
    const message = statusCode === 404 && code === 'NOT_FOUND' ? 'Route not found' : errorMessage(error);
    set.status = statusCode;
    set.headers[REQUEST_ID_HEADER] = id;
    set.headers[RESPONSE_TIME_HEADER] = responseTimeFor(request);
    set.headers['x-correlation-id'] = id;
    logger({ requestId: id, statusCode, code: String(code), message });
    return apiErrorResponse(error instanceof HttpError ? error.error : statusLabel(statusCode), statusCode, {
      message,
      correlationId: id,
    }) satisfies ApiErrorResponse;
  });
}
