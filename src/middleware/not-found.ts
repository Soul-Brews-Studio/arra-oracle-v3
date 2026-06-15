import { Elysia } from 'elysia';
import { apiRequestPath } from './api-version.ts';

export type NotFoundResponse = {
  error: 'Not Found';
  path: string;
  method: string;
};

export function notFoundResponse(request: Request): NotFoundResponse {
  return {
    error: 'Not Found',
    path: apiRequestPath(request),
    method: request.method,
  };
}

export function createNotFoundMiddleware() {
  return new Elysia({ name: 'not-found' }).all('*', ({ request, set }) => {
    set.status = 404;
    return notFoundResponse(request);
  });
}
