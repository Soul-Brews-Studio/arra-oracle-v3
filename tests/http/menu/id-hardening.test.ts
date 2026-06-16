import { describe, expect, test } from 'bun:test';
import { createMenuApp, requestJson } from './_helpers.ts';

describe('menu id hardening', () => {
  test('rejects non-positive and fractional route ids before DB writes', async () => {
    const app = createMenuApp();
    const cases: Array<[string, string, unknown?]> = [
      ['PUT', '/api/menu/1.5', { label: 'Bad' }],
      ['DELETE', '/api/menu/0'],
      ['PATCH', '/api/menu/items/-1', { label: 'Bad' }],
      ['DELETE', '/api/menu/items/1e3'],
      ['POST', '/api/menu/reset/1.5'],
    ];

    for (const [method, path, body] of cases) {
      const { status, json } = await requestJson<Record<string, string>>(
        app,
        method,
        path,
        body,
      );
      expect({ method, path, status, error: json.error }).toEqual({
        method,
        path,
        status: 400,
        error: 'invalid id',
      });
    }
  });

  test('rejects invalid reorder ids and parent ids transactionally', async () => {
    const app = createMenuApp();

    const badId = await requestJson<Record<string, string>>(app, 'POST', '/api/menu/reorder', {
      items: [{ id: 1.5, position: 1 }],
    });
    const badParent = await requestJson<Record<string, string>>(app, 'POST', '/api/menu/reorder', {
      items: [{ id: 1, parentId: 0, position: 1 }],
    });

    expect(badId).toMatchObject({ status: 400, json: { error: 'invalid id' } });
    expect(badParent).toMatchObject({ status: 400, json: { error: 'invalid parentId' } });
  });
});
