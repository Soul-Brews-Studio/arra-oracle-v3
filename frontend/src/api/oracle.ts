// Oracle API client
// Always use /api prefix (backend routes are under /api/*)
const API_BASE = '/api';

/** Strip project prefix from source_file for display (vault-indexed cross-project docs) */
export function stripProjectPrefix(sourceFile: string, project?: string): string {
  if (project && sourceFile.toLowerCase().startsWith(project.toLowerCase() + '/')) {
    return sourceFile.slice(project.length + 1);
  }
  return sourceFile;
}

/** Check if a doc is a cross-project vault doc */
export function isVaultDoc(sourceFile: string, project?: string): boolean {
  return !!project && sourceFile.toLowerCase().startsWith(project.toLowerCase() + '/');
}

export interface Document {
  id: string;
  type: 'principle' | 'learning' | 'retro';
  content: string;
  source_file: string;
  concepts: string[];
  project?: string;                       // ghq-style path (github.com/owner/repo)
  source?: 'fts' | 'vector' | 'hybrid';  // search source type
  score?: number;                         // relevance score 0-1
  created_at?: string;
}

export interface SearchResult {
  results: Document[];
  total: number;
  query: string;
}

export interface Stats {
  total: number;
  by_type?: {
    learning: number;
    principle: number;
    retro: number;
  };
  last_indexed?: string;
  is_stale?: boolean;
  vault_repo?: string;
  vector?: {
    enabled: boolean;
    count: number;
    collection: string;
  };
}

// Search the knowledge base
export async function search(
  query: string,
  type: string = 'all',
  limit: number = 20,
  mode: 'hybrid' | 'fts' | 'vector' = 'hybrid'
): Promise<SearchResult & { mode?: string; warning?: string }> {
  const params = new URLSearchParams({ q: query, type, limit: String(limit), mode });
  const res = await fetch(`${API_BASE}/search?${params}`);
  return res.json();
}

// List/browse documents
export async function list(type: string = 'all', limit: number = 20, offset: number = 0): Promise<{ results: Document[]; total: number }> {
  const params = new URLSearchParams({ type, limit: String(limit), offset: String(offset) });
  const res = await fetch(`${API_BASE}/list?${params}`);
  return res.json();
}

// Get stats
export async function getStats(): Promise<Stats> {
  const res = await fetch(`${API_BASE}/stats`);
  if (!res.ok) {
    throw new Error(`Server error: ${res.status}`);
  }
  return res.json();
}

// Get random wisdom
export async function reflect(): Promise<Document> {
  const res = await fetch(`${API_BASE}/reflect`);
  return res.json();
}

// Add new learning
export async function learn(pattern: string, concepts: string[]): Promise<{ success: boolean; id?: string }> {
  const res = await fetch(`${API_BASE}/learn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pattern, concepts })
  });
  return res.json();
}

// Get graph data
export async function getGraph(): Promise<{ nodes: any[]; links: any[] }> {
  const res = await fetch(`${API_BASE}/graph`);
  return res.json();
}

// Get full file content by source_file path
// project: ghq-style path (github.com/owner/repo) for cross-repo access
export async function getFile(filePath: string, project?: string): Promise<{ content: string; error?: string }> {
  const params = new URLSearchParams({ path: filePath });
  if (project) {
    params.append('project', project);
  }
  try {
    const res = await fetch(`${API_BASE}/file?${params}`);
    const content = await res.text();
    if (!res.ok) {
      // Include project info in error for debugging
      const location = project ? `${project}/${filePath}` : filePath;
      return { content: '', error: `File not found: ${location}` };
    }
    return { content };
  } catch (e) {
    return { content: '', error: 'Cannot connect to server' };
  }
}

// Get document by ID
export async function getDoc(id: string): Promise<Document & { error?: string }> {
  const res = await fetch(`${API_BASE}/doc/${encodeURIComponent(id)}`);
  return res.json();
}

// Get similar documents (vector nearest neighbors)
export async function getSimilar(docId: string, limit: number = 5): Promise<{ results: Document[]; docId: string }> {
  const params = new URLSearchParams({ id: docId, limit: String(limit) });
  const res = await fetch(`${API_BASE}/similar?${params}`);
  return res.json();
}

// Get knowledge map data (2D projection)
export interface MapDocument {
  id: string;
  type: string;
  source_file: string;
  concepts: string[];
  project: string | null;
  x: number;
  y: number;
  created_at: string | null;
}

export async function getMap(): Promise<{ documents: MapDocument[]; total: number }> {
  const res = await fetch(`${API_BASE}/map`);
  return res.json();
}

// Dashboard types
export interface DashboardSummary {
  documents: { total: number; by_type: Record<string, number> };
  concepts: { total: number; top: Array<{ name: string; count: number }> };
  activity: { consultations_7d: number; searches_7d: number; learnings_7d: number };
  health: { fts_status: string; last_indexed: string | null };
}

export interface DashboardActivity {
  consultations: Array<{ decision: string; principles_found: number; patterns_found: number; created_at: string }>;
  searches: Array<{ query: string; type: string; results_count: number; search_time_ms: number; created_at: string }>;
  learnings: Array<{ document_id: string; pattern_preview: string; source: string; concepts: string[]; created_at: string }>;
  days: number;
}

export interface DashboardGrowth {
  period: string;
  days: number;
  data: Array<{ date: string; documents: number; consultations: number; searches: number }>;
}

// Get dashboard summary
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const res = await fetch(`${API_BASE}/dashboard/summary`);
  return res.json();
}

// Get dashboard activity
export async function getDashboardActivity(days: number = 7): Promise<DashboardActivity> {
  const params = new URLSearchParams({ days: String(days) });
  const res = await fetch(`${API_BASE}/dashboard/activity?${params}`);
  return res.json();
}

// Get dashboard growth
export async function getDashboardGrowth(period: 'week' | 'month' | 'quarter' = 'week'): Promise<DashboardGrowth> {
  const params = new URLSearchParams({ period });
  const res = await fetch(`${API_BASE}/dashboard/growth?${params}`);
  return res.json();
}

// ============================================================================
// Auth API
// ============================================================================

export interface AuthStatus {
  authenticated: boolean;
  authEnabled: boolean;
  hasPassword: boolean;
  localBypass: boolean;
  isLocal: boolean;
}

export interface Settings {
  authEnabled: boolean;
  localBypass: boolean;
  hasPassword: boolean;
  vaultRepo?: string | null;
}

// Get auth status
export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch(`${API_BASE}/auth/status`);
  return res.json();
}

// Login
export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  return res.json();
}

// Logout
export async function logout(): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: 'POST'
  });
  return res.json();
}

// Get settings
export async function getSettings(): Promise<Settings> {
  const res = await fetch(`${API_BASE}/settings`);
  return res.json();
}

// Update settings
export interface UpdateSettingsParams {
  currentPassword?: string;
  newPassword?: string;
  removePassword?: boolean;
  authEnabled?: boolean;
  localBypass?: boolean;
}

export async function updateSettings(params: UpdateSettingsParams): Promise<Settings & { success?: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return res.json();
}
