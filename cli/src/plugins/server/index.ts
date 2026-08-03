import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";
import { ensureServerRunning, getServerStatus } from "../../../../src/ensure-server.ts";

const PORT = process.env.ORACLE_PORT || process.env.PORT || "47778";

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const sub = ctx.args[0] || "status";
  const json = ctx.args.includes("--json");

  if (sub === "status") {
    try {
      const res = await apiFetch("/api/health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as Record<string, any>;
      if (json) return { ok: true, output: JSON.stringify({ running: true, ...data }, null, 2) };
      return { ok: true, output: `Oracle server running on :${data.port} (${data.version})` };
    } catch {
      if (json) return { ok: true, output: JSON.stringify({ running: false, port: PORT }) };
      return { ok: true, output: `Oracle server not running (port ${PORT}).` };
    }
  }

  if (sub === "stop") {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/shutdown`, { method: "POST", signal: AbortSignal.timeout(5000) });
      if (json) return { ok: true, output: JSON.stringify({ stopped: true }) };
      return { ok: true, output: "Oracle server stopped." };
    } catch {
      if (json) return { ok: true, output: JSON.stringify({ stopped: false, reason: "not running or no /api/shutdown" }) };
      return { ok: true, output: "Server not running or /api/shutdown unavailable." };
    }
  }

  if (sub === "start") {
    // Delegate to ensureServerRunning: it cleans stale PID files, resolves an
    // absolute server path, refuses to claim success when the port is held by
    // an unhealthy process, and waits for real health before returning — so a
    // spawned child that dies on a bad cwd/env/port can never be reported as
    // started.
    const before = await getServerStatus();
    const ready = await ensureServerRunning({ timeout: 15000 });
    if (!ready) {
      const reason = `server did not become healthy on port ${PORT} (check the port, ${process.env.ORACLE_DATA_DIR ?? "~/.oracle"}/oracle-http.lock, and server logs)`;
      if (json) return { ok: false, error: JSON.stringify({ started: false, port: PORT, reason }) };
      return { ok: false, error: `Oracle server failed to start: ${reason}.` };
    }
    const alreadyRunning = before.healthy;
    if (json) return { ok: true, output: JSON.stringify({ started: true, alreadyRunning, port: PORT }) };
    return { ok: true, output: alreadyRunning ? `Oracle server already running on :${PORT}.` : `Oracle server started on :${PORT}.` };
  }

  return { ok: false, error: `Unknown subcommand: ${sub}. Use: start | stop | status` };
}
