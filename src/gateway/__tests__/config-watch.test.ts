import { describe, it, expect } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { watchGatewayConfig, type GatewayConfig } from '../config.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('watchGatewayConfig', () => {
  it('fires onChange when the config file is created', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-watch-'));
    const calls: Array<GatewayConfig | null> = [];
    const stop = watchGatewayConfig(dir, (next) => calls.push(next));
    try {
      const cfg: GatewayConfig = {
        services: { vector: { url: 'http://localhost:9999', timeout: 5000 } },
        routes: [{ match: '/api/vector/**', service: 'vector', fallback: 'fts5' }],
      };
      fs.writeFileSync(path.join(dir, 'oracle-gateway.json'), JSON.stringify(cfg));
      await wait(450);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const last = calls[calls.length - 1];
      expect(last).not.toBeNull();
      expect(last!.services.vector.url).toBe('http://localhost:9999');
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT fire when the config write is a no-op', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-watch-'));
    const file = path.join(dir, 'oracle-gateway.json');
    const cfg: GatewayConfig = {
      services: { v: { url: 'http://localhost:1', timeout: 1000 } },
      routes: [],
    };
    fs.writeFileSync(file, JSON.stringify(cfg));
    const calls: Array<GatewayConfig | null> = [];
    const stop = watchGatewayConfig(dir, (next) => calls.push(next));
    try {
      // Identical content rewrite.
      fs.writeFileSync(file, JSON.stringify(cfg));
      await wait(450);
      expect(calls.length).toBe(0);
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps last good config when JSON becomes malformed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-watch-'));
    const file = path.join(dir, 'oracle-gateway.json');
    const cfg: GatewayConfig = {
      services: { v: { url: 'http://localhost:1', timeout: 1000 } },
      routes: [],
    };
    fs.writeFileSync(file, JSON.stringify(cfg));
    const calls: Array<GatewayConfig | null> = [];
    const stop = watchGatewayConfig(dir, (next) => calls.push(next));
    try {
      // Mid-edit syntax error: file exists but content is unparseable.
      // The watcher must NOT call onChange — last good state must hold.
      fs.writeFileSync(file, '{ not valid json');
      await wait(450);
      expect(calls.length).toBe(0);
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fires onChange(null) when the config file is deleted', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-watch-'));
    const file = path.join(dir, 'oracle-gateway.json');
    const cfg: GatewayConfig = {
      services: { v: { url: 'http://localhost:1', timeout: 1000 } },
      routes: [],
    };
    fs.writeFileSync(file, JSON.stringify(cfg));
    const calls: Array<GatewayConfig | null> = [];
    const stop = watchGatewayConfig(dir, (next) => calls.push(next));
    try {
      fs.unlinkSync(file);
      await wait(450);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[calls.length - 1]).toBeNull();
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stop() closes the watcher and prevents further callbacks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-gateway-watch-'));
    const calls: Array<GatewayConfig | null> = [];
    const stop = watchGatewayConfig(dir, (next) => calls.push(next));
    stop();
    try {
      fs.writeFileSync(
        path.join(dir, 'oracle-gateway.json'),
        JSON.stringify({ services: {}, routes: [] }),
      );
      await wait(450);
      expect(calls.length).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
