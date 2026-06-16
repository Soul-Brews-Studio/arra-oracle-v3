import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isVectorServerEntrypoint, resolveVectorUrl } from '../../config.ts';

describe('VECTOR_URL routing guard', () => {
  const originalDataDir = process.env.ORACLE_DATA_DIR;

  afterEach(() => {
    if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
    else delete process.env.ORACLE_DATA_DIR;
  });

  test('core server honors VECTOR_URL', () => {
    expect(
      resolveVectorUrl({ VECTOR_URL: 'http://127.0.0.1:8081' }, ['bun', 'src/server.ts']),
    ).toBe('http://127.0.0.1:8081');
  });

  test('vector server env flag disables inherited VECTOR_URL', () => {
    expect(
      resolveVectorUrl(
        { VECTOR_URL: 'http://127.0.0.1:8081', ORACLE_VECTOR_SERVER: '1' },
        ['bun', 'src/server.ts'],
      ),
    ).toBe('');
  });

  test('direct vector-server entrypoint disables inherited VECTOR_URL', () => {
    expect(isVectorServerEntrypoint('/app/src/vector-server.ts')).toBe(true);
    expect(
      resolveVectorUrl({ VECTOR_URL: 'http://127.0.0.1:8081' }, ['bun', '/app/src/vector-server.ts']),
    ).toBe('');
  });
  test('core server can read durable vectorProxyUrl from vector-server.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-url-config-'));
    try {
      process.env.ORACLE_DATA_DIR = tmp;
      fs.writeFileSync(
        path.join(tmp, 'vector-server.json'),
        JSON.stringify({ vectorProxyUrl: 'https://vectors.example.test/' }),
      );
      expect(resolveVectorUrl({ ORACLE_DATA_DIR: tmp }, ['bun', 'src/server.ts'])).toBe('https://vectors.example.test/');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('env VECTOR_URL overrides durable vectorProxyUrl config', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-url-config-'));
    try {
      process.env.ORACLE_DATA_DIR = tmp;
      fs.writeFileSync(
        path.join(tmp, 'vector-server.json'),
        JSON.stringify({ vectorProxyUrl: 'https://vectors.example.test' }),
      );
      expect(
        resolveVectorUrl({ VECTOR_URL: 'http://127.0.0.1:8081', ORACLE_DATA_DIR: tmp }, ['bun', 'src/server.ts']),
      ).toBe('http://127.0.0.1:8081');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('durable vector config accepts legacy vectorUrl when http(s)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-url-config-'));
    try {
      process.env.ORACLE_DATA_DIR = tmp;
      fs.writeFileSync(
        path.join(tmp, 'vector-server.json'),
        JSON.stringify({ vectorUrl: ' http://127.0.0.1:8081/api/vector ' }),
      );
      expect(resolveVectorUrl({ ORACLE_DATA_DIR: tmp }, ['bun', 'src/server.ts'])).toBe('http://127.0.0.1:8081/api/vector');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('durable vector config ignores invalid or non-http URLs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-url-config-'));
    try {
      process.env.ORACLE_DATA_DIR = tmp;
      fs.writeFileSync(path.join(tmp, 'vector-server.json'), JSON.stringify({ vectorProxyUrl: 'file:///tmp/vector.sock' }));
      expect(resolveVectorUrl({ ORACLE_DATA_DIR: tmp }, ['bun', 'src/server.ts'])).toBe('');
      fs.writeFileSync(path.join(tmp, 'vector-server.json'), JSON.stringify({ vectorProxyUrl: 'not a url' }));
      expect(resolveVectorUrl({ ORACLE_DATA_DIR: tmp }, ['bun', 'src/server.ts'])).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
