/**
 * `oracle_stats` over MCP must not report a boot-time snapshot (#2817).
 *
 * Reported by Orz Oracle from a real L0 VPS: `arra_stats` said `vector_status: "connected"`
 * for an entire session while `arra_search mode=vector` returned nothing and `arra_learn`
 * reported `embedding: "failed"`. The embedder had failed to load — bge-m3 needs ~1,158 MB
 * against ~1,251 MB free — and the health field never noticed.
 *
 * Two of the three layers in that report were already fixed by the time this was written: the
 * probe is awaited, and `probeConfiguredEmbedder` does reach the embedder at startup. What
 * remained is the one this pins.
 *
 * `src/routes/health/health.ts` and `stats.ts` read `readEmbedderRuntimeStatus()`, which
 * re-probes behind a TTL. `MCPServer.getToolCtx()` read `getEmbedderRuntimeStatus()`, which
 * returns the stored snapshot and never re-probes. So the same question asked over HTTP and
 * over MCP could give different answers — and the MCP one was the one that went stale.
 *
 * A health check can only prove the layer it pokes. These tests poke the layer the name
 * claims.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  getEmbedderRuntimeStatus,
  readEmbedderRuntimeStatus,
  setEmbedderRuntimeStatus,
} from '../../src/vector/embedder-config.ts';

const previousTtl = process.env.ORACLE_EMBEDDER_STATUS_TTL_MS;

afterEach(() => {
  if (previousTtl === undefined) delete process.env.ORACLE_EMBEDDER_STATUS_TTL_MS;
  else process.env.ORACLE_EMBEDDER_STATUS_TTL_MS = previousTtl;
});

/** A status stamped far enough in the past that any sane TTL considers it stale. */
function staleConnected() {
  setEmbedderRuntimeStatus({
    status: 'connected',
    provider: 'ollama',
    checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  } as never);
}

describe('the re-probing reader is not the snapshot reader', () => {
  test('the snapshot reader returns the stale value unchanged', () => {
    staleConnected();
    // This is what getToolCtx used to call: no probe, no TTL, no freshness.
    expect(getEmbedderRuntimeStatus().status).toBe('connected');
  });

  test('the re-probing reader actually probes when the snapshot is stale', async () => {
    staleConnected();
    process.env.ORACLE_EMBEDDER_STATUS_TTL_MS = '1';

    let probed = false;
    const result = await readEmbedderRuntimeStatus({
      force: true,
      probe: async () => {
        probed = true;
        return setEmbedderRuntimeStatus({
          status: 'degraded',
          provider: 'ollama',
          reason: 'probe says the embedder is gone',
          checkedAt: new Date().toISOString(),
        } as never);
      },
    });

    expect(probed).toBe(true);
    expect(result.status).toBe('degraded');
  });

  test('a degraded probe result is what a later read sees — the stale green is gone', async () => {
    staleConnected();
    await readEmbedderRuntimeStatus({
      force: true,
      probe: async () =>
        setEmbedderRuntimeStatus({
          status: 'degraded',
          provider: 'ollama',
          reason: 'out of memory',
          checkedAt: new Date().toISOString(),
        } as never),
    });

    // The scenario from the report: the field must not still say "connected".
    expect(getEmbedderRuntimeStatus().status).toBe('degraded');
    expect(getEmbedderRuntimeStatus().reason).toContain('memory');
  });

  test('a fresh snapshot is reused rather than re-probed — the TTL is real', async () => {
    setEmbedderRuntimeStatus({
      status: 'connected',
      provider: 'ollama',
      checkedAt: new Date().toISOString(),
    } as never);
    process.env.ORACLE_EMBEDDER_STATUS_TTL_MS = '60000';

    let probed = false;
    const result = await readEmbedderRuntimeStatus({ probe: async () => { probed = true; throw new Error('should not run'); } });

    // Cheap on the hot path: a per-call probe would put a network round-trip in front of
    // every MCP tool invocation.
    expect(probed).toBe(false);
    expect(result.status).toBe('connected');
  });
});

describe('the MCP server reads the re-probing variant', () => {
  test('server.ts imports readEmbedderRuntimeStatus, not the snapshot reader', async () => {
    // A source-level assertion because the alternative is booting a full MCP server with a
    // real database and embedder. The distinction is one identifier, and this is the identifier.
    const source = await Bun.file(new URL('../../src/mcp/server.ts', import.meta.url)).text();
    expect(source).toContain('await readEmbedderRuntimeStatus()');
    expect(source).not.toContain('applyEmbedderStatus(getEmbedderRuntimeStatus())');
  });
});
