import { test, expect } from '@playwright/test';

test.describe('Oracle API E2E', () => {
  test('health check', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  test('stats endpoint', async ({ request }) => {
    const res = await request.get('/api/stats');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(typeof data.total).toBe('number');
  });

  test('search endpoint', async ({ request }) => {
    const res = await request.get('/api/search?q=test');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.results)).toBe(true);
  });

  test('list endpoint', async ({ request }) => {
    const res = await request.get('/api/list');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.results)).toBe(true);
  });

  test('reflect endpoint', async ({ request }) => {
    const res = await request.get('/api/reflect');
    expect(res.ok()).toBe(true);
  });

  test('concepts endpoint', async ({ request }) => {
    const res = await request.get('/api/concepts?limit=5');
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data.concepts)).toBe(true);
    expect(typeof data.total_unique).toBe('number');
  });
});
