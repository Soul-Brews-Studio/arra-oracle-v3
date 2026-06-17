import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetCpuCapabilityCacheForTests } from '../cpu-capabilities.ts';
import { getVectorRuntimeStatus } from '../runtime-status.ts';

const original = {
  forceAvx: process.env.ARRA_FORCE_AVX,
};

afterEach(() => {
  if (original.forceAvx === undefined) delete process.env.ARRA_FORCE_AVX;
  else process.env.ARRA_FORCE_AVX = original.forceAvx;
  resetCpuCapabilityCacheForTests();
});

describe('vector runtime status', () => {
  test('reports proxied when VECTOR_URL is configured', () => {
    const status = getVectorRuntimeStatus({ env: { VECTOR_URL: 'http://127.0.0.1:48080' }, argv: ['bun', 'src/index.ts'] });
    expect(status.vectorMode).toBe('proxied');
    expect(status.vectorUrl).toBe('http://127.0.0.1:48080');
  });

  test('reports proxied when storage-tier proxy endpoint is configured', () => {
    const status = getVectorRuntimeStatus({ env: { ORACLE_PROXY_VECTOR_URL: 'http://127.0.0.1:48081' }, argv: ['bun', 'src/index.ts'] });
    expect(status.vectorMode).toBe('proxied');
    expect(status.vectorUrl).toBe('http://127.0.0.1:48081');
  });

  test('reports disabled when local native vector is gated off', () => {
    process.env.ARRA_FORCE_AVX = '0';
    resetCpuCapabilityCacheForTests();

    const status = getVectorRuntimeStatus({
      env: {},
      localConfig: { type: 'lancedb', collectionName: 'oracle_knowledge_bge_m3', dataPath: '/tmp/missing.lancedb' },
    });

    expect(status.vectorMode).toBe('disabled');
    expect(status.vectorDisabledReason).toContain('CPU lacks AVX');
  });

  test('reports disabled when local vector index is missing', () => {
    process.env.ARRA_FORCE_AVX = '1';
    resetCpuCapabilityCacheForTests();

    const status = getVectorRuntimeStatus({
      env: {},
      localConfig: { type: 'lancedb', collectionName: 'oracle_knowledge_bge_m3', dataPath: '/tmp/arra-missing-vector-index' },
    });

    expect(status.vectorMode).toBe('disabled');
    expect(status.vectorDisabledReason).toMatch(/LanceDB directory is missing|index not found/);
  });

  test('reports embedded when local LanceDB collection exists', () => {
    process.env.ARRA_FORCE_AVX = '1';
    resetCpuCapabilityCacheForTests();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-mode-'));
    fs.mkdirSync(path.join(dir, 'oracle_knowledge_bge_m3.lance'), { recursive: true });
    try {
      const status = getVectorRuntimeStatus({
        env: {},
        localConfig: { type: 'lancedb', collectionName: 'oracle_knowledge_bge_m3', dataPath: dir },
      });
      expect(status.vectorMode).toBe('embedded');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
