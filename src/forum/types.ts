/**
 * Oracle Forum Types
 *
 * DB-first discussion threads with GitHub Issue mirroring.
 * Oracle auto-answers from knowledge base, logs unanswered for later.
 */

// ============================================================================
// Thread & Message Types (DB-first)
// ============================================================================

export type ThreadStatus = 'active' | 'answered' | 'pending' | 'closed';
export type MessageRole = 'human' | 'oracle' | 'claude';

export interface ForumThread {
  id: number;
  title: string;
  createdBy: string;
  status: ThreadStatus;
  issueUrl?: string;      // GitHub mirror (optional)
  issueNumber?: number;
  project?: string;       // Which project context
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;      // Last GitHub sync
}

export interface ForumMessage {
  id: number;
  threadId: number;
  role: MessageRole;
  content: string;
  author?: string;        // GitHub username or "oracle"

  // Oracle response metadata
  principlesFound?: number;
  patternsFound?: number;
  searchQuery?: string;

  // GitHub mirror
  commentId?: number;     // GitHub comment ID if synced

  createdAt: number;
}

// ============================================================================
// GitHub URL Utilities
// ============================================================================

export interface ParsedIssueUrl {
  owner: string;
  repo: string;
  issueNumber: number;
  url: string;
}

function cleanUrlPart(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be blank`);
  return encodeURIComponent(trimmed);
}

export function parseIssueUrl(url: string): ParsedIssueUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (parsed.hostname.toLowerCase() !== 'github.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length !== 4 || parts[2] !== 'issues') return null;
  if (!/^[1-9]\d*$/.test(parts[3])) return null;
  const issueNumber = Number(parts[3]);
  if (!Number.isSafeInteger(issueNumber)) return null;
  return {
    owner: decodeURIComponent(parts[0]),
    repo: decodeURIComponent(parts[1]),
    issueNumber,
    url
  };
}

export function buildIssueUrl(owner: string, repo: string, issueNumber: number): string {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new Error('issueNumber must be a positive safe integer');
  }
  return `https://github.com/${cleanUrlPart(owner, 'owner')}/${cleanUrlPart(repo, 'repo')}/issues/${issueNumber}`;
}

// ============================================================================
// MCP Tool Interfaces
// ============================================================================

// Start new thread or add to existing
export interface OracleThreadInput {
  message: string;
  threadId?: number;      // If continuing existing thread
  title?: string;         // For new threads
  role?: MessageRole;     // Default: 'human'
  model?: string;         // e.g., 'opus', 'sonnet' for Claude calls
}

export interface OracleThreadOutput {
  threadId: number;
  messageId: number;
  oracleResponse?: {
    content: string;
    principlesFound: number;
    patternsFound: number;
  };
  status: ThreadStatus;
  issueUrl?: string;
}

// Sync thread to GitHub Issue
export interface OracleSyncInput {
  threadId: number;
  createIssue?: boolean;  // Create new issue if not exists
}

export interface OracleSyncOutput {
  synced: boolean;
  issueUrl?: string;
  messagesSync: number;
}

// List threads
export interface OracleListThreadsInput {
  status?: ThreadStatus;
  limit?: number;
  offset?: number;
}

export interface OracleListThreadsOutput {
  threads: Array<{
    id: number;
    title: string;
    status: ThreadStatus;
    messageCount: number;
    lastMessage: string;
    createdAt: string;
    issueUrl?: string;
  }>;
  total: number;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ForumConfig {
  defaultRepo: string;
  autoAnswer: boolean;      // Oracle auto-responds to questions
  autoSync: boolean;        // Auto-sync to GitHub
  labels: {
    question: string;
    answered: string;
    pending: string;
  };
}

export const DEFAULT_FORUM_CONFIG: ForumConfig = {
  defaultRepo: process.env.ORACLE_FORUM_REPO || '',
  autoAnswer: true,
  autoSync: false,  // Manual sync by default
  labels: {
    question: 'oracle-thread',
    answered: 'oracle-answered',
    pending: 'oracle-pending'
  }
};
