/**
 * Trace Log Handler
 * Issue #17: feat: Trace Log — Make discoveries traceable and diggable
 *
 * Refactored to use Drizzle ORM for type-safe queries
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { eq, desc, and, like, sql, isNull } from 'drizzle-orm';
import { db, traceLog } from '../db/index.ts';
import { REPO_ROOT } from '../config.ts';
import type {
  CreateTraceInput,
  CreateTraceResult,
  ListTracesInput,
  ListTracesResult,
  TraceRecord,
  TraceSummary,
  TraceChainResult,
  DistillTraceInput,
} from './types.ts';

/**
 * Check if a learning is a file path or text snippet
 */
function isLearningFilePath(learning: string): boolean {
  return learning.startsWith('ψ/') || learning.includes('/memory/learnings/');
}

/**
 * Create a learning file from a text snippet
 * Returns the file path
 */
function createLearningFile(
  text: string,
  project: string | null,
  traceQuery: string
): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Generate slug from text (first 50 chars, slugified)
  const slug = text
    .slice(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  const filename = `${dateStr}_trace-${slug}.md`;
  const relativePath = `ψ/memory/learnings/${filename}`;
  const fullPath = join(REPO_ROOT, relativePath);

  // Ensure directory exists
  const dir = dirname(fullPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create learning file content
  const content = `---
title: ${text.slice(0, 80)}
tags: [trace-learning${project ? `, ${project.split('/').pop()}` : ''}]
created: ${dateStr}
source: Trace discovery
project: ${project || 'unknown'}
trace_query: "${traceQuery.replace(/"/g, '\\"')}"
---

# ${text.slice(0, 80)}

${text}

---
*Auto-generated from trace: "${traceQuery}"*
${project ? `*Source project: ${project}*` : ''}
`;

  writeFileSync(fullPath, content, 'utf-8');
  return relativePath;
}

/**
 * Process foundLearnings - convert text snippets to file paths
 */
function processLearnings(
  learnings: string[] | undefined,
  project: string | null,
  traceQuery: string
): string[] {
  if (!learnings || learnings.length === 0) return [];

  return learnings.map(learning => {
    if (isLearningFilePath(learning)) {
      // Already a file path, keep as-is
      return learning;
    }
    // Text snippet - create a learning file
    return createLearningFile(learning, project, traceQuery);
  });
}

/**
 * Create a new trace log entry
 */
export function createTrace(input: CreateTraceInput): CreateTraceResult {
  const traceId = randomUUID();
  const now = Date.now();

  // Process learnings - convert text snippets to file paths
  const processedLearnings = processLearnings(
    input.foundLearnings,
    input.project || null,
    input.query
  );

  // Calculate counts
  const fileCount =
    (input.foundFiles?.length || 0) +
    (input.foundRetrospectives?.length || 0) +
    (processedLearnings?.length || 0) +
    (input.foundResonance?.length || 0);
  const commitCount = input.foundCommits?.length || 0;
  const issueCount = input.foundIssues?.length || 0;

  // Determine depth from parent
  let depth = 0;
  if (input.parentTraceId) {
    const parent = db
      .select({ depth: traceLog.depth })
      .from(traceLog)
      .where(eq(traceLog.traceId, input.parentTraceId))
      .get();
    if (parent) depth = (parent.depth || 0) + 1;
  }

  // Insert trace
  db.insert(traceLog).values({
    traceId,
    query: input.query,
    queryType: input.queryType || 'general',
    foundFiles: JSON.stringify(input.foundFiles || []),
    foundCommits: JSON.stringify(input.foundCommits || []),
    foundIssues: JSON.stringify(input.foundIssues || []),
    foundRetrospectives: JSON.stringify(input.foundRetrospectives || []),
    foundLearnings: JSON.stringify(processedLearnings),
    foundResonance: JSON.stringify(input.foundResonance || []),
    fileCount,
    commitCount,
    issueCount,
    depth,
    parentTraceId: input.parentTraceId || null,
    childTraceIds: '[]',
    scope: input.scope || 'project',
    project: input.project || null,
    sessionId: input.sessionId || null,
    agentCount: input.agentCount || 1,
    durationMs: input.durationMs || null,
    status: 'raw',
    createdAt: now,
    updatedAt: now,
  }).run();

  // Update parent's child_trace_ids
  if (input.parentTraceId) {
    updateTraceChildren(input.parentTraceId, traceId);
  }

  return {
    success: true,
    traceId,
    depth,
    summary: {
      fileCount,
      commitCount,
      issueCount,
      totalDigPoints: fileCount + commitCount + issueCount,
    },
  };
}

/**
 * Get a trace by ID
 */
export function getTrace(traceId: string): TraceRecord | null {
  const row = db
    .select()
    .from(traceLog)
    .where(eq(traceLog.traceId, traceId))
    .get();

  if (!row) return null;
  return parseTraceRow(row);
}

/**
 * List traces with optional filters
 */
export function listTraces(input: ListTracesInput): ListTracesResult {
  const limit = input.limit || 20;
  const offset = input.offset || 0;

  // Build conditions array
  const conditions = [];
  if (input.query) {
    conditions.push(like(traceLog.query, `%${input.query}%`));
  }
  if (input.project) {
    conditions.push(eq(traceLog.project, input.project));
  }
  if (input.status) {
    conditions.push(eq(traceLog.status, input.status));
  }
  if (input.depth !== undefined) {
    conditions.push(eq(traceLog.depth, input.depth));
  }

  // Build where clause
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get count
  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(traceLog)
    .where(whereClause)
    .get();
  const total = countResult?.count || 0;

  // Get traces
  const rows = db
    .select({
      traceId: traceLog.traceId,
      query: traceLog.query,
      depth: traceLog.depth,
      fileCount: traceLog.fileCount,
      commitCount: traceLog.commitCount,
      issueCount: traceLog.issueCount,
      scope: traceLog.scope,
      status: traceLog.status,
      awakening: traceLog.awakening,
      parentTraceId: traceLog.parentTraceId,
      prevTraceId: traceLog.prevTraceId,
      nextTraceId: traceLog.nextTraceId,
      createdAt: traceLog.createdAt,
    })
    .from(traceLog)
    .where(whereClause)
    .orderBy(desc(traceLog.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    traces: rows.map((r) => ({
      traceId: r.traceId,
      parentTraceId: r.parentTraceId,
      prevTraceId: r.prevTraceId,
      nextTraceId: r.nextTraceId,
      query: r.query,
      scope: r.scope || 'project',
      depth: r.depth || 0,
      fileCount: r.fileCount || 0,
      commitCount: r.commitCount || 0,
      issueCount: r.issueCount || 0,
      status: r.status || 'raw',
      hasAwakening: !!r.awakening,
      createdAt: r.createdAt,
    })),
    total,
    hasMore: offset + rows.length < total,
  };
}

/**
 * Get the full trace chain (ancestors + descendants)
 */
export function getTraceChain(
  traceId: string,
  direction: 'up' | 'down' | 'both' = 'both'
): TraceChainResult {
  const chain: TraceSummary[] = [];
  let hasAwakening = false;
  let awakeningTraceId: string | undefined;

  // Get ancestors (up)
  if (direction === 'up' || direction === 'both') {
    let current = getTrace(traceId);
    while (current?.parentTraceId) {
      const parent = getTrace(current.parentTraceId);
      if (parent) {
        chain.unshift(toSummary(parent));
        if (parent.awakening) {
          hasAwakening = true;
          awakeningTraceId = parent.traceId;
        }
      }
      current = parent;
    }
  }

  // Add self
  const self = getTrace(traceId);
  if (self) {
    chain.push(toSummary(self));
    if (self.awakening) {
      hasAwakening = true;
      awakeningTraceId = self.traceId;
    }
  }

  // Get descendants (down) - BFS
  if (direction === 'down' || direction === 'both') {
    const queue = self?.childTraceIds || [];
    while (queue.length > 0) {
      const childId = queue.shift()!;
      const child = getTrace(childId);
      if (child) {
        chain.push(toSummary(child));
        if (child.awakening) {
          hasAwakening = true;
          awakeningTraceId = child.traceId;
        }
        queue.push(...child.childTraceIds);
      }
    }
  }

  return {
    chain,
    totalDepth: Math.max(...chain.map((t) => t.depth), 0),
    hasAwakening,
    awakeningTraceId,
  };
}

/**
 * Link two traces as a chain (prev ← → next)
 * "Nothing is Deleted" - just creates bidirectional links
 */
export function linkTraces(
  prevTraceId: string,
  nextTraceId: string
): { success: boolean; message: string; prevTrace?: TraceRecord; nextTrace?: TraceRecord } {
  const prevTrace = getTrace(prevTraceId);
  const nextTrace = getTrace(nextTraceId);

  if (!prevTrace) return { success: false, message: `Previous trace not found: ${prevTraceId}` };
  if (!nextTrace) return { success: false, message: `Next trace not found: ${nextTraceId}` };

  // Check if either already has a link in that direction
  if (prevTrace.nextTraceId) {
    return { success: false, message: `Trace ${prevTraceId} already has a next link` };
  }
  if (nextTrace.prevTraceId) {
    return { success: false, message: `Trace ${nextTraceId} already has a prev link` };
  }

  const now = Date.now();

  // Update prev trace to point to next
  db.update(traceLog)
    .set({ nextTraceId, updatedAt: now })
    .where(eq(traceLog.traceId, prevTraceId))
    .run();

  // Update next trace to point to prev
  db.update(traceLog)
    .set({ prevTraceId, updatedAt: now })
    .where(eq(traceLog.traceId, nextTraceId))
    .run();

  return {
    success: true,
    message: `Linked: ${prevTraceId} → ${nextTraceId}`,
    prevTrace: getTrace(prevTraceId) || undefined,
    nextTrace: getTrace(nextTraceId) || undefined,
  };
}

/**
 * Unlink two traces (remove the chain connection)
 */
export function unlinkTraces(
  traceId: string,
  direction: 'prev' | 'next'
): { success: boolean; message: string } {
  const trace = getTrace(traceId);
  if (!trace) return { success: false, message: `Trace not found: ${traceId}` };

  const now = Date.now();

  if (direction === 'next' && trace.nextTraceId) {
    // Remove link from this trace
    db.update(traceLog)
      .set({ nextTraceId: null, updatedAt: now })
      .where(eq(traceLog.traceId, traceId))
      .run();

    // Remove back-link from next trace
    db.update(traceLog)
      .set({ prevTraceId: null, updatedAt: now })
      .where(eq(traceLog.traceId, trace.nextTraceId))
      .run();

    return { success: true, message: `Unlinked next: ${traceId} -/-> ${trace.nextTraceId}` };
  }

  if (direction === 'prev' && trace.prevTraceId) {
    // Remove link from this trace
    db.update(traceLog)
      .set({ prevTraceId: null, updatedAt: now })
      .where(eq(traceLog.traceId, traceId))
      .run();

    // Remove back-link from prev trace
    db.update(traceLog)
      .set({ nextTraceId: null, updatedAt: now })
      .where(eq(traceLog.traceId, trace.prevTraceId))
      .run();

    return { success: true, message: `Unlinked prev: ${trace.prevTraceId} -/-> ${traceId}` };
  }

  return { success: false, message: `No ${direction} link to remove` };
}

/**
 * Get the full linked chain for a trace
 */
export function getTraceLinkedChain(
  traceId: string
): { chain: TraceRecord[]; position: number } {
  const chain: TraceRecord[] = [];
  let position = 0;

  // Walk backwards to find the start
  let current = getTrace(traceId);
  const visited = new Set<string>();

  while (current?.prevTraceId && !visited.has(current.prevTraceId)) {
    visited.add(current.traceId);
    current = getTrace(current.prevTraceId);
  }

  // Now walk forward from start
  while (current && !visited.has(current.traceId)) {
    if (current.traceId === traceId) {
      position = chain.length;
    }
    chain.push(current);
    visited.add(current.traceId);
    if (current.nextTraceId) {
      current = getTrace(current.nextTraceId);
    } else {
      break;
    }
  }

  return { chain, position };
}

/**
 * Distill awakening from a trace
 */
export function distillTrace(
  input: DistillTraceInput
): { success: boolean; status: string; learningId?: string } {
  const now = Date.now();

  db.update(traceLog)
    .set({
      status: 'distilled',
      awakening: input.awakening,
      distilledAt: now,
      updatedAt: now,
    })
    .where(eq(traceLog.traceId, input.traceId))
    .run();

  // TODO: If promoteToLearning, call muninn_learn
  // This would require access to the learn function

  return {
    success: true,
    status: 'distilled',
  };
}

/**
 * Update parent's child_trace_ids
 */
function updateTraceChildren(parentId: string, childId: string) {
  const parent = db
    .select({ childTraceIds: traceLog.childTraceIds })
    .from(traceLog)
    .where(eq(traceLog.traceId, parentId))
    .get();

  if (parent) {
    const children = JSON.parse(parent.childTraceIds || '[]');
    children.push(childId);

    db.update(traceLog)
      .set({
        childTraceIds: JSON.stringify(children),
        updatedAt: Date.now(),
      })
      .where(eq(traceLog.traceId, parentId))
      .run();
  }
}

/**
 * Parse database row to TraceRecord
 */
function parseTraceRow(row: typeof traceLog.$inferSelect): TraceRecord {
  return {
    id: row.id,
    traceId: row.traceId,
    query: row.query,
    queryType: row.queryType || 'general',
    foundFiles: JSON.parse(row.foundFiles || '[]'),
    foundCommits: JSON.parse(row.foundCommits || '[]'),
    foundIssues: JSON.parse(row.foundIssues || '[]'),
    foundRetrospectives: JSON.parse(row.foundRetrospectives || '[]'),
    foundLearnings: JSON.parse(row.foundLearnings || '[]'),
    foundResonance: JSON.parse(row.foundResonance || '[]'),
    fileCount: row.fileCount || 0,
    commitCount: row.commitCount || 0,
    issueCount: row.issueCount || 0,
    depth: row.depth || 0,
    parentTraceId: row.parentTraceId,
    childTraceIds: JSON.parse(row.childTraceIds || '[]'),
    prevTraceId: row.prevTraceId,
    nextTraceId: row.nextTraceId,
    scope: row.scope || 'project',
    project: row.project,
    sessionId: row.sessionId,
    agentCount: row.agentCount || 1,
    durationMs: row.durationMs,
    status: row.status || 'raw',
    awakening: row.awakening,
    distilledToId: row.distilledToId,
    distilledAt: row.distilledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Convert TraceRecord to TraceSummary
 */
function toSummary(t: TraceRecord): TraceSummary {
  return {
    traceId: t.traceId,
    query: t.query,
    scope: t.scope,
    depth: t.depth,
    fileCount: t.fileCount,
    commitCount: t.commitCount,
    issueCount: t.issueCount,
    status: t.status,
    hasAwakening: !!t.awakening,
    createdAt: t.createdAt,
  };
}

// Note: Migration handled by Drizzle. Run `bun run db:push` to apply schema changes.
