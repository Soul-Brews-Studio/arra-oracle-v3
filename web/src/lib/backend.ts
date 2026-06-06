export interface SearchResult {
  id: string;
  content: string;
  score: number;
  type: string;
  concepts?: string[];
  created_at?: string;
}

export interface Learning {
  id: string;
  pattern: string;
  concepts?: string[];
  file_path?: string;
  created_at: string;
}

export interface TraceResult {
  query: string;
  chain: string[];
  related: SearchResult[];
}

export interface HealthResponse {
  status: string;
  server?: string;
  port?: number;
  oracle?: string;
}

export interface ReflectResponse {
  text: string;
  source?: string;
  type?: string;
}

export interface GraphResponse {
  nodes: Array<{ id: string; label?: string; type?: string }>;
  edges: Array<{ from: string; to: string; type?: string }>;
}

export interface ThreadSummary {
  id: number;
  title: string;
  status: string;
  message_count: number;
  created_at: string;
  issue_url?: string;
}

export interface ThreadListResponse {
  threads: ThreadSummary[];
  total: number;
}

export interface ThreadMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: ThreadMessage[];
}

export interface ConsultResponse {
  thread_id: number;
  message_id: number;
  status: string;
  oracle_response?: string;
  issue_url?: string;
}

export interface TraceSummary {
  id: string;
  query: string;
  project?: string;
  status?: string;
  created_at: string;
}

export interface TraceListResponse {
  traces: TraceSummary[];
  total: number;
}

export interface TraceDetail extends TraceSummary {
  dig_points?: Array<Record<string, unknown>>;
  notes?: string;
}

export interface TraceChainResponse {
  id: string;
  chain: TraceSummary[];
  direction: "up" | "down" | "both";
}

export interface Supersession {
  id: number;
  old_path: string;
  old_title?: string;
  new_path: string;
  new_title?: string;
  reason?: string;
  superseded_at: string;
  project?: string;
}

export interface SupersedeListResponse {
  supersessions: Supersession[];
  total: number;
}

export interface SupersedeChainResponse {
  path: string;
  chain: Supersession[];
}

export interface ScheduleItem {
  id: number;
  title: string;
  when?: string;
  status?: string;
  project?: string;
}

export interface ScheduleResponse {
  items: ScheduleItem[];
  total?: number;
}

export interface BackendClient {
  search(query: string): Promise<SearchResult[]>;
  learn(pattern: string, concepts?: string[], source?: string): Promise<Learning>;
  list(type?: string, limit?: number): Promise<SearchResult[]>;
  trace(query: string): Promise<TraceResult>;
  read(file: string): Promise<string>;
  concepts(): Promise<string[]>;
  stats(): Promise<Record<string, unknown>>;
  health(): Promise<HealthResponse>;
  reflect(): Promise<ReflectResponse>;
  consult(q: string, threadId?: number): Promise<ConsultResponse>;
  graph(): Promise<GraphResponse>;
  threads(): Promise<ThreadListResponse>;
  thread(id: number): Promise<ThreadDetail>;
  sendMessage(threadId: number, message: string): Promise<ConsultResponse>;
  traces(): Promise<TraceListResponse>;
  traceGet(id: string): Promise<TraceDetail>;
  traceChain(id: string): Promise<TraceChainResponse>;
  superseded(): Promise<SupersedeListResponse>;
  supersedeChain(path: string): Promise<SupersedeChainResponse>;
  schedule(): Promise<ScheduleResponse>;
}

export class MockBackend implements BackendClient {
  async search(query: string): Promise<SearchResult[]> {
    return [
      { id: "mock-1", content: `Mock result for: ${query}`, score: 0.95, type: "pattern", concepts: ["oracle", "memory"] },
      { id: "mock-2", content: "Hybrid search combines semantic + keyword matching", score: 0.87, type: "concept" },
    ];
  }

  async learn(pattern: string, concepts?: string[], _source?: string): Promise<Learning> {
    return { id: "mock-learn-1", pattern, concepts, file_path: "ψ/mock/pattern.md", created_at: new Date().toISOString() };
  }

  async list(_type?: string, _limit?: number): Promise<SearchResult[]> {
    return [
      { id: "mock-list-1", content: "Oracle memory layer pattern", score: 1, type: "pattern" },
      { id: "mock-list-2", content: "Plugin system architecture", score: 1, type: "concept" },
    ];
  }

  async trace(query: string): Promise<TraceResult> {
    return { query, chain: ["oracle", "memory", "pattern"], related: await this.search(query) };
  }

  async read(_file: string): Promise<string> {
    return "# Mock file content\n\nThis is a mock response from MockBackend.";
  }

  async concepts(): Promise<string[]> {
    return ["oracle", "memory", "pattern", "plugin", "search", "learn"];
  }

  async stats(): Promise<Record<string, unknown>> {
    return { total: 42, patterns: 12, concepts: 6, backend: "mock" };
  }

  async health(): Promise<HealthResponse> {
    return { status: "ok", server: "mock", port: 0, oracle: "mock" };
  }

  async reflect(): Promise<ReflectResponse> {
    return { text: "Nothing is deleted. Patterns over intentions.", source: "mock", type: "principle" };
  }

  async consult(q: string, threadId?: number): Promise<ConsultResponse> {
    return { thread_id: threadId ?? 1, message_id: 1, status: "open", oracle_response: `Mock reply to: ${q}` };
  }

  async graph(): Promise<GraphResponse> {
    return { nodes: [{ id: "oracle", label: "oracle" }], edges: [] };
  }

  async threads(): Promise<ThreadListResponse> {
    return { threads: [], total: 0 };
  }

  async thread(id: number): Promise<ThreadDetail> {
    return {
      thread: { id, title: "Mock thread", status: "open", message_count: 0, created_at: new Date().toISOString() },
      messages: [],
    };
  }

  async sendMessage(threadId: number, message: string): Promise<ConsultResponse> {
    return { thread_id: threadId, message_id: 1, status: "open", oracle_response: `Mock reply to: ${message}` };
  }

  async traces(): Promise<TraceListResponse> {
    return { traces: [], total: 0 };
  }

  async traceGet(id: string): Promise<TraceDetail> {
    return { id, query: "mock", status: "raw", created_at: new Date().toISOString(), dig_points: [] };
  }

  async traceChain(id: string): Promise<TraceChainResponse> {
    return { id, chain: [], direction: "both" };
  }

  async superseded(): Promise<SupersedeListResponse> {
    return { supersessions: [], total: 0 };
  }

  async supersedeChain(path: string): Promise<SupersedeChainResponse> {
    return { path, chain: [] };
  }

  async schedule(): Promise<ScheduleResponse> {
    return { items: [], total: 0 };
  }
}

function storedApiToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("ARRA_API_TOKEN") || window.localStorage.getItem("NEO_ARRA_API_TOKEN");
}

export class RealBackend implements BackendClient {
  constructor(private baseUrl: string, private token: string | null = storedApiToken()) {}

  private headers(init?: HeadersInit): HeadersInit {
    return this.token
      ? { ...(init as Record<string, string> | undefined), Authorization: `Bearer ${this.token}` }
      : (init ?? {});
  }

  private async post<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/${tool}`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = query
      ? "?" + Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join("&")
      : "";
    const res = await fetch(`${this.baseUrl}${path}${qs}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  async search(query: string): Promise<SearchResult[]> {
    const response = await this.get<{ results: SearchResult[] }>("/api/search", {
      q: query,
      mode: "fts",
      limit: 20,
    });
    return response.results;
  }

  async learn(pattern: string, concepts?: string[], source?: string): Promise<Learning> {
    return this.post("arra_learn", { pattern, concepts, source });
  }

  async list(type?: string, limit?: number): Promise<SearchResult[]> {
    const response = await this.get<{ results: SearchResult[] }>("/api/list", {
      type: type ?? "all",
      limit: limit ?? 20,
      group: "false",
    });
    return response.results;
  }

  async trace(query: string): Promise<TraceResult> {
    return this.post("arra_trace", { query });
  }

  async read(file: string): Promise<string> {
    return this.post("arra_read", { file });
  }

  async concepts(): Promise<string[]> {
    return this.post("arra_concepts", {});
  }

  async stats(): Promise<Record<string, unknown>> {
    return this.get("/api/stats");
  }

  async health(): Promise<HealthResponse> {
    return this.get("/api/health");
  }

  async reflect(): Promise<ReflectResponse> {
    return this.get("/api/reflect");
  }

  async consult(q: string, threadId?: number): Promise<ConsultResponse> {
    const res = await fetch(`${this.baseUrl}/api/thread`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ message: q, thread_id: threadId, role: "human" }),
    });
    if (!res.ok) throw new Error(`Backend error ${res.status}: ${await res.text()}`);
    return res.json() as Promise<ConsultResponse>;
  }

  async graph(): Promise<GraphResponse> {
    return this.get("/api/graph");
  }

  async threads(): Promise<ThreadListResponse> {
    return this.get("/api/threads");
  }

  async thread(id: number): Promise<ThreadDetail> {
    return this.get(`/api/thread/${id}`);
  }

  async sendMessage(threadId: number, message: string): Promise<ConsultResponse> {
    return this.consult(message, threadId);
  }

  async traces(): Promise<TraceListResponse> {
    return this.get("/api/traces");
  }

  async traceGet(id: string): Promise<TraceDetail> {
    return this.get(`/api/traces/${encodeURIComponent(id)}`);
  }

  async traceChain(id: string): Promise<TraceChainResponse> {
    return this.get(`/api/traces/${encodeURIComponent(id)}/chain`);
  }

  async superseded(): Promise<SupersedeListResponse> {
    return this.get("/api/supersede");
  }

  async supersedeChain(path: string): Promise<SupersedeChainResponse> {
    return this.get(`/api/supersede/chain/${encodeURIComponent(path)}`);
  }

  async schedule(): Promise<ScheduleResponse> {
    return this.get("/api/schedule");
  }
}

let _client: BackendClient | null = null;

export function createBackendClient(): BackendClient {
  // Check env var first
  const envUrl = import.meta.env.PUBLIC_BACKEND_URL;
  if (envUrl) return new RealBackend(envUrl);

  // Check ?api= query param or persisted home-page connection in browser context
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const apiUrl = params.get("api") || window.localStorage.getItem("NEO_ARRA_API");
    if (apiUrl) return new RealBackend(apiUrl.replace(/\/+$/, ""));
  }

  return new MockBackend();
}

export function getBackendClient(): BackendClient {
  if (!_client) _client = createBackendClient();
  return _client;
}
