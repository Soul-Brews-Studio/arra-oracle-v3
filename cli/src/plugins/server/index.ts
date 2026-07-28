import type { InvokeContext, InvokeResult } from "../../plugin/types.ts";
import { apiFetch } from "../../lib/api.ts";

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
    const { spawn } = await import("child_process");
    const child = spawn("bun", ["src/server.ts"], {
      cwd: process.env.ORACLE_REPO_ROOT || process.cwd(),
      detached: true, stdio: "ignore",
    });
    child.unref();
    if (json) return { ok: true, output: JSON.stringify({ started: true, pid: child.pid, port: PORT }) };
    return { ok: true, output: `Oracle server starting (PID ${child.pid}, port ${PORT}).` };
  }

  return { ok: false, error: `Unknown subcommand: ${sub}. Use: start | stop | status` };
}
