import { expect, test } from 'bun:test';
import { validateRequired } from '../utils.ts';

function responseSink() {
  const res = {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: '',
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    end(value: string) {
      this.body = value;
    },
  };
  return res;
}

test('required query validation accepts falsy but present values', () => {
  const res = responseSink();
  expect(validateRequired(res as any, { limit: 0, enabled: false }, ['limit', 'enabled'])).toBeNull();
  expect(res.statusCode).toBe(200);
  expect(res.body).toBe('');
});

test('required query validation rejects absent and blank strings', () => {
  const res = responseSink();
  expect(validateRequired(res as any, { q: '   ' }, ['q'])).toBe('q');
  expect(res.statusCode).toBe(400);
  expect(res.headers.get('Content-Type')).toBe('application/json');
  expect(JSON.parse(res.body)).toEqual({ error: 'Missing required parameter: q' });
});
