import { useEffect, useMemo, useState } from "react";
import { fetchJson } from "../lib/api-base";

type Raw = Record<string, unknown>;
type McpTool = { name: string; description: string; schema: unknown };

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizeTools(payload: unknown): McpTool[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Raw)?.tools)
      ? ((payload as Raw).tools as unknown[])
      : [];

  return list.map((item, index) => {
    const record = (item ?? {}) as Raw;
    return {
      name: text(record.name, `tool-${index + 1}`),
      description: text(record.description, "No description provided."),
      schema: record.inputSchema ?? record.input_schema ?? record.schema ?? {},
    };
  });
}

export default function McpToolBrowser() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson<unknown>("/api/mcp/tools")
      .then((payload) => setTools(normalizeTools(payload)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(q));
  }, [query, tools]);

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">MCP tool browser</h2>
          <p className="mt-1 text-sm text-gray-500">Live schemas from /api/mcp/tools.</p>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter tools…"
          className="rounded-lg border border-gray-700 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none"
        />
      </div>

      {loading && <p className="text-sm text-gray-500">Loading tools…</p>}
      {error && <p className="rounded-lg border border-red-900/70 bg-red-950/40 p-4 text-sm text-red-300">{error}</p>}
      {!loading && !error && visible.length === 0 && <p className="text-sm text-gray-500">No MCP tools found.</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visible.map((tool) => (
          <article key={tool.name} className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
            <h3 className="font-mono text-sm text-teal-300">{tool.name}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-400">{tool.description}</p>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-gray-500 hover:text-teal-300">
                schema
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-950 p-3 text-xs text-gray-300">
                {JSON.stringify(tool.schema, null, 2)}
              </pre>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
