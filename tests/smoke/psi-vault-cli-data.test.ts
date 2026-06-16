import { afterAll, beforeAll, expect, test } from 'bun:test';
import {
  logSmoke,
  runSmokeCli,
  startSmokeServer,
  writePsiMemory,
  type SmokeServer,
} from './_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'psi-vault-data' });
  writePsiMemory(server.repoRoot, `---
arra_type: learning
muninn_concepts: [psi-smoke, memory]
---
# Smoke Memory

A moonlit vector smoke datum from the ψ vault. #psi-smoke
`);
});

afterAll(async () => {
  await server.stop();
});

test('CLI reads ψ vault data and queries the learned oracle memory', async () => {
  const psiDir = `${server.repoRoot}/ψ`;
  const importResult = await runSmokeCli(server, [
    'import-obsidian', '--in', psiDir, '--dry-run', '--create-new', '--verbose',
  ]);
  expect(importResult.code).toBe(0);
  expect(importResult.stdout).toContain('scanned:    1');
  expect(importResult.stdout).toContain('[dry-run] create: memory/learnings/smoke-memory.md');

  const phrase = 'moonlit vector smoke datum from the ψ vault';
  const learnResult = await runSmokeCli(server, [
    'learn', phrase, '--concepts', 'psi-smoke,memory', '--source', 'ψ/memory/learnings/smoke-memory.md',
  ]);
  expect(learnResult.code).toBe(0);
  expect(learnResult.stdout).toContain('Learned:');

  const searchResult = await runSmokeCli(server, ['search', 'moonlit vector smoke', '--limit', '5']);
  expect(searchResult.code).toBe(0);
  expect(searchResult.stdout).toContain('moonlit vector smoke datum');
  expect(searchResult.stdout).toContain('ψ/memory/learnings');
  logSmoke('psi-vault-cli-data', { imported: true, learned: true, queried: true });
}, 30_000);
