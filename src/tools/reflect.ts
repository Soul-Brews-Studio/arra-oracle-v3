/**
 * Oracle Reflect Handler
 *
 * Return random wisdom from the knowledge base. With `count` > 1, returns a
 * small digest of several random docs grouped by shared concept tags instead
 * of one flat document — a lightweight, deterministic stand-in for
 * RAPTOR-style recursive clustering. True RAPTOR (embedding-based clustering
 * + LLM-generated per-cluster summaries) doesn't fit this handler: it's a
 * synchronous MCP tool call with no model access, not an agent turn. This
 * groups by the concept tags already on each doc and lists them per group
 * instead of synthesizing new summary text.
 */

import { sql, inArray } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import type { ToolContext, ToolResponse, OracleReflectInput } from './types.ts';

export const reflectToolDef = {
  name: 'oracle_reflect',
  description: 'Get a random principle or learning for reflection. Use this for periodic wisdom or to align with Oracle philosophy.',
  inputSchema: {
    type: 'object',
    properties: {
      count: {
        type: 'number',
        description: 'When > 1 (max 10), returns a digest of several random docs grouped by shared concept tags instead of a single document.',
      }
    }
  }
};

interface ReflectDoc {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
}

function fetchReflectDoc(ctx: ToolContext, excludeIds: string[]): ReflectDoc | null {
  let query = ctx.db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
  })
    .from(oracleDocuments)
    .where(inArray(oracleDocuments.type, ['principle', 'learning']))
    .orderBy(sql`RANDOM()`)
    .limit(excludeIds.length + 1)
    .all();

  const doc = query.find(d => !excludeIds.includes(d.id));
  if (!doc) return null;

  const content = ctx.sqlite.prepare(`SELECT content FROM oracle_fts WHERE id = ?`).get(doc.id) as { content: string } | undefined;
  if (!content) return null;

  return {
    id: doc.id,
    type: doc.type,
    content: content.content,
    source_file: doc.sourceFile,
    concepts: JSON.parse(doc.concepts || '[]'),
  };
}

function buildDigest(docs: ReflectDoc[]): { groups: Array<{ concept: string; docs: ReflectDoc[] }>; ungrouped: ReflectDoc[] } {
  const byConcept = new Map<string, ReflectDoc[]>();
  for (const doc of docs) {
    for (const concept of doc.concepts) {
      const bucket = byConcept.get(concept) ?? [];
      bucket.push(doc);
      byConcept.set(concept, bucket);
    }
  }

  const grouped = new Set<string>();
  const groups: Array<{ concept: string; docs: ReflectDoc[] }> = [];
  for (const [concept, bucket] of Array.from(byConcept.entries()).sort((a, b) => b[1].length - a[1].length)) {
    if (bucket.length < 2) continue;
    const fresh = bucket.filter(d => !grouped.has(d.id));
    if (fresh.length < 2) continue;
    fresh.forEach(d => grouped.add(d.id));
    groups.push({ concept, docs: fresh });
  }

  const ungrouped = docs.filter(d => !grouped.has(d.id));
  return { groups, ungrouped };
}

export async function handleReflect(ctx: ToolContext, input: OracleReflectInput = {}): Promise<ToolResponse> {
  const count = Math.min(Math.max(Math.trunc(input.count ?? 1), 1), 10);

  if (count > 1) {
    const docs: ReflectDoc[] = [];
    const seen: string[] = [];
    for (let i = 0; i < count; i++) {
      const doc = fetchReflectDoc(ctx, seen);
      if (!doc) break;
      docs.push(doc);
      seen.push(doc.id);
    }

    if (docs.length === 0) {
      throw new Error('No documents found in Oracle knowledge base');
    }

    const { groups, ungrouped } = buildDigest(docs);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          digest: {
            requested: count,
            returned: docs.length,
            groups: groups.map(g => ({
              concept: g.concept,
              count: g.docs.length,
              docs: g.docs.map(d => ({ id: d.id, type: d.type, content: d.content, source_file: d.source_file, concepts: d.concepts })),
            })),
            ungrouped: ungrouped.map(d => ({ id: d.id, type: d.type, content: d.content, source_file: d.source_file, concepts: d.concepts })),
          },
        }, null, 2),
      }],
    };
  }

  const randomDoc = ctx.db.select({
    id: oracleDocuments.id,
    type: oracleDocuments.type,
    sourceFile: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
  })
    .from(oracleDocuments)
    .where(inArray(oracleDocuments.type, ['principle', 'learning']))
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .get();

  if (!randomDoc) {
    throw new Error('No documents found in Oracle knowledge base');
  }

  const content = ctx.sqlite.prepare(`
    SELECT content FROM oracle_fts WHERE id = ?
  `).get(randomDoc.id) as { content: string } | undefined;

  if (!content) {
    throw new Error('Document content not found in FTS index');
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        principle: {
          id: randomDoc.id,
          type: randomDoc.type,
          content: content.content,
          source_file: randomDoc.sourceFile,
          concepts: JSON.parse(randomDoc.concepts || '[]')
        }
      }, null, 2)
    }]
  };
}
