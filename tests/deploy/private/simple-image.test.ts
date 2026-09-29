import { expect, test } from 'bun:test';

test('runtime image includes Simple Mode HTML next to bundled server', async () => {
  const dockerfile = await Bun.file('Dockerfile').text();
  expect(dockerfile).toContain('COPY --from=builder /app/src/simple.html ./dist/simple.html');
  expect(await Bun.file('src/simple.html').exists()).toBe(true);
});
