import { useMemo, useState } from "react";
import { ApiError, fetchJson } from "../lib/api-base";

type Raw = Record<string, unknown>;
type VectorResult = {
  id: string;
  title: string;
  content: string;
  score?: number;
  model?: string;
  type?: string;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function toResults(payload: unknown): VectorResult[] {
  const raw = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Raw)?.results)
      ? ((payload as Raw).results as unknown[])
      : [];

  return raw.map((item, index) => {
    const record = (item ?? {}) as Raw;
    const id = text(record.id, `result-${index + 1}`);
    const title = text(record.title, text(record.source_file, id));
    const content = text(record.content, text(record.snippet, "No preview returned."));
    const score = typeof record.score === "number" ? record.score : undefined;
    return { id, title, content, score, model: text(record.model), type: text(record.type) };
  });
}

async function searchVector(query: string): Promise<VectorResult[]> {
  try {
    const payload = await fetchJson<unknown>("/api/vector/search", {
      method: "POST",
      body: JSON.stringify({ query, q: query, limit: 10 }),
    });
    return toResults(payload);
  } catch (err) {
    if (!(err instanceof ApiError) || ![404, 405, 501].includes(err.status)) throw err;
    const qs = new URLSearchParams({ q: query, query, limit: "10" });
    return toResults(await fetchJson<unknown>(`/api/vector/search?${qs}`));
  }
}

export default function VectorSearchWidget() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VectorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const countLabel = useMemo(() => {
    if (loading) return "Searching vector index…";
    if (!results.length) return "No vector results yet.";
    return `${results.length} vector result${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError("");
    try {
      setResults(await searchVector(q));
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search vector memory…"
          className="flex-1 rounded-lg border border-gray-700 bg-gray-900/80 px-4 py-2.5 text-gray-100 placeholder-gray-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg bg-teal-500 px-6 py-2.5 font-semibold text-gray-950 transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Searching…" : "Vector search"}
        </button>
      </form>

      <div className="text-sm text-gray-500">{countLabel}</div>
      {error && <p className="rounded-lg border border-red-900/70 bg-red-950/40 p-4 text-sm text-red-300">{error}</p>}

      <div className="space-y-3">
        {results.map((result) => (
          <article key={result.id} className="rounded-xl border border-gray-800 bg-gray-900/80 p-5">
            <div className="mb-2 flex items-start justify-between gap-3">
              <h2 className="break-all font-mono text-sm text-teal-300">{result.title}</h2>
              {typeof result.score === "number" && (
                <span className="shrink-0 rounded-full bg-teal-900/60 px-2 py-0.5 text-xs font-semibold text-teal-200">
                  {Math.round(result.score * 100)}%
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-gray-400">{result.content.slice(0, 280)}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
              {result.type && <span>type: {result.type}</span>}
              {result.model && <span>model: {result.model}</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
