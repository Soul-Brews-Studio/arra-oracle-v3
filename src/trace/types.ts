/**
 * Trace Log Types
 * Issue #17: feat: Trace Log — Make discoveries traceable and diggable
 */

// Dig Point Types
export interface FoundFile {
  path: string;
  type: 'learning' | 'retro' | 'resonance' | 'other';
  matchReason?: string;
  confidence?: 'high' | 'medium' | 'low';
}

export interface FoundCommit {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  filesChanged?: number;
  matchReason?: string;
}

export interface FoundIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  url?: string;
  matchReason?: string;
}

// Input Types
export interface CreateTraceInput {
  query: string;
  queryType?: 'general' | 'project' | 'pattern' | 'evolution';
  foundFiles?: FoundFile[];
  foundCommits?: FoundCommit[];
  foundIssues?: FoundIssue[];
  foundRetrospectives?: string[];
  foundLearnings?: string[];
  foundResonance?: string[];
  scope?: 'project' | 'cross-project' | 'human';
  parentTraceId?: string;
  project?: string;
  sessionId?: string;
  agentCount?: number;
  durationMs?: number;
}

export interface ListTracesInput {
  query?: string;
  project?: string;
  status?: 'raw' | 'reviewed' | 'distilling' | 'distilled';
  depth?: number;
  limit?: number;
  offset?: number;
}

export interface GetTraceInput {
  traceId: string;
  includeChain?: boolean;
}

export interface DistillTraceInput {
  traceId: string;
  awakening: string;
  promoteToLearning?: boolean;
  oracle?: string;
  theme?: string;
  concepts?: string[];
  source?: string;
}

// Output Types
export interface TraceRecord {
  id: number;
  traceId: string;
  query: string;
  queryType: string;
  foundFiles: FoundFile[];
  foundCommits: FoundCommit[];
  foundIssues: FoundIssue[];
  foundRetrospectives: string[];
  foundLearnings: string[];
  foundResonance: string[];
  fileCount: number;
  commitCount: number;
  issueCount: number;
  depth: number;
  parentTraceId: string | null;
  childTraceIds: string[];
  prevTraceId: string | null;
  nextTraceId: string | null;
  scope: string;
  project: string | null;
  sessionId: string | null;
  agentCount: number;
  durationMs: number | null;
  status: string;
  awakening: string | null;
  distilledToId: string | null;
  distilledAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TraceSummary {
  traceId: string;
  query: string;
  scope: string;
  depth: number;
  fileCount: number;
  commitCount: number;
  issueCount: number;
  status: string;
  hasAwakening: boolean;
  createdAt: number;
}

export interface CreateTraceResult {
  success: boolean;
  traceId: string;
  depth: number;
  summary: {
    fileCount: number;
    commitCount: number;
    issueCount: number;
    totalDigPoints: number;
  };
}

export interface ListTracesResult {
  traces: TraceSummary[];
  total: number;
  hasMore: boolean;
}

export interface TraceChainResult {
  chain: TraceSummary[];
  totalDepth: number;
  hasAwakening: boolean;
  awakeningTraceId?: string;
}
