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

function getProjectContext_(): string | undefined {
  const projectCtx = getProjectContext(process.cwd());
  return projectCtx && 'repo' in projectCtx ? projectCtx.repo : undefined;
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
    issueNumber: row.issueNumber || undefined,
    project: row.project || undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    syncedAt: row.syncedAt || undefined,
  };
}

function toForumMessage(row: typeof forumMessages.$inferSelect): ForumMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as MessageRole,
    content: row.content,
    author: row.author || undefined,
    principlesFound: row.principlesFound || undefined,
    patternsFound: row.patternsFound || undefined,
    searchQuery: row.searchQuery || undefined,
    commentId: row.commentId || undefined,
    createdAt: row.createdAt,
  };
}

export function createThread(title: string, createdBy = 'user', project?: string): ForumThread {
  const now = Date.now();
  const result = db.insert(forumThreads).values({
    title,
    tenantId: tenantIdForWrite(),
    createdBy,
    status: 'active',
    project: project || null,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: forumThreads.id }).get();
  return { id: result.id, title, createdBy, status: 'active', project, createdAt: now, updatedAt: now };
}

export function getThread(threadId: number): ForumThread | null {
  const row = db.select().from(forumThreads).where(threadWhere(threadId)).get();
  return row ? toForumThread(row) : null;
}

export function updateThreadStatus(threadId: number, status: ThreadStatus): void {
  db.update(forumThreads).set({ status, updatedAt: Date.now() }).where(threadWhere(threadId)).run();
}

export function listThreads(options: {
  status?: ThreadStatus;
  project?: string;
  limit?: number;
  offset?: number;
} = {}): { threads: ForumThread[]; total: number } {
  const { status, project, limit = 20, offset = 0 } = options;
  const conditions = [];
  if (status) conditions.push(eq(forumThreads.status, status));
  if (project) conditions.push(eq(forumThreads.project, project));
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
  const now = Date.now();
  const result = db.insert(forumMessages).values({
    threadId,
    role,
    content,
    author: options.author || null,
    principlesFound: options.principlesFound || null,
    patternsFound: options.patternsFound || null,
    searchQuery: options.searchQuery || null,
    createdAt: now,
  }).returning({ id: forumMessages.id }).get();
  db.update(forumThreads).set({ updatedAt: now }).where(threadWhere(threadId)).run();
  return {
    id: result.id,
    threadId,
    role,
    content,
    author: options.author,
    principlesFound: options.principlesFound,
    patternsFound: options.patternsFound,
    searchQuery: options.searchQuery,
    createdAt: now,
  };
}

export function getMessages(threadId: number): ForumMessage[] {
  return db.select()
    .from(forumMessages)
    .where(eq(forumMessages.threadId, threadId))
    .orderBy(forumMessages.createdAt)
    .all()
    .map(toForumMessage);
}

export async function handleThreadMessage(input: OracleThreadInput): Promise<OracleThreadOutput> {
  const { message, threadId, title, role = 'human', model } = input;
  const project = getProjectContext_();
  const baseAuthor = role === 'human' ? 'user' : model || 'claude';
  const author = project ? `${baseAuthor}@${project}` : baseAuthor;
  let thread: ForumThread;

  if (threadId) {
    const existing = getThread(threadId);
    if (!existing) throw new Error(`Thread ${threadId} not found`);
    thread = existing;
  } else {
    const threadTitle = title || message.slice(0, 50) + (message.length > 50 ? '...' : '');
    thread = createThread(threadTitle, author, project);
  }

  const userMessage = addMessage(thread.id, role, message, { author });
  if (role === 'human' || role === 'claude') updateThreadStatus(thread.id, 'pending');
  const updatedThread = getThread(thread.id)!;
  return { threadId: thread.id, messageId: userMessage.id, status: updatedThread.status as ThreadStatus, issueUrl: updatedThread.issueUrl };
}

export function getFullThread(threadId: number): { thread: ForumThread; messages: ForumMessage[] } | null {
  const thread = getThread(threadId);
  return thread ? { thread, messages: getMessages(threadId) } : null;
}
