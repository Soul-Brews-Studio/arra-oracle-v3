import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOpenApiCompletenessGaps } from '../../../src/openapi/index.ts';
import type { UnifiedRuntime } from '../../../src/plugins/unified-loader.ts';

const scratch = mkdtempSync(join(tmpdir(), 'arra-openapi-complete-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = scratch;
process.env.ORACLE_DB_PATH = join(scratch, 'oracle.db');
process.env.ORACLE_EMBEDDER = 'none';

const { createApp } = await import('../../../src/server.ts');

function runtime(): UnifiedRuntime {
  return {
    pluginCount: 0,
    routes: [],
    mcpTools: [],
    menu: [],
    cliSubcommands: [],
    servers: [],
    callMcpTool: async () => ({}),
    pluginStatuses: () => [],
    pluginRegistry: () => [],
    init: async () => {},
    reload: async () => {},
    stop: async () => {},
  };
}

describe('/api/docs/json OpenAPI completeness', () => {
  test('documents every mounted route with summaries, tags, and examples', async () => {
    const app = createApp({ unifiedPlugins: runtime(), dataDir: scratch, vectorUrl: '' });
    const response = await app.fetch(new Request('http://local.test/api/docs/json'));
    const spec = await response.json();

    expect(response.status).toBe(200);
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Arra Oracle API');
    expect(findOpenApiCompletenessGaps(spec, app.routes)).toEqual({
      missingRoutes: [],
      missingSummaries: [],
      missingExamples: [],
    });
    expect(spec.paths['/api/docs/json']).toBeUndefined();
    expect(spec.tags.map((tag: { name: string }) => tag.name)).toContain('gateway');
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect(spec.paths['/api/auth/login'].post.requestBody.content['application/json'].example)
      .toMatchObject({ password: expect.any(String) });
    expect(spec.paths['/api/gateway/status'].get.summary).toBe('GET gateway status');
  });
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalDbPath;
  rmSync(scratch, { recursive: true, force: true });
});
