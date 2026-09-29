import { afterEach, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { swagger } from '@elysiajs/swagger';
import { createApiKeyAuthMiddleware } from '../../../src/middleware/auth.ts';
import { createOpenApiSwaggerConfig, openApiSpecHandler } from '../../../src/openapi/index.ts';

const previous = process.env.ARRA_API_KEY;
afterEach(() => {
  if (previous === undefined) delete process.env.ARRA_API_KEY;
  else process.env.ARRA_API_KEY = previous;
});

function app() {
  const server = new Elysia().use(createApiKeyAuthMiddleware())
    .use(swagger(createOpenApiSwaggerConfig()))
    .get('/api/example', () => ({ ok: true }));
  return server.get('/api/docs/json', openApiSpecHandler(server));
}

test('authenticated OpenAPI generation preserves auth on internal dispatch', async () => {
  process.env.ARRA_API_KEY = 'test-openapi-key';
  const response = await app().handle(new Request('http://local/api/docs/json', {
    headers: { authorization: 'Bearer test-openapi-key' },
  }));
  expect(response.status).toBe(200);
  const spec = await response.json();
  expect(spec.openapi).toBe('3.0.3');
  expect(spec.paths['/api/example'].get).toBeDefined();
  expect(JSON.stringify(spec)).not.toContain('test-openapi-key');
});

test('missing and invalid OpenAPI credentials remain denied', async () => {
  process.env.ARRA_API_KEY = 'test-openapi-key';
  const server = app();
  for (const authorization of ['', 'Bearer invalid']) {
    const response = await server.handle(new Request('http://local/api/docs/json', { headers: { authorization } }));
    expect(response.status).toBe(401);
    expect((await response.json()).openapi).toBeUndefined();
  }
});
