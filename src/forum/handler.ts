import { eq, desc, and, sql } from 'drizzle-orm';
import { db, forumThreads, forumMessages } from '../db/index.ts';
import { currentTenantId, tenantIdForWrite } from '../middleware/tenant.ts';
import { getProjectContext } from '../server/context.ts';
import type {
  ForumThread,
  ForumMessage,
  ThreadStatus,
  MessageRole,
  OracleThreadInput,
  OracleThreadOutput,
} from './types.ts';

const threadStatuses = new Set<ThreadStatus>(['active', 'answered', 'pending', 'closed']);
const messageRoles = new Set<MessageRole>(['human', 'oracle', 'claude']);

function getProjectContext_(): string | undefined {
  const projectCtx = getProjectContext(process.cwd());
  return projectCtx && 'repo' in projectCtx ? projectCtx.repo : undefined;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} must not be blank`);
  return trimmed;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validThreadId(threadId: unknown): threadId is number {
  return typeof threadId === 'number' && Number.isSafeInteger(threadId) && threadId > 0;
}

function validateStatus(status: ThreadStatus): ThreadStatus {
  if (!threadStatuses.has(status)) throw new Error(`Invalid thread status: ${status}`);
  return status;
}

function validateRole(role: MessageRole): MessageRole {
  if (!messageRoles.has(role)) throw new Error(`Invalid message role: ${role}`);
  return role;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return Math.min(value, max);
}

function threadWhere(threadId: number) {
  const tenantId = currentTenantId();
  return tenantId ? and(eq(forumThreads.id, threadId), eq(forumThreads.tenantId, tenantId)) : eq(forumThreads.id, threadId);
}

function toForumThread(row: typeof forumThreads.$inferSelect): ForumThread {
  return {
    id: row.id,
    title: row.title,
    createdBy: row.createdBy || 'unknown',
    status: (row.status || 'active') as ThreadStatus,
    issueUrl: row.issueUrl || undefined,
    issueNumber: row.issueNumber ?? undefined,
    project: row.project || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    syncedAt: row.syncedAt ?? undefined,
  };
}

function toForumMessage(row: typeof forumMessages.$inferSelect): ForumMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as MessageRole,
    content: row.content,
    author: row.author || undefined,
    principlesFound: row.principlesFound ?? undefined,
    patternsFound: row.patternsFound ?? undefined,
    searchQuery: row.searchQuery || undefined,
    commentId: row.commentId ?? undefined,
    createdAt: row.createdAt,
  };
}

export function createThread(title: string, createdBy = 'user', project?: string): ForumThread {
  const now = Date.now();
  const cleanTitle = requiredText(title, 'Thread title');
  const cleanCreator = optionalText(createdBy) ?? 'user';
  const cleanProject = optionalText(project);
  const result = db.insert(forumThreads).values({
    title: cleanTitle,
    tenantId: tenantIdForWrite(),
    createdBy: cleanCreator,
    status: 'active',
    project: cleanProject || null,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: forumThreads.id }).get();
  return {
    id: result.id,
    title: cleanTitle,
    createdBy: cleanCreator,
    status: 'active',
    project: cleanProject,
    createdAt: now,
    updatedAt: now,
  };
}

export function getThread(threadId: number): ForumThread | null {
  if (!validThreadId(threadId)) return null;
  const row = db.select().from(forumThreads).where(threadWhere(threadId)).get();
  return row ? toForumThread(row) : null;
}

export function updateThreadStatus(threadId: number, status: ThreadStatus): boolean {
  validateStatus(status);
  if (!getThread(threadId)) return false;
  db.update(forumThreads).set({ status, updatedAt: Date.now() }).where(threadWhere(threadId)).run();
  return true;
}

export function listThreads(options: {
  status?: ThreadStatus;
  project?: string;
  limit?: number;
  offset?: number;
} = {}): { threads: ForumThread[]; total: number } {
  const { status, project } = options;
  const limit = boundedInteger(options.limit, 20, 1, 100, 'limit');
  const offset = boundedInteger(options.offset, 0, 0, 10_000, 'offset');
  const conditions = [];
  if (status) conditions.push(eq(forumThreads.status, validateStatus(status)));
  const cleanProject = optionalText(project);
  if (cleanProject) conditions.push(eq(forumThreads.project, cleanProject));
  const tenantId = currentTenantId();
  if (tenantId) conditions.push(eq(forumThreads.tenantId, tenantId));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
  const countResult = db.select({ count: sql<number>`count(*)` }).from(forumThreads).where(whereClause).get();
  const rows = db.select()
    .from(forumThreads)
    .where(whereClause)
    .orderBy(desc(forumThreads.updatedAt))
    .limit(limit)
    .offset(offset)
    .all();
  return { threads: rows.map(toForumThread), total: countResult?.count || 0 };
}

export function addMessage(
  threadId: number,
  role: MessageRole,
  content: string,
  options: { author?: string; principlesFound?: number; patternsFound?: number; searchQuery?: string } = {},
): ForumMessage {
  if (!getThread(threadId)) throw new Error(`Thread ${threadId} not found`);
  const now = Date.now();
  const cleanRole = validateRole(role);
  const cleanContent = requiredText(content, 'Message content');
  const cleanAuthor = optionalText(options.author);
  const cleanSearch = optionalText(options.searchQuery);
  const result = db.insert(forumMessages).values({
    threadId,
    role: cleanRole,
    content: cleanContent,
    author: cleanAuthor || null,
    principlesFound: options.principlesFound ?? null,
    patternsFound: options.patternsFound ?? null,
    searchQuery: cleanSearch || null,
    createdAt: now,
  }).returning({ id: forumMessages.id }).get();
  db.update(forumThreads).set({ updatedAt: now }).where(threadWhere(threadId)).run();
  return {
    id: result.id,
    threadId,
    role: cleanRole,
    content: cleanContent,
    author: cleanAuthor,
    principlesFound: options.principlesFound,
    patternsFound: options.patternsFound,
    searchQuery: cleanSearch,
    createdAt: now,
  };
}

export function getMessages(threadId: number): ForumMessage[] {
  if (!getThread(threadId)) return [];
  return db.select()
    .from(forumMessages)
    .where(eq(forumMessages.threadId, threadId))
    .orderBy(forumMessages.createdAt)
    .all()
    .map(toForumMessage);
}

export async function handleThreadMessage(input: OracleThreadInput): Promise<OracleThreadOutput> {
  const { message, threadId, title, role = 'human', model } = input;
  const cleanMessage = requiredText(message, 'Message content');
  const cleanRole = validateRole(role);
  const project = getProjectContext_();
  const baseAuthor = cleanRole === 'human' ? 'user' : optionalText(model) || 'claude';
  const author = project ? `${baseAuthor}@${project}` : baseAuthor;
  let thread: ForumThread;

  if (threadId !== undefined) {
    if (!validThreadId(threadId)) throw new Error('Invalid thread ID');
    const existing = getThread(threadId);
    if (!existing) throw new Error(`Thread ${threadId} not found`);
    thread = existing;
  } else {
    const threadTitle = optionalText(title)
      ?? cleanMessage.slice(0, 50) + (cleanMessage.length > 50 ? '...' : '');
    thread = createThread(threadTitle, author, project);
  }

  const userMessage = addMessage(thread.id, cleanRole, cleanMessage, { author });
  if (cleanRole === 'human' || cleanRole === 'claude') updateThreadStatus(thread.id, 'pending');
  const updatedThread = getThread(thread.id)!;
  return { threadId: thread.id, messageId: userMessage.id, status: updatedThread.status as ThreadStatus, issueUrl: updatedThread.issueUrl };
}

export function getFullThread(threadId: number): { thread: ForumThread; messages: ForumMessage[] } | null {
  const thread = getThread(threadId);
  return thread ? { thread, messages: getMessages(threadId) } : null;
}
