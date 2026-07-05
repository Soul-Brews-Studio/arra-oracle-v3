import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createResponseFormatMiddleware,
  standardizeJsonResponse,
} from '../../../src/middleware/response-format.ts';
import { createErrorMiddleware } from '../../../src/middleware/errors.ts';

function app() {
  return new Elysia()
    .use(createResponseFormatMiddleware())
    .use(createErrorMiddleware(() => undefined))
    .get('/object', () => ({ value: 1 }))
    .get('/array', () => [1, 2])
    .get('/ready', () => ({ success: true, data: { ok: true } }))
    .get('/text', () => new Response('plain text'))
    .get('/boom', ({ set }) => {
      set.status = 400;
      return { error: 'bad input', field: 'name' };
    });
}

async function json(path: string) {
  return app().handle(new Request(`http://local${path}`)).then((res) => res.json());
}

describe('standard JSON response format', () => {
  test('adds success and data while preserving existing object fields', async () => {
    expect(await json('/object')).toEqual({ success: true, data: { value: 1 }, value: 1 });
  });

  test('wraps array payloads in data', async () => {
    expect(await json('/array')).toEqual({ success: true, data: [1, 2] });
  });

  test('does not double-wrap already-standard payloads', async () => {
    expect(await json('/ready')).toEqual({ success: true, data: { ok: true } });
  });

  test('normalizes error objects with success false', async () => {
    expect(await json('/boom')).toEqual({ success: false, error: 'bad input', field: 'name' });
  });

  test('leaves raw Response bodies unchanged', async () => {
    const res = await app().handle(new Request('http://local/text'));
    expect(await res.text()).toBe('plain text');
  });

  test('utility treats status codes as the success boundary', () => {
    expect(standardizeJsonResponse({ ok: true }, 201)?.success).toBe(true);
    expect(standardizeJsonResponse({ error: 'nope' }, 404)).toMatchObject({ success: false });
  });
});
