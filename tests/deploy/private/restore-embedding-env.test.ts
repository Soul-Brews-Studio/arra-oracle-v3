import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
async function run(contents: string, mode = 0o600) {
  const root = mkdtempSync(join(tmpdir(), 'arra-restore-env-')); roots.push(root);
  const env = join(root, 'embedding.env');
  writeFileSync(env, contents); chmodSync(env, mode);
  const child = Bun.spawn(['bash', '-c', 'source "$1"; load_restore_embedding_env "$2" || exit $?; printf "%s\\n" "${restore_embedding_env[@]}"', '_',
    resolve('deploy/private/arra-full-stack/restore-embedding-env.sh'), env], { stdout: 'pipe', stderr: 'pipe' });
  return { code: await child.exited, output: await new Response(child.stdout).text(), error: await new Response(child.stderr).text() };
}

test('Ollama recovery accepts a loopback model without forwarding unrelated secrets', async () => {
  const result = await run('ORACLE_EMBEDDER=ollama\nORACLE_EMBEDDING_MODEL=bge-m3\nOLLAMA_BASE_URL=http://127.0.0.1:11434\nOPENAI_API_KEY=not-for-this-provider\n');
  expect(result.code).toBe(0);
  expect(result.output).toContain('ORACLE_EMBEDDER=ollama');
  expect(result.output).toContain('ORACLE_EMBEDDING_MODEL=bge-m3');
  expect(result.output).toContain('OLLAMA_BASE_URL=http://127.0.0.1:11434');
  expect(result.output).not.toContain('OPENAI_API_KEY');
});

test('recovery rejects world-readable env and non-loopback embedding endpoints', async () => {
  expect((await run('ORACLE_EMBEDDER=ollama\n', 0o644)).code).toBe(2);
  expect((await run('ORACLE_EMBEDDER=ollama\nOLLAMA_BASE_URL=https://example.com\n')).code).toBe(2);
});

test('legacy OpenAI recovery remains supported without evaluating env content', async () => {
  const result = await run('OPENAI_API_KEY=test-only-key\nOPENAI_EMBEDDING_MODEL=text-embedding-3-small\nUNRELATED=$(false)\n');
  expect(result.code).toBe(0);
  expect(result.output).toContain('ORACLE_EMBEDDER=openai');
  expect(result.output).toContain('ORACLE_EMBEDDING_MODEL=text-embedding-3-small');
  expect(result.output).not.toContain('UNRELATED');
});
