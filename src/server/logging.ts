/**
 * Oracle v2 Logging Functions
 *
 * Refactored to use Drizzle ORM for type-safe queries.
 */

import { db, searchLog, documentAccess, learnLog } from '../db/index.ts';
import type { SearchResult } from './types.ts';

/**
 * Log search query with full details
 */
export function logSearch(
  query: string,
  type: string,
  mode: string,
  resultsCount: number,
  searchTimeMs: number,
  results: SearchResult[] = [],
  project?: string
) {
  try {
    // Store top 5 results as JSON (id, type, score, snippet)
    const resultsJson = results.length > 0
      ? JSON.stringify(results.slice(0, 5).map(r => ({
          id: r.id,
          type: r.type,
          score: r.score,
          snippet: r.content?.substring(0, 100)
        })))
      : null;

    db.insert(searchLog).values({
      query,
      type,
      mode,
      resultsCount,
      searchTimeMs,
      createdAt: Date.now(),
      project: project || null,
      results: resultsJson,
    }).run();

    // Comprehensive console logging
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[SEARCH] ${new Date().toISOString()}`);
    if (project) console.log(`  Project: ${project}`);
    console.log(`  Query: "${query}"`);
    console.log(`  Type: ${type} | Mode: ${mode}`);
    console.log(`  Results: ${resultsCount} in ${searchTimeMs}ms`);

    if (results.length > 0) {
      console.log(`  Top Results:`);
      results.slice(0, 5).forEach((r, i) => {
        console.log(`    ${i + 1}. [${r.type}] score=${r.score || 'N/A'} id=${r.id}`);
        console.log(`       ${r.content?.substring(0, 80)}...`);
      });
    }

    // Log any unexpected fields
    if (results.length > 0) {
      const expectedFields = ['id', 'type', 'content', 'source_file', 'concepts', 'source', 'score', 'project', 'distance', 'model'];
      const firstResult = results[0] as unknown as Record<string, unknown>;
      const unknownFields = Object.keys(firstResult).filter(k => !expectedFields.includes(k));
      if (unknownFields.length > 0) {
        console.log(`  [UNKNOWN FIELDS]: ${unknownFields.join(', ')}`);
      }
    }
    console.log(`${'='.repeat(60)}\n`);
  } catch (e) {
    console.error('Failed to log search:', e);
  }
}

/**
 * Log document access
 */
export function logDocumentAccess(documentId: string, accessType: string, project?: string) {
  try {
    db.insert(documentAccess).values({
      documentId,
      accessType,
      createdAt: Date.now(),
      project: project || null,
    }).run();
  } catch (e) {
    console.error('Failed to log access:', e);
  }
}

/**
 * Log learning addition
 */
export function logLearning(documentId: string, patternPreview: string, source: string, concepts: string[], project?: string) {
  try {
    db.insert(learnLog).values({
      documentId,
      patternPreview: patternPreview.substring(0, 100),
      source: source || 'Oracle Learn',
      concepts: JSON.stringify(concepts),
      createdAt: Date.now(),
      project: project || null,
    }).run();
  } catch (e) {
    console.error('Failed to log learning:', e);
  }
}

