import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";
import fs from "fs";
import os from "os";
import path from "path";
import { createHmac } from "crypto";

const PORT = 47790;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_SECRET = "test-vault-secret-key-123456789";

let serverProcess: Subprocess | null = null;
let dataDir = "";

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return true;
    } catch { /* not ready */ }
    await Bun.sleep(500);
  }
  return false;
}

function signToken(agent: string, scope: string, expiresAtMs: number, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const expires_at = new Date(expiresAtMs).toISOString();
  const payload = {
    agent,
    scope,
    expires_at,
    exp: Math.floor(expiresAtMs / 1000)
  };

  const base64urlEncode = (str: string) => Buffer.from(str).toString('base64url');
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac('sha256', secret)
    .update(signatureInput)
    .digest('base64url');

  return `${signatureInput}.${signature}`;
}

describe("HTTP Credential Vault Route", () => {
  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-vault-test-"));
    const cwd = path.resolve(import.meta.dir, "../..");
    serverProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ORACLE_PORT: String(PORT),
        ORACLE_DATA_DIR: dataDir,
        ORACLE_CHROMA_TIMEOUT: "3000",
        ORACLE_VAULT_SECRET: TEST_SECRET,
      },
    });
    const ready = await waitForServer();
    if (!ready) {
      let stderr = "";
      if (serverProcess.stderr) {
        const reader = serverProcess.stderr.getReader();
        try {
          const { value } = await reader.read();
          if (value) stderr = new TextDecoder().decode(value);
        } catch { /* ignore */ }
      }
      throw new Error(`Server failed to start on ${PORT}.\nstderr: ${stderr}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
    }
    if (dataDir && fs.existsSync(dataDir)) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        await Bun.sleep(1000);
        try {
          fs.rmSync(dataDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    }
  });

  test("POST /api/credentials/issue accepts {agent, scope} and returns a token", async () => {
    const response = await fetch(`${BASE_URL}/api/credentials/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "test-agent",
        scope: "read:all"
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("expires_at");
    expect(typeof body.token).toBe("string");
    expect(typeof body.expires_at).toBe("string");

    // Validate date format
    expect(isNaN(Date.parse(body.expires_at))).toBe(false);
  });

  test("GET /api/credentials/verify verifies issued token", async () => {
    // 1. Issue a token
    const issueRes = await fetch(`${BASE_URL}/api/credentials/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "my-agent",
        scope: "write:docs"
      })
    });
    const { token, expires_at } = await issueRes.json();

    // 2. Verify the token
    const verifyRes = await fetch(`${BASE_URL}/api/credentials/verify?token=${token}`);
    expect(verifyRes.status).toBe(200);

    const body = await verifyRes.json();
    expect(body).toEqual({
      valid: true,
      agent: "my-agent",
      scope: "write:docs",
      expires_at
    });
  });

  test("GET /api/credentials/verify returns valid: false for tampered token", async () => {
    const issueRes = await fetch(`${BASE_URL}/api/credentials/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "my-agent",
        scope: "write:docs"
      })
    });
    const { token } = await issueRes.json();

    // Tamper with the signature part (last part after second dot)
    const parts = token.split('.');
    parts[2] = parts[2].substring(0, parts[2].length - 1) + (parts[2].endsWith('a') ? 'b' : 'a');
    const tamperedToken = parts.join('.');

    const verifyRes = await fetch(`${BASE_URL}/api/credentials/verify?token=${tamperedToken}`);
    expect(verifyRes.status).toBe(200);

    const body = await verifyRes.json();
    expect(body).toEqual({
      valid: false,
      agent: null,
      scope: null,
      expires_at: null
    });
  });

  test("GET /api/credentials/verify returns valid: false for expired token", async () => {
    // Generate token expiring 10 seconds in the past
    const expiredToken = signToken("expired-agent", "some-scope", Date.now() - 10000, TEST_SECRET);

    const verifyRes = await fetch(`${BASE_URL}/api/credentials/verify?token=${expiredToken}`);
    expect(verifyRes.status).toBe(200);

    const body = await verifyRes.json();
    expect(body).toEqual({
      valid: false,
      agent: null,
      scope: null,
      expires_at: null
    });
  });

  test("GET /api/credentials/verify returns valid: false for invalid token format", async () => {
    const verifyRes = await fetch(`${BASE_URL}/api/credentials/verify?token=not-a-token`);
    expect(verifyRes.status).toBe(200);

    const body = await verifyRes.json();
    expect(body).toEqual({
      valid: false,
      agent: null,
      scope: null,
      expires_at: null
    });
  });
});

describe("HTTP Credential Vault Route with missing ORACLE_VAULT_SECRET", () => {
  let unsetServerProcess: Subprocess | null = null;
  let unsetDataDir = "";
  const unsetPort = 47791;
  const unsetBaseUrl = `http://localhost:${unsetPort}`;

  beforeAll(async () => {
    unsetDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-vault-unset-test-"));
    const cwd = path.resolve(import.meta.dir, "../..");
    
    // Spawn server with ORACLE_VAULT_SECRET deleted from env
    const testEnv = { ...process.env };
    delete testEnv.ORACLE_VAULT_SECRET;

    unsetServerProcess = Bun.spawn(["bun", "run", "src/server.ts"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...testEnv,
        ORACLE_PORT: String(unsetPort),
        ORACLE_DATA_DIR: unsetDataDir,
        ORACLE_CHROMA_TIMEOUT: "3000",
      },
    });

    // Helper wait function for this specific instance
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${unsetBaseUrl}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch { /* not ready */ }
      await Bun.sleep(500);
    }
    if (!ready) {
      let stderr = "";
      if (unsetServerProcess.stderr) {
        const reader = unsetServerProcess.stderr.getReader();
        try {
          const { value } = await reader.read();
          if (value) stderr = new TextDecoder().decode(value);
        } catch { /* ignore */ }
      }
      throw new Error(`Server with unset secret failed to start on ${unsetPort}.\nstderr: ${stderr}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (unsetServerProcess) {
      unsetServerProcess.kill();
      await unsetServerProcess.exited;
    }
    if (unsetDataDir && fs.existsSync(unsetDataDir)) {
      try {
        fs.rmSync(unsetDataDir, { recursive: true, force: true });
      } catch {
        await Bun.sleep(1000);
        try {
          fs.rmSync(unsetDataDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }
    }
  });

  test("POST /api/credentials/issue returns 500 when ORACLE_VAULT_SECRET is unset", async () => {
    const response = await fetch(`${unsetBaseUrl}/api/credentials/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: "test-agent",
        scope: "read:all"
      })
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("ORACLE_VAULT_SECRET is not configured");
  });

  test("GET /api/credentials/verify returns 500 when ORACLE_VAULT_SECRET is unset", async () => {
    const response = await fetch(`${unsetBaseUrl}/api/credentials/verify?token=some-token`);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("ORACLE_VAULT_SECRET is not configured");
  });
});
