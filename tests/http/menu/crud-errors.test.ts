import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, requestJson } from './_helpers.ts';

describe('POST/PUT/DELETE /api/menu errors', () => {
  beforeEach(clearMenuRows);

  test('returns structured errors for duplicates, bad ids, and unknown rows', async () => {
    const app = createMenuApp();
    const first = await requestJson(app, 'POST', '/api/menu', { path: '/dup', label: 'Dup' });
    expect(first.status).toBe(201);

    const duplicate = await requestJson(app, 'POST', '/api/menu', { path: '/dup', label: 'Dup again' });
    expect(duplicate.status).toBe(409);
    expect(String((duplicate.json as { error: string }).error)).toContain('UNIQUE');

    const badPut = await requestJson(app, 'PUT', '/api/menu/not-a-number', { label: 'Bad' });
    expect(badPut).toMatchObject({ status: 400, json: { error: 'invalid id' } });

    const missingPut = await requestJson(app, 'PUT', '/api/menu/999999', { label: 'Missing' });
    expect(missingPut).toMatchObject({ status: 404, json: { error: 'not found' } });

    const badDelete = await requestJson(app, 'DELETE', '/api/menu/not-a-number');
    expect(badDelete).toMatchObject({ status: 400, json: { error: 'invalid id' } });

    const missingDelete = await requestJson(app, 'DELETE', '/api/menu/999999');
    expect(missingDelete).toMatchObject({ status: 404, json: { error: 'not found' } });
  });
});
